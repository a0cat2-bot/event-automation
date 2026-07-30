import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeCycleMetrics,
  type CycleAuditRow,
  type CycleProgramRow,
} from './cycleMetrics.js';

const PROGRAM: CycleProgramRow = {
  id: 'p1',
  name: '테스트 프로그램',
  applicant_count: '30',
  participant_count: '20',
  letters_generated: '20',
};

const BASE = new Date('2026-08-01T09:00:00Z');

/** Minutes after BASE. */
function at(minutes: number): Date {
  return new Date(BASE.getTime() + minutes * 60_000);
}

function audit(action: string, firstMinutes: number, lastMinutes = firstMinutes): CycleAuditRow {
  return {
    program_id: 'p1',
    action,
    occurrences: '1',
    first_at: at(firstMinutes),
    last_at: at(lastMinutes),
  };
}

test('a cycle is only complete once it has both a start and an end', () => {
  const [noEnd] = computeCycleMetrics(
    [PROGRAM],
    [audit('program_created', 0), audit('applicant_import', 10)],
  );
  assert.equal(noEnd?.complete, false);
  assert.equal(noEnd?.totalMinutes, null);

  const [noStart] = computeCycleMetrics([PROGRAM], [audit('report_generated', 60)]);
  assert.equal(noStart?.complete, false);
  assert.equal(noStart?.totalMinutes, null);

  const [complete] = computeCycleMetrics(
    [PROGRAM],
    [audit('program_created', 0), audit('report_generated', 90)],
  );
  assert.equal(complete?.complete, true);
  assert.equal(complete?.totalMinutes, 90);
});

test('a program with no audit rows reports zeroes rather than failing', () => {
  const [metrics] = computeCycleMetrics([PROGRAM], []);

  assert.equal(metrics?.complete, false);
  assert.equal(metrics?.totalMinutes, null);
  assert.equal(metrics?.handsOnMinutes, null);
  assert.equal(metrics?.startedAt, null);
  assert.ok(metrics?.steps.every((step) => step.occurrences === 0));
});

test('hands-on time caps long gaps so waiting is not counted as work', () => {
  // A realistic cycle: created, applicants uploaded 5 minutes later, then a two-day wait for
  // applications to close, then selection and the rest in one sitting.
  const twoDays = 2 * 24 * 60;
  const [metrics] = computeCycleMetrics(
    [PROGRAM],
    [
      audit('program_created', 0),
      audit('applicant_import', 5),
      audit('participant_selection', twoDays),
      audit('letter_generation_batch', twoDays + 8),
      audit('report_generated', twoDays + 20),
    ],
  );

  // Wall clock spans the whole two days.
  assert.equal(metrics?.totalMinutes, twoDays + 20);

  // Hands-on counts 5 + capped(2 days -> 60) + 8 + 12 = 85.
  assert.equal(metrics?.handsOnMinutes, 85);
  assert.ok(
    (metrics?.handsOnMinutes ?? 0) < (metrics?.totalMinutes ?? 0),
    'hands-on must never exceed wall clock',
  );
});

test('step timings are measured from the cycle start', () => {
  const [metrics] = computeCycleMetrics(
    [PROGRAM],
    [audit('program_created', 0), audit('participant_selection', 42), audit('report_generated', 90)],
  );

  const byStep = new Map(metrics?.steps.map((step) => [step.step, step]));
  assert.equal(byStep.get('participant_selection')?.minutesFromStart, 42);
  assert.equal(byStep.get('report_generated')?.minutesFromStart, 90);
  // A step that never ran has no timing rather than a misleading zero.
  assert.equal(byStep.get('gift_selection')?.minutesFromStart, null);
  assert.equal(byStep.get('gift_selection')?.occurrences, 0);
});

test('steps without a recorded start have no elapsed time', () => {
  // Programs created before program_created was logged: steps are still counted, but the app must
  // not invent a start point for them.
  const [metrics] = computeCycleMetrics([PROGRAM], [audit('participant_selection', 42)]);

  const byStep = new Map(metrics?.steps.map((step) => [step.step, step]));
  assert.equal(byStep.get('participant_selection')?.occurrences, 1);
  assert.equal(byStep.get('participant_selection')?.minutesFromStart, null);
  assert.equal(metrics?.handsOnMinutes, null, 'a single step is not a measurable span');
});

test('audit rows for one program never leak into another', () => {
  const other: CycleProgramRow = { ...PROGRAM, id: 'p2', name: '다른 프로그램' };
  const metrics = computeCycleMetrics(
    [PROGRAM, other],
    [
      audit('program_created', 0),
      audit('report_generated', 30),
      { ...audit('program_created', 0), program_id: 'p2' },
    ],
  );

  assert.equal(metrics[0]?.complete, true);
  assert.equal(metrics[0]?.totalMinutes, 30);
  assert.equal(metrics[1]?.complete, false);
});
