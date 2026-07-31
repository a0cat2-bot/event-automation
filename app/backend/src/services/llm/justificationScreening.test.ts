import assert from 'node:assert/strict';
import test from 'node:test';

import {
  heuristicQuality,
  screenJustifications,
  splitIntoBatches,
} from './justificationScreening.js';
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
          requestId: 'stub-request-id',
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
          requestId: 'stub-request-id',
        }),
      }),
    },
  );

  const byId = new Map(outcome.assessments.map((a) => [a.applicantId, a.qualityScore]));
  assert.equal(byId.get('high'), 100);
  assert.equal(byId.get('low'), 0);
});


/**
 * Batching exists because the internal models cap input at 6,000 tokens — every applicant in one
 * prompt would be rejected outright. These pin the behaviour that matters when a batch goes wrong,
 * since a partial failure must never lose the applicants that were scored successfully.
 */

function candidates(count: number, justificationLength = 100) {
  return Array.from({ length: count }, (_unused, index) => ({
    applicantId: `a${index}`,
    justification: '가'.repeat(justificationLength),
  }));
}

function stubProvider(
  complete: (prompt: string) => Promise<{ assessments: unknown[] }>,
  calls: string[] = [],
) {
  return async () => ({
    name: 'stub',
    complete: async (options: { prompt: string }) => {
      calls.push(options.prompt);
      return {
        text: '',
        json: await complete(options.prompt),
        model: 'aipro-claude-sonnet',
        inputTokens: null,
        outputTokens: null,
        requestId: 'stub-request-id',
      };
    },
  });
}

test('candidates are split so a request stays inside the model input window', () => {
  // 30 applicants at 300 characters each is roughly 9,000 characters — well past a 6,000-token
  // model in one request.
  const batches = splitIntoBatches(candidates(30, 300), { maxChars: 3500, maxCount: 10 });

  assert.ok(batches.length > 1, 'must not send everything in one request');
  for (const batch of batches) {
    const chars = batch.reduce((sum, c) => sum + (c.justification?.length ?? 0) + 60, 0);
    assert.ok(chars <= 3500, `batch of ${chars} chars exceeds the budget`);
    assert.ok(batch.length <= 10);
  }
  // Every applicant appears exactly once across the batches.
  const ids = batches.flat().map((c) => c.applicantId);
  assert.equal(ids.length, 30);
  assert.equal(new Set(ids).size, 30);
});

test('a single oversized justification is still sent rather than dropped', () => {
  const batches = splitIntoBatches(
    [{ applicantId: 'huge', justification: '가'.repeat(9000) }],
    { maxChars: 3500, maxCount: 10 },
  );

  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.[0]?.applicantId, 'huge');
});

test('a failed batch falls back only for its own applicants', async () => {
  let call = 0;
  const resolveProvider = stubProvider(async (prompt) => {
    call += 1;
    if (call === 2) throw new LlmUnavailableError('gateway timeout');
    // Score whichever applicants this batch contains.
    const ids = [...prompt.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    return { assessments: ids.map((id) => ({ applicant_id: id, score: 80, rationale: '구체적' })) };
  });

  const outcome = await screenJustifications(
    candidates(25, 300),
    { programName: 'p', programDescription: null },
    { resolveProvider },
  );

  // Some applicants were scored by AI, so the run is reported as AI-assisted...
  assert.equal(outcome.method, 'ai');
  // ...but the partial degradation is surfaced rather than hidden.
  assert.match(outcome.fallbackReason ?? '', /gateway timeout/);

  const byMethod = outcome.assessments.reduce<Record<string, number>>((acc, a) => {
    acc[a.method] = (acc[a.method] ?? 0) + 1;
    return acc;
  }, {});
  assert.ok((byMethod.ai ?? 0) > 0, 'successful batches must keep their AI scores');
  assert.ok((byMethod.heuristic ?? 0) > 0, 'the failed batch must fall back');
  assert.equal(outcome.assessments.length, 25, 'every applicant is still ranked');
});

test('every batch failing reports a plain heuristic run', async () => {
  const resolveProvider = stubProvider(async () => {
    throw new LlmUnavailableError('gateway unreachable');
  });

  const outcome = await screenJustifications(
    candidates(25, 300),
    { programName: 'p', programDescription: null },
    { resolveProvider },
  );

  assert.equal(outcome.method, 'heuristic');
  assert.equal(outcome.model, null);
  assert.match(outcome.fallbackReason ?? '', /gateway unreachable/);
  assert.ok(outcome.assessments.every((a) => a.method === 'heuristic'));
});

test('a small run still goes out as a single request', async () => {
  const calls: string[] = [];
  const resolveProvider = stubProvider(async (prompt) => {
    const ids = [...prompt.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    return { assessments: ids.map((id) => ({ applicant_id: id, score: 70, rationale: 'ok' })) };
  }, calls);

  await screenJustifications(
    candidates(3, 100),
    { programName: 'p', programDescription: null },
    { resolveProvider },
  );

  assert.equal(calls.length, 1, 'batching must not fragment a run that already fits');
});

test('contact details are stripped from the prompt but still scored by the fallback', async () => {
  const raw = '안전관리에 관심이 많습니다. 연락처는 010-1234-5678, hong@samsung.com 입니다.';
  let promptSeenByModel = '';

  const outcome = await screenJustifications(
    [{ applicantId: 'a1', justification: raw }],
    { programName: '테스트', programDescription: null },
    {
      resolveProvider: async () => ({
        name: 'stub',
        complete: async (options: { prompt: string }) => {
          promptSeenByModel = options.prompt;
          return {
            text: '',
            json: { assessments: [{ applicant_id: 'a1', score: 70, rationale: '구체적임' }] },
            model: 'aipro-claude-sonnet',
            inputTokens: null,
            outputTokens: null,
            requestId: 'req-1',
          };
        },
      }),
    },
  );

  assert.ok(!promptSeenByModel.includes('hong@samsung.com'), 'email must not reach the model');
  assert.ok(!promptSeenByModel.includes('010-1234-5678'), 'phone must not reach the model');
  assert.ok(promptSeenByModel.includes('안전관리에 관심이 많습니다'), 'the substance survives');
  assert.equal(outcome.method, 'ai');

  // The heuristic runs locally on the stored text, so redaction must not reach it — a masked token
  // would change the length and variety signals it scores on.
  const withoutAi = await screenJustifications(
    [{ applicantId: 'a1', justification: raw }],
    { programName: '테스트', programDescription: null },
    { resolveProvider: async () => null },
  );
  assert.equal(
    withoutAi.assessments[0]?.qualityScore,
    heuristicQuality(raw).qualityScore,
    'the fallback scores the unredacted original',
  );
});
