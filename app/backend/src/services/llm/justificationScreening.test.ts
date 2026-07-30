import assert from 'node:assert/strict';
import test from 'node:test';

import { heuristicQuality, screenJustifications } from './justificationScreening.js';
import { LlmUnavailableError } from './types.js';

/**
 * The heuristic is the path taken whenever AI is unavailable — the default, and the permanent
 * state in environments where external AI is not permitted. These tests pin the behaviour the
 * previous implementation got wrong: it matched a hard-coded list of English keywords and scored
 * readability with an English-syllable formula, so every Korean submission was ranked on length
 * alone and padded text beat concise, specific text.
 */

const SINCERE_SHORT =
  '평소 어깨와 목 통증이 심해 스트레스를 많이 받고 있습니다. 이번 프로그램으로 건강한 습관을 만들고 싶습니다.';
const SINCERE_LONG =
  '작년부터 재택근무가 늘면서 목과 허리 통증이 심해졌습니다. 병원에서는 자세 교정과 규칙적인 스트레칭이 필요하다고 했지만 혼자서는 꾸준히 하기가 어려웠습니다. 이번 프로그램에서 전문가의 지도를 받아 올바른 자세를 익히고, 팀 동료들과 함께 습관을 만들어 보고 싶습니다.';
const PADDED = '아아아아 그냥 신청합니다 '.repeat(20);
const REPEATED_SENTENCE = '건강해지고 싶습니다. '.repeat(15);

test('padding cannot outrank genuine content, however long it is', () => {
  const padded = heuristicQuality(PADDED).qualityScore;

  // PADDED is roughly five times the length of SINCERE_SHORT. Under the previous scoring it won
  // by 4.6x purely on character count.
  assert.ok(PADDED.length > SINCERE_SHORT.length * 3, 'test fixture should be much longer');
  assert.ok(
    padded < heuristicQuality(SINCERE_SHORT).qualityScore,
    `padded (${padded}) must score below a short sincere answer`,
  );
  assert.ok(padded < heuristicQuality(SINCERE_LONG).qualityScore);
  assert.ok(heuristicQuality(REPEATED_SENTENCE).qualityScore < 10);
});

test('Korean is not penalised relative to English', () => {
  const english =
    'I want to improve my health through exercise and reduce stress for better balance.';

  // The old implementation gave this English text 43.3 and the comparable Korean text 2.4, purely
  // because the keyword list and readability formula only understood English.
  const korean = heuristicQuality(SINCERE_SHORT).qualityScore;
  const scoreEnglish = heuristicQuality(english).qualityScore;

  assert.ok(korean > 0, 'Korean must score above zero');
  assert.ok(
    scoreEnglish < korean * 3,
    `English (${scoreEnglish}) must not dominate Korean (${korean}) by language alone`,
  );
});

test('longer genuine answers still rank above shorter ones', () => {
  assert.ok(
    heuristicQuality(SINCERE_LONG).qualityScore > heuristicQuality(SINCERE_SHORT).qualityScore,
  );
});

test('an empty justification scores zero and says why', () => {
  const empty = heuristicQuality('');
  assert.equal(empty.qualityScore, 0);
  assert.match(empty.rationale ?? '', /작성 내용이 없습니다/);

  assert.equal(heuristicQuality('   ').qualityScore, 0);
  assert.equal(heuristicQuality(null).qualityScore, 0);
});

test('rationale flags repetition so the coordinator knows to look', () => {
  assert.match(heuristicQuality(PADDED).rationale ?? '', /반복/);
  assert.doesNotMatch(heuristicQuality(SINCERE_LONG).rationale ?? '', /반복/);
});

test('screening falls back to the heuristic when AI is switched off', async () => {
  const outcome = await screenJustifications(
    [
      { applicantId: 'a', justification: SINCERE_LONG },
      { applicantId: 'b', justification: PADDED },
    ],
    { programName: '테스트 프로그램', programDescription: null },
    // Pinned rather than relying on the ambient environment: without this the test makes a real,
    // paid API call on any machine that happens to have a provider configured.
    { resolveProvider: async () => null },
  );

  assert.equal(outcome.method, 'heuristic');
  assert.equal(outcome.model, null);
  // Not a failure: AI was never requested, so there is nothing to report as a fallback.
  assert.equal(outcome.fallbackReason, null);
  assert.equal(outcome.assessments.length, 2);
  assert.ok(outcome.assessments.every((assessment) => assessment.method === 'heuristic'));

  const byId = new Map(outcome.assessments.map((a) => [a.applicantId, a.qualityScore]));
  assert.ok((byId.get('a') ?? 0) > (byId.get('b') ?? 0));
});

test('screening an empty candidate list does not call a provider', async () => {
  let called = false;
  const outcome = await screenJustifications(
    [],
    { programName: '테스트 프로그램', programDescription: null },
    {
      resolveProvider: async () => {
        called = true;
        return null;
      },
    },
  );

  assert.deepEqual(outcome.assessments, []);
  assert.equal(outcome.method, 'heuristic');
  assert.equal(called, false, 'must not resolve a provider when there is nothing to screen');
});

test('a failing AI call degrades to the heuristic and reports why', async () => {
  const outcome = await screenJustifications(
    [{ applicantId: 'a', justification: SINCERE_LONG }],
    { programName: '테스트 프로그램', programDescription: null },
    {
      resolveProvider: async () => ({
        name: 'stub',
        complete: async () => {
          throw new LlmUnavailableError('gateway unreachable');
        },
      }),
    },
  );

  assert.equal(outcome.method, 'heuristic');
  assert.match(outcome.fallbackReason ?? '', /gateway unreachable/);
  // Selection must still receive a usable ranking rather than an error.
  assert.equal(outcome.assessments.length, 1);
  assert.ok((outcome.assessments[0]?.qualityScore ?? 0) > 0);
});

test('an applicant the model omits falls back individually, not the whole run', async () => {
  const outcome = await screenJustifications(
    [
      { applicantId: 'scored', justification: SINCERE_LONG },
      { applicantId: 'omitted', justification: SINCERE_SHORT },
    ],
    { programName: '테스트 프로그램', programDescription: null },
    {
      resolveProvider: async () => ({
        name: 'stub',
        complete: async () => ({
          text: '',
          json: { assessments: [{ applicant_id: 'scored', score: 88, rationale: '구체적입니다.' }] },
          model: 'stub-model',
          inputTokens: null,
          outputTokens: null,
        }),
      }),
    },
  );

  assert.equal(outcome.method, 'ai');
  assert.equal(outcome.model, 'stub-model');

  const byId = new Map(outcome.assessments.map((a) => [a.applicantId, a]));
  assert.equal(byId.get('scored')?.method, 'ai');
  assert.equal(byId.get('scored')?.qualityScore, 88);
  assert.equal(byId.get('omitted')?.method, 'heuristic');
  assert.ok((byId.get('omitted')?.qualityScore ?? 0) > 0);
});

test('an out-of-range AI score is clamped rather than trusted', async () => {
  const outcome = await screenJustifications(
    [
      { applicantId: 'high', justification: SINCERE_LONG },
      { applicantId: 'low', justification: SINCERE_SHORT },
    ],
    { programName: '테스트 프로그램', programDescription: null },
    {
      resolveProvider: async () => ({
        name: 'stub',
        complete: async () => ({
          text: '',
          json: {
            assessments: [
              { applicant_id: 'high', score: 900, rationale: 'x' },
              { applicant_id: 'low', score: -50, rationale: 'y' },
            ],
          },
          model: 'stub-model',
          inputTokens: null,
          outputTokens: null,
        }),
      }),
    },
  );

  const byId = new Map(outcome.assessments.map((a) => [a.applicantId, a.qualityScore]));
  assert.equal(byId.get('high'), 100);
  assert.equal(byId.get('low'), 0);
});
