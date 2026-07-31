import Anthropic from '@anthropic-ai/sdk';

import { env } from '../../config/env.js';
import { LlmUnavailableError, type LlmCompletion, type LlmCompletionOptions, type LlmProvider } from './types.js';

const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * Calls Claude through the public Anthropic API.
 *
 * Used for local development and demos. Deployments that must route AI traffic through an approved
 * internal gateway should set LLM_PROVIDER=ai_pro instead.
 */
export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude';

  async complete(options: LlmCompletionOptions): Promise<LlmCompletion> {
    if (!env.anthropicApiKey) {
      throw new LlmUnavailableError(
        'ANTHROPIC_API_KEY is required to use the Claude LLM provider. Set it, or set LLM_PROVIDER=disabled to turn AI features off.',
      );
    }

    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const model = env.llmModel || DEFAULT_MODEL;

    try {
      const response = await client.messages.create({
        model,
        max_tokens: options.maxTokens ?? 4000,
        system: [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: options.prompt }],
        ...(options.jsonSchema
          ? {
              // Claude's JSON output format takes the schema only; `jsonSchema.name` is used by
              // other providers and for audit logging.
              output_config: {
                format: { type: 'json_schema' as const, schema: options.jsonSchema.schema },
              },
            }
          : {}),
      });

      if (response.stop_reason === 'refusal') {
        throw new LlmUnavailableError('Claude declined to answer this request.');
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      let json: unknown | null = null;
      if (options.jsonSchema && text) {
        try {
          json = JSON.parse(text);
        } catch {
          throw new LlmUnavailableError('Claude returned a response that was not valid JSON.');
        }
      }

      return {
        text,
        json,
        model: response.model,
        inputTokens: response.usage.input_tokens ?? null,
        outputTokens: response.usage.output_tokens ?? null,
        requestId: response.id ?? null,
      };
    } catch (error) {
      if (error instanceof LlmUnavailableError) throw error;

      if (error instanceof Anthropic.AuthenticationError) {
        throw new LlmUnavailableError('ANTHROPIC_API_KEY was rejected.', { cause: error });
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new LlmUnavailableError('Claude API rate limit reached.', { cause: error });
      }
      if (error instanceof Anthropic.APIError) {
        throw new LlmUnavailableError(`Claude API error (HTTP ${error.status}): ${error.message}`, {
          cause: error,
        });
      }
      throw new LlmUnavailableError('Claude API request failed.', { cause: error });
    }
  }
}
