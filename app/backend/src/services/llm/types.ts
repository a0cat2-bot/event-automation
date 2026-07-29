/**
 * Provider-neutral LLM interface.
 *
 * Mirrors `services/email` so the internal-vs-external swap works the same way: application code
 * depends on this interface only, and `LLM_PROVIDER` decides which implementation is constructed.
 */

export interface LlmCompletionOptions {
  /** Stable instruction text. Kept separate from `prompt` so providers can cache it. */
  system: string;
  prompt: string;
  maxTokens?: number;
  /**
   * JSON Schema the response must conform to. When set, `LlmCompletion.json` is populated and
   * callers can skip parsing `text` themselves.
   */
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
}

export interface LlmCompletion {
  text: string;
  json: unknown | null;
  /** Recorded in the audit log so an AI-influenced decision can be traced to a specific model. */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LlmProvider {
  /** Provider id as configured (`claude`, `ai_pro`) — logged for auditability. */
  readonly name: string;
  complete(options: LlmCompletionOptions): Promise<LlmCompletion>;
}

/**
 * Thrown when an LLM call cannot be completed. Callers are expected to catch this and fall back to
 * their non-AI code path rather than failing the surrounding workflow.
 */
export class LlmUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmUnavailableError';
  }
}
