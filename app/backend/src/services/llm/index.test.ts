import assert from 'node:assert/strict';
import test from 'node:test';

import { isLlmConfiguredFor, resolveLlmProvider, type LlmConfig } from './index.js';
import { LlmUnavailableError } from './types.js';

/**
 * These cover the operator-level AI gate. The default must be fully off: a deployment that has not
 * opted in should never construct a provider, regardless of what the in-app feature toggles say.
 */

function config(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return { llmProvider: 'disabled', ...overrides };
}

test('AI is off by default', () => {
  assert.equal(resolveLlmProvider(config()), null);
  assert.equal(isLlmConfiguredFor(config()), false);
});

test('a stray API key does not re-enable a disabled deployment', () => {
  const disabledWithKey = config({ llmProvider: 'disabled', anthropicApiKey: 'sk-ant-test' });

  assert.equal(resolveLlmProvider(disabledWithKey), null);
  assert.equal(isLlmConfiguredFor(disabledWithKey), false);
});

test('claude provider is only reported configured once a key is present', () => {
  assert.equal(isLlmConfiguredFor(config({ llmProvider: 'claude' })), false);
  assert.equal(
    isLlmConfiguredFor(config({ llmProvider: 'claude', anthropicApiKey: 'sk-ant-test' })),
    true,
  );
  assert.equal(resolveLlmProvider(config({ llmProvider: 'claude' }))?.name, 'claude');
});

test('openai provider is only reported configured once a key is present', () => {
  assert.equal(isLlmConfiguredFor(config({ llmProvider: 'openai' })), false);
  assert.equal(
    isLlmConfiguredFor(config({ llmProvider: 'openai', openAiApiKey: 'sk-test' })),
    true,
  );
  assert.equal(resolveLlmProvider(config({ llmProvider: 'openai' }))?.name, 'openai');
});

test('a key for one provider does not configure another', () => {
  // Guards against a stale key in .env silently enabling whichever provider is selected.
  assert.equal(
    isLlmConfiguredFor(config({ llmProvider: 'claude', openAiApiKey: 'sk-test' })),
    false,
  );
  assert.equal(
    isLlmConfiguredFor(config({ llmProvider: 'openai', anthropicApiKey: 'sk-ant-test' })),
    false,
  );
});

test('ai_pro provider requires a service key', () => {
  // The endpoint has a documented default, so the key alone decides whether it is usable.
  assert.equal(isLlmConfiguredFor(config({ llmProvider: 'ai_pro' })), false);

  const withKey = config({ llmProvider: 'ai_pro', aiProApiKey: 'svc-key' });
  assert.equal(isLlmConfiguredFor(withKey), true);
  assert.equal(resolveLlmProvider(withKey)?.name, 'ai_pro');
});

test('an unrecognised provider name fails loudly instead of silently disabling AI', () => {
  assert.throws(
    () => resolveLlmProvider(config({ llmProvider: 'gpt' })),
    /Unsupported LLM_PROVIDER "gpt"/,
  );
  assert.equal(isLlmConfiguredFor(config({ llmProvider: 'gpt' })), false);
});

test('ai_pro without a service key fails on use, not at construction', async () => {
  const provider = resolveLlmProvider(config({ llmProvider: 'ai_pro' }));
  assert.ok(provider);

  await assert.rejects(
    () => provider.complete({ system: 'test', prompt: 'test' }),
    (error: unknown) => {
      assert.ok(error instanceof LlmUnavailableError);
      assert.match((error as Error).message, /AI_PRO_API_KEY is required/);
      return true;
    },
  );
});
