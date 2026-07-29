import { env } from '../../config/env.js';
import { LlmUnavailableError, type LlmCompletion, type LlmCompletionOptions, type LlmProvider } from './types.js';

interface AiProChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Routes LLM calls through the internal AI Pro gateway.
 *
 * AI_PRO_API_URL is intentionally left blank until the office network's real endpoint is available
 * — until then, selecting LLM_PROVIDER=ai_pro fails fast with a clear config error, and
 * LLM_PROVIDER=claude keeps working for development. This mirrors how `KnoxPortalProvider` is
 * staged for the internal mail endpoint.
 *
 * The request/response shape below (Bearer auth, OpenAI-style `{ model, messages, max_tokens }`
 * body and `{ choices: [{ message: { content } }] }` response) is a BEST-GUESS PLACEHOLDER, not a
 * confirmed AI Pro contract. Verify it against the real API documentation and adjust before
 * enabling this provider in any deployment.
 *
 * Note: JSON-schema-constrained output is requested via a response_format hint, but unlike the
 * Claude provider there is no guarantee the gateway honours it. `parseJson` therefore tolerates a
 * fenced code block, and callers still fall back to their non-AI path when parsing fails.
 */
export class AiProProvider implements LlmProvider {
  readonly name = 'ai_pro';

  async complete(options: LlmCompletionOptions): Promise<LlmCompletion> {
    if (!env.aiProApiUrl) {
      throw new LlmUnavailableError(
        'AI_PRO_API_URL is required to use the AI Pro provider — set it once the internal endpoint is available. Use LLM_PROVIDER=claude until then.',
      );
    }
    if (!env.aiProApiToken) {
      throw new LlmUnavailableError('AI_PRO_API_TOKEN is required to use the AI Pro provider.');
    }

    const model = env.llmModel || 'ai-pro-default';

    let response: Response;
    try {
      response = await fetch(env.aiProApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.aiProApiToken}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: options.maxTokens ?? 4000,
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.prompt },
          ],
          ...(options.jsonSchema
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: options.jsonSchema.name, schema: options.jsonSchema.schema },
                },
              }
            : {}),
        }),
      });
    } catch (error) {
      throw new LlmUnavailableError('AI Pro API request failed.', { cause: error });
    }

    const bodyText = await response.text();
    if (!response.ok) {
      throw new LlmUnavailableError(
        `AI Pro API request failed (HTTP ${response.status}): ${bodyText.slice(0, 500) || 'no response body'}`,
      );
    }

    let parsedBody: AiProChatResponse;
    try {
      parsedBody = JSON.parse(bodyText) as AiProChatResponse;
    } catch {
      throw new LlmUnavailableError(`AI Pro API returned a non-JSON response: ${bodyText.slice(0, 500)}`);
    }

    const text = parsedBody.choices?.[0]?.message?.content ?? '';
    if (!text) {
      throw new LlmUnavailableError('AI Pro API returned an empty response.');
    }

    return {
      text,
      json: options.jsonSchema ? parseJson(text) : null,
      model: parsedBody.model ?? model,
      inputTokens: parsedBody.usage?.prompt_tokens ?? null,
      outputTokens: parsedBody.usage?.completion_tokens ?? null,
    };
  }
}

/** Tolerates a ```json fenced block, which gateways without strict schema support often emit. */
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    throw new LlmUnavailableError('AI Pro API returned a response that was not valid JSON.');
  }
}
