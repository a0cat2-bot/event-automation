import assert from 'node:assert/strict';
import test from 'node:test';

import { draftLetterCopy, stripUnknownMergeFields, type LetterCopyRequest } from './letterCopy.js';
import { LlmUnavailableError, type LlmCompletion } from './types.js';

const REQUEST: LetterCopyRequest = {
  categoryName: '당첨 안내',
  sections: { hasDatetime: true, hasLocation: true, hasGiftInfo: false, hasPrecautions: true },
  programName: '2026 하반기 웰니스 챌린지',
  programDescription: '6주간 걷기·운동 챌린지',
  orgDisplayName: 'AX센터 EHS그룹',
};

function stubProvider(completion: Partial<LlmCompletion> & { json?: unknown }) {
  return async () => ({
    name: 'stub',
    complete: async (): Promise<LlmCompletion> => ({
      text: '',
      json: completion.json ?? null,
      model: 'aipro-claude-sonnet',
      inputTokens: null,
      outputTokens: null,
      requestId: 'req-123',
      ...completion,
    }),
  });
}

test('a draft is returned with the model and request id for the audit trail', async () => {
  const draft = await draftLetterCopy(REQUEST, {
    resolveProvider: stubProvider({ json: { body_text: '{{applicant_name}}님, 안내드립니다.' } }),
  });

  assert.equal(draft?.bodyText, '{{applicant_name}}님, 안내드립니다.');
  assert.equal(draft?.model, 'aipro-claude-sonnet');
  assert.equal(draft?.requestId, 'req-123');
});

test('AI being unavailable yields no draft rather than an error', async () => {
  // The screen stays a manual editor, which is how it worked before this existed.
  assert.equal(await draftLetterCopy(REQUEST, { resolveProvider: async () => null }), null);

  const failing = await draftLetterCopy(REQUEST, {
    resolveProvider: async () => ({
      name: 'stub',
      complete: async () => {
        throw new LlmUnavailableError('gateway unreachable');
      },
    }),
  });
  assert.equal(failing, null);
});

test('an empty or malformed body yields no draft', async () => {
  assert.equal(await draftLetterCopy(REQUEST, { resolveProvider: stubProvider({ json: {} }) }), null);
  assert.equal(
    await draftLetterCopy(REQUEST, { resolveProvider: stubProvider({ json: { body_text: '   ' } }) }),
    null,
  );
  assert.equal(
    await draftLetterCopy(REQUEST, { resolveProvider: stubProvider({ json: { body_text: 42 } }) }),
    null,
  );
});

/**
 * The letter renderer only substitutes known keys, so an invented field would reach employees as
 * literal `{{...}}` text in a sent letter.
 */
test('merge fields outside the allowed list are removed', () => {
  assert.equal(
    stripUnknownMergeFields('{{applicant_name}}님, 참가비 {{event_fee}}를 확인하세요.'),
    '{{applicant_name}}님, 참가비 를 확인하세요.',
  );
});

test('allowed merge fields survive, including odd spacing and casing', () => {
  assert.equal(stripUnknownMergeFields('{{ applicant_name }}'), '{{applicant_name}}');
  assert.equal(stripUnknownMergeFields('{{Applicant_Name}}'), '{{applicant_name}}');
  assert.equal(
    stripUnknownMergeFields('{{program_name}} / {{coordinator_contact}}'),
    '{{program_name}} / {{coordinator_contact}}',
  );
});

test('a hallucinated field is stripped from the returned draft, not just flagged', async () => {
  const draft = await draftLetterCopy(REQUEST, {
    resolveProvider: stubProvider({
      json: { body_text: '{{applicant_name}}님 {{registration_code}}로 등록하세요.' },
    }),
  });

  assert.equal(draft?.bodyText, '{{applicant_name}}님 로 등록하세요.');
  assert.doesNotMatch(draft?.bodyText ?? '', /registration_code/);
});
