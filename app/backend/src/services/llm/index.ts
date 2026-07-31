import { env } from '../../config/env.js';
import { AiProProvider } from './aiProProvider.js';
import { ClaudeProvider } from './claudeProvider.js';
import { OpenAiProvider } from './openAiProvider.js';
import type { LlmProvider } from './types.js';

export type { LlmCompletion, LlmCompletionOptions, LlmProvider } from './types.js';
export { LlmUnavailableError } from './types.js';

export const LLM_PROVIDERS = ['disabled', 'claude', 'openai', 'ai_pro'] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

/** The subset of configuration that decides which provider (if any) is used. */
export interface LlmConfig {
  llmProvider: string;
  anthropicApiKey?: string | undefined;
  openAiApiKey?: string | undefined;
  aiProApiKey?: string | undefined;
}

/**
 * Pure form of {@link getLlmProvider}, taking config explicitly so the gate can be tested without
 * mutating process.env (config/env.ts snapshots it once at module load).
 */
export function resolveLlmProvider(config: LlmConfig): LlmProvider | null {
  if (config.llmProvider === 'disabled') return null;
  if (config.llmProvider === 'claude') return new ClaudeProvider();
  if (config.llmProvider === 'openai') return new OpenAiProvider();
  if (config.llmProvider === 'ai_pro') return new AiProProvider();

  throw new Error(
    `Unsupported LLM_PROVIDER "${config.llmProvider}". Expected one of: ${LLM_PROVIDERS.join(', ')}.`,
  );
}

/** Pure form of {@link isLlmConfigured}. */
export function isLlmConfiguredFor(config: LlmConfig): boolean {
  if (config.llmProvider === 'claude') return Boolean(config.anthropicApiKey);
  if (config.llmProvider === 'openai') return Boolean(config.openAiApiKey);
  // The base URL has a documented default, so only the service key must be supplied.
  if (config.llmProvider === 'ai_pro') return Boolean(config.aiProApiKey);
  return false;
}

/**
 * Returns the configured provider, or null when AI is switched off at the deployment level.
 *
 * This is the outer of two gates. It is operator-controlled (env only, never editable from the UI)
 * and answers "is this deployment allowed to call an LLM at all". The inner gate — which specific
 * features may use it — lives in org_settings and is coordinator-controlled.
 */
export function getLlmProvider(): LlmProvider | null {
  return resolveLlmProvider(env);
}

/**
 * Whether an LLM call could plausibly succeed: a provider is selected AND its credentials are
 * present. Used to decide whether the UI offers AI toggles at all, so coordinators are never shown
 * a switch that would fail the moment they flip it.
 */
export function isLlmConfigured(): boolean {
  return isLlmConfiguredFor(env);
}
