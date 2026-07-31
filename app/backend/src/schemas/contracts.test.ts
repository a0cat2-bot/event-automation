import assert from 'node:assert/strict';
import test from 'node:test';

import { selectionGenerateBody } from './contracts.js';

/**
 * `external_assessments` is the one place an outside agent writes numbers that decide who gets
 * ranked for a place. The route trusts whatever survives this schema, so the boundary is pinned
 * here.
 */

const base = {
  selection_mode: 'written_justification' as const,
  quality_score_threshold: 0,
  manual_review_count_multiplier: 3,
  override_selections: [],
};

const applicantId = '11111111-1111-4111-8111-111111111111';

test('a selection request without external assessments is still valid', () => {
  // The in-app path must stay untouched — this field is additive.
  const parsed = selectionGenerateBody.parse(base);
  assert.equal(parsed.external_assessments, undefined);
});

test('agent-supplied scores are accepted with a rationale', () => {
  const parsed = selectionGenerateBody.parse({
    ...base,
    external_assessments: [
      { applicant_id: applicantId, score: 87.5, rationale: '구체적인 현장 경험을 들었습니다.' },
    ],
  });

  assert.equal(parsed.external_assessments?.[0]?.score, 87.5);
});

test('a score outside 0-100 is rejected rather than clamped', () => {
  // Silently clamping would let a malformed agent response distort the ranking without anyone
  // noticing; the coordinator should see the call fail instead.
  for (const score of [-1, 101]) {
    assert.throws(() =>
      selectionGenerateBody.parse({
        ...base,
        external_assessments: [{ applicant_id: applicantId, score, rationale: '근거' }],
      }),
    );
  }
});

test('a score without a rationale is rejected', () => {
  // A number the coordinator cannot review is worse than no number at all.
  assert.throws(() =>
    selectionGenerateBody.parse({
      ...base,
      external_assessments: [{ applicant_id: applicantId, score: 50, rationale: '' }],
    }),
  );
});

test('applicant ids must be UUIDs so scores cannot be attached to invented rows', () => {
  assert.throws(() =>
    selectionGenerateBody.parse({
      ...base,
      external_assessments: [{ applicant_id: 'not-a-uuid', score: 50, rationale: '근거' }],
    }),
  );
});
