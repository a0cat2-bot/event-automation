import assert from 'node:assert/strict';
import test from 'node:test';

import { analyseSurveyVoc, isSubstantive, type VocResponse } from './surveyVoc.js';
import { LlmUnavailableError, type LlmCompletion } from './types.js';

/**
 * The property that matters most here is that a quote is always byte-identical to what the
 * employee submitted. The model is only ever asked for indices, so these tests deliberately have
 * the stub return text-free classifications and then check the assembled output against the input.
 */

const CONTEXT = { programName: '테스트 프로그램' };

function stubClassifier(
  classifications: Array<{ index: number; sentiment: string; keyword: string }>,
) {
  return async () => ({
    name: 'stub',
    complete: async (): Promise<LlmCompletion> => ({
      text: '',
      json: { classifications },
      model: 'aipro-claude-sonnet',
      inputTokens: null,
      outputTokens: null,
      requestId: 'req-voc',
    }),
  });
}

function indexed(texts: string[]): VocResponse[] {
  return texts.map((text, index) => ({ index, text }));
}

test('quotes come from the stored text, never from the model', async () => {
  const texts = ['강사님이 친절하셨습니다', '시간이 짧아 아쉬웠어요'];
  const analysis = await analyseSurveyVoc(indexed(texts), CONTEXT, {
    resolveProvider: stubClassifier([
      { index: 0, sentiment: 'positive', keyword: '강사' },
      { index: 1, sentiment: 'negative', keyword: '시간' },
    ]),
  });

  const quoted = analysis?.groups.flatMap((group) => group.responses) ?? [];
  assert.deepEqual(quoted.sort(), [...texts].sort());
});

test('typos and odd spacing survive untouched', async () => {
  // The skill this implements requires the original be preserved even when malformed.
  const raw = '  강사님이  넘  치녈하셨어요!! ';
  const analysis = await analyseSurveyVoc([{ index: 0, text: raw }], CONTEXT, {
    resolveProvider: stubClassifier([{ index: 0, sentiment: 'positive', keyword: '강사' }]),
  });

  assert.equal(analysis?.groups[0]?.responses[0], raw);
});

test('one response can land in both a positive and an improvement group', async () => {
  const text = '강사님은 좋았는데 장소가 좁았습니다';
  const analysis = await analyseSurveyVoc([{ index: 0, text }], CONTEXT, {
    resolveProvider: stubClassifier([
      { index: 0, sentiment: 'positive', keyword: '강사' },
      { index: 0, sentiment: 'negative', keyword: '장소' },
    ]),
  });

  assert.equal(analysis?.groups.length, 2);
  assert.ok(analysis?.groups.every((group) => group.responses[0] === text));
  // Counted once per group, but only once toward the classified total.
  assert.equal(analysis?.classifiedCount, 1);
});

test('counts reconcile: total = classified + unclassified + excluded', async () => {
  const analysis = await analyseSurveyVoc(
    indexed(['좋았습니다', '없음', '.', '좋아요']),
    CONTEXT,
    // The model classifies only the first; "좋아요" carries no opinion and is left out.
    { resolveProvider: stubClassifier([{ index: 0, sentiment: 'positive', keyword: '만족' }]) },
  );

  assert.equal(analysis?.totalResponses, 4);
  assert.equal(analysis?.excludedCount, 2, '없음 and . are filtered before the call');
  assert.equal(analysis?.analysedCount, 2);
  assert.equal(analysis?.classifiedCount, 1);
});

test('an index the model invents is ignored rather than crashing', async () => {
  const analysis = await analyseSurveyVoc(indexed(['좋았습니다']), CONTEXT, {
    resolveProvider: stubClassifier([
      { index: 0, sentiment: 'positive', keyword: '만족' },
      { index: 99, sentiment: 'negative', keyword: '없는응답' },
    ]),
  });

  assert.equal(analysis?.groups.length, 1);
  assert.equal(analysis?.classifiedCount, 1);
});

test('an unrecognised sentiment is dropped', async () => {
  const analysis = await analyseSurveyVoc(indexed(['좋았습니다', '별로였어요']), CONTEXT, {
    resolveProvider: stubClassifier([
      { index: 0, sentiment: 'positive', keyword: '만족' },
      { index: 1, sentiment: 'neutral', keyword: '보통' },
    ]),
  });

  assert.equal(analysis?.groups.length, 1);
  assert.equal(analysis?.groups[0]?.sentiment, 'positive');
});

test('groups are ordered positive first, then by size', async () => {
  const analysis = await analyseSurveyVoc(indexed(['a', 'b', 'c', 'd']), CONTEXT, {
    resolveProvider: stubClassifier([
      { index: 0, sentiment: 'negative', keyword: '장소' },
      { index: 1, sentiment: 'negative', keyword: '장소' },
      { index: 2, sentiment: 'negative', keyword: '시간' },
      { index: 3, sentiment: 'positive', keyword: '강사' },
    ]),
  });

  assert.deepEqual(
    analysis?.groups.map((group) => [group.sentiment, group.keyword, group.count]),
    [
      ['positive', '강사', 1],
      ['negative', '장소', 2],
      ['negative', '시간', 1],
    ],
  );
});

test('no analysis rather than a partial one when AI is unavailable', async () => {
  // There is no rule-based way to group feedback by theme, so the caller omits the section.
  assert.equal(
    await analyseSurveyVoc(indexed(['좋았습니다']), CONTEXT, { resolveProvider: async () => null }),
    null,
  );

  const failed = await analyseSurveyVoc(indexed(['좋았습니다']), CONTEXT, {
    resolveProvider: async () => ({
      name: 'stub',
      complete: async () => {
        throw new LlmUnavailableError('gateway unreachable');
      },
    }),
  });
  assert.equal(failed, null);
});

test('nothing substantive to analyse yields no analysis and no call', async () => {
  let called = false;
  const analysis = await analyseSurveyVoc(indexed(['.', '없음', '   ']), CONTEXT, {
    resolveProvider: async () => {
      called = true;
      return null;
    },
  });

  assert.equal(analysis, null);
  assert.equal(called, false);
});

test('filler is recognised regardless of surrounding whitespace or case', () => {
  for (const filler of ['.', ' 없음 ', '특이사항 없음', 'N/A', '...', '   ']) {
    assert.equal(isSubstantive(filler), false, `${filler} should be filtered`);
  }
  for (const real of ['좋았습니다', '시간이 짧아요', 'good session']) {
    assert.equal(isSubstantive(real), true, `${real} should be kept`);
  }
});
