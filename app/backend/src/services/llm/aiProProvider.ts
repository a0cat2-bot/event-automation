import { randomUUID } from 'node:crypto';

import { env } from '../../config/env.js';
import { LlmUnavailableError, type LlmCompletion, type LlmCompletionOptions, type LlmProvider } from './types.js';

/**
 * Routes LLM calls through the internal AI Pro gateway.
 *
 * Implemented against the AI Pro API developer guide (v1). This is the only provider the company
 * permits an application to call: external enterprise AI may not be used over an API at all. The
 * platform runs in a no-retain, no-train mode, deletes request bodies immediately, and keeps only
 * metadata.
 *
 * Personal data still must not be sent. Sending it requires Data Privacy team approval, which is
 * not available to this app, so employee-written free text is redacted before it goes out — see
 * utils/redaction.ts.
 *
 * Reachability: AI Pro is a public-cloud HTTPS service, so no VPN is required to reach it.
 *
 * Tool calling is not supported by the platform. Nothing here needs it: the model returns
 * structured JSON and this application executes every database read, write, and send itself, which
 * is also what keeps AI output reviewable rather than self-acting.
 */

const DEFAULT_BASE_URL = 'https://aipro.samsung.net/v1';
/** Structured-output optimised, per the model table in the guide. */
const DEFAULT_MODEL = 'aipro-claude-sonnet';
/** Server-side timeout is 60s; the guide recommends a client timeout at or below 70s. */
const REQUEST_TIMEOUT_MS = 70_000;

interface AiProOpenAiResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

interface AiProAnthropicResponse {
  model?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

export class AiProProvider implements LlmProvider {
  readonly name = 'ai_pro';

  async complete(options: LlmCompletionOptions): Promise<LlmCompletion> {
    if (!env.aiProApiKey) {
      throw new LlmUnavailableError(
        'AI_PRO_API_KEY is required to use the AI Pro provider. Issue a service key from the AI Platform console (API Key 관리) and set it in the environment.',
      );
    }

    const baseUrl = (env.aiProApiUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = env.llmModel || DEFAULT_MODEL;
    const useAnthropicStyle = env.aiProModelStyle === 'anthropic';
    // Sent rather than only read back, so a failed call is still traceable in the platform's audit
    // log even when no response is received.
    const requestId = randomUUID();

    const response = await this.post(
      `${baseUrl}/chat/completions`,
      {
        'Content-Type': 'application/json',
        'X-API-Key': env.aiProApiKey,
        'X-Request-ID': requestId,
        'X-API-Version': env.aiProApiVersion,
        ...(useAnthropicStyle ? { 'X-Model-Style': 'anthropic' } : {}),
      },
      useAnthropicStyle
        ? {
            model,
            max_tokens: options.maxTokens ?? 4000,
            // Anthropic style lifts the instruction out of the message array.
            system: options.system,
            messages: [{ role: 'user', content: options.prompt }],
            ...(options.jsonSchema ? { json_schema: options.jsonSchema.schema } : {}),
          }
        : {
            model,
            max_tokens: options.maxTokens ?? 4000,
            messages: [
              { role: 'system', content: options.system },
              { role: 'user', content: options.prompt },
            ],
            // Note this is NOT the public OpenAI shape: AI Pro takes `json_object` with the schema
            // as a sibling, not `json_schema` with a nested name+schema object.
            ...(options.jsonSchema
              ? { response_format: { type: 'json_object', schema: options.jsonSchema.schema } }
              : {}),
          },
    );

    warnIfRateLimitLow(response.headers.get('X-RateLimit-Remaining'));

    const bodyText = await response.text();
    if (!response.ok) {
      throw new LlmUnavailableError(
        `AI Pro API error (HTTP ${response.status}, request ${requestId}): ${errorDetail(bodyText)}`,
      );
    }

    let parsedBody: AiProOpenAiResponse & AiProAnthropicResponse;
    try {
      parsedBody = JSON.parse(bodyText) as AiProOpenAiResponse & AiProAnthropicResponse;
    } catch {
      throw new LlmUnavailableError(
        `AI Pro API returned a non-JSON response: ${bodyText.slice(0, 500)}`,
      );
    }

    const text = useAnthropicStyle
      ? (parsedBody.content ?? [])
          .filter((block) => block.type === undefined || block.type === 'text')
          .map((block) => block.text ?? '')
          .join('')
      : (parsedBody.choices?.[0]?.message?.content ?? '');

    if (!text) throw new LlmUnavailableError('AI Pro API returned an empty response.');

    return {
      text,
      json: options.jsonSchema ? parseJson(text) : null,
      model: parsedBody.model ?? model,
      inputTokens: parsedBody.usage?.prompt_tokens ?? parsedBody.usage?.input_tokens ?? null,
      outputTokens: parsedBody.usage?.completion_tokens ?? parsedBody.usage?.output_tokens ?? null,
      // Prefer what the server reports; fall back to what was sent if the header is absent.
      requestId: response.headers.get('X-Request-ID') ?? requestId,
    };
  }

  private async post(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<Response> {
    // fetch has no default timeout, so a hung gateway would otherwise stall the whole selection.
    const abort = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: abort });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new LlmUnavailableError(
          `AI Pro did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`,
          { cause: error },
        );
      }
      throw new LlmUnavailableError(
        'AI Pro API request failed. Check network connectivity to the gateway and the service key.',
        { cause: error },
      );
    }
  }
}

function errorDetail(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
    return parsed.error?.message ?? bodyText.slice(0, 500);
  } catch {
    return bodyText.slice(0, 500) || 'no response body';
  }
}

/**
 * The guide documents no fallback mode for structured output, so a model that ignores the schema
 * returns prose. A fenced block is tolerated; anything else is surfaced as unavailable so the
 * caller degrades to its non-AI path rather than acting on an unparsed response.
 */
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    throw new LlmUnavailableError('AI Pro returned a response that was not valid JSON.');
  }
}

function warnIfRateLimitLow(remaining: string | null): void {
  if (!remaining) return;
  const value = Number(remaining);
  if (Number.isFinite(value) && value < 100) {
    console.warn(`[ai_pro] rate limit remaining: ${value}`);
  }
}
