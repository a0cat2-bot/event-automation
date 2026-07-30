import { env } from '../../config/env.js';
import { LlmUnavailableError, type LlmCompletion, type LlmCompletionOptions, type LlmProvider } from './types.js';

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface OpenAiChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * Calls OpenAI's chat completions API.
 *
 * Provided so development can use whichever external account is already funded. Like the Claude
 * provider it sends data outside the corporate boundary, so it is for synthetic test data only —
 * production traffic belongs on the internal gateway (LLM_PROVIDER=ai_pro).
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';

  async complete(options: LlmCompletionOptions): Promise<LlmCompletion> {
    if (!env.openAiApiKey) {
      throw new LlmUnavailableError(
        'OPENAI_API_KEY is required to use the OpenAI provider. Set it, or set LLM_PROVIDER=disabled to turn AI features off.',
      );
    }

    const baseUrl = (env.openAiBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = env.llmModel || DEFAULT_MODEL;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.openAiApiKey}`,
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: options.maxTokens ?? 4000,
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.prompt },
          ],
          ...(options.jsonSchema
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: options.jsonSchema.name,
                    schema: options.jsonSchema.schema,
                    strict: true,
                  },
                },
              }
            : {}),
        }),
      });
    } catch (error) {
      throw new LlmUnavailableError('OpenAI API request failed.', { cause: error });
    }

    const bodyText = await response.text();
    if (!response.ok) {
      let detail = bodyText.slice(0, 500);
      try {
        detail = (JSON.parse(bodyText) as OpenAiChatResponse).error?.message ?? detail;
      } catch {
        // Keep the raw body when the error payload is not JSON.
      }
      throw new LlmUnavailableError(`OpenAI API error (HTTP ${response.status}): ${detail}`);
    }

    let parsedBody: OpenAiChatResponse;
    try {
      parsedBody = JSON.parse(bodyText) as OpenAiChatResponse;
    } catch {
      throw new LlmUnavailableError(`OpenAI API returned a non-JSON response: ${bodyText.slice(0, 500)}`);
    }

    const text = parsedBody.choices?.[0]?.message?.content ?? '';
    if (!text) throw new LlmUnavailableError('OpenAI API returned an empty response.');

    let json: unknown | null = null;
    if (options.jsonSchema) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new LlmUnavailableError('OpenAI returned a response that was not valid JSON.');
      }
    }

    return {
      text,
      json,
      model: parsedBody.model ?? model,
      inputTokens: parsedBody.usage?.prompt_tokens ?? null,
      outputTokens: parsedBody.usage?.completion_tokens ?? null,
    };
  }
}
