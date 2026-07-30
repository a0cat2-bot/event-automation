import { pool } from '../db/pool.js';

/**
 * Derives how long a program cycle took from the audit trail.
 *
 * Deliberately has no instrumentation of its own: every step already writes an audit row with a
 * timestamp and program_id, so cycle time is a query rather than a second source of truth that
 * could disagree with the audit log.
 *
 * What this measures is elapsed wall-clock time between steps, NOT hands-on effort. A coordinator
 * who uploads applicants on Monday and runs selection on Thursday shows three days here, most of
 * which was waiting for applications. Only `handsOnMinutes` attempts to approximate effort, and it
 * is explicitly a lower bound — see below.
 */

/** Ordered by where they fall in the workflow, which is how the report presents them. */
export const CYCLE_STEPS = [
  'program_created',
  'applicant_import',
  'sally_import',
  'participant_selection',
  'letter_generation_batch',
  'participant_notified',
  'gift_selection',
  'report_generated',
] as const;
export type CycleStep = (typeof CYCLE_STEPS)[number];

export const CYCLE_STEP_LABELS: Record<CycleStep, string> = {
  program_created: '프로그램 생성',
  applicant_import: '신청자 업로드',
  sally_import: '설문 결과 가져오기',
  participant_selection: '참여자 선정',
  letter_generation_batch: '레터 생성',
  participant_notified: '안내 발송',
  gift_selection: '상품 수령자 선정',
  report_generated: '결과 보고서',
};

export interface StepTiming {
  step: CycleStep;
  label: string;
  occurrences: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Minutes from the cycle start to the first occurrence of this step. */
  minutesFromStart: number | null;
}

export interface ProgramCycleMetrics {
  programId: string;
  programName: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Wall-clock minutes from program creation to report generation. Null until both exist. */
  totalMinutes: number | null;
  /**
   * Lower-bound estimate of active work: for each step, the gap from the previous step capped at
   * `HANDS_ON_CAP_MINUTES`. A long gap is treated as waiting (for applications, for survey
   * responses) rather than as effort. Understates any single sitting longer than the cap.
   */
  handsOnMinutes: number | null;
  steps: StepTiming[];
  applicantCount: number;
  participantCount: number;
  lettersGenerated: number;
  /** True once both a start and an end event exist, i.e. a full cycle ran through the app. */
  complete: boolean;
}

/**
 * A gap longer than this is counted as waiting, not work. 60 minutes is generous for any single
 * screen in this app while still excluding overnight and multi-day gaps.
 */
const HANDS_ON_CAP_MINUTES = 60;

export interface CycleAuditRow {
  program_id: string;
  action: string;
  occurrences: string;
  first_at: Date;
  last_at: Date;
}

export interface CycleProgramRow {
  id: string;
  name: string;
  applicant_count: string;
  participant_count: string;
  letters_generated: string;
}

function minutesBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 60_000) * 10) / 10;
}

/**
 * Pure computation, separated from the queries so the derivation can be tested against known
 * timestamps without a database.
 */
export function computeCycleMetrics(
  programs: CycleProgramRow[],
  auditRows: CycleAuditRow[],
): ProgramCycleMetrics[] {
  const auditByProgram = new Map<string, Map<string, CycleAuditRow>>();
  for (const row of auditRows) {
    const byAction = auditByProgram.get(row.program_id) ?? new Map<string, CycleAuditRow>();
    byAction.set(row.action, row);
    auditByProgram.set(row.program_id, byAction);
  }

  return programs.map((program) => {
    const byAction = auditByProgram.get(program.id) ?? new Map<string, CycleAuditRow>();
    const startRow = byAction.get('program_created');
    const endRow = byAction.get('report_generated');

    const steps: StepTiming[] = CYCLE_STEPS.map((step) => {
      const row = byAction.get(step);
      return {
        step,
        label: CYCLE_STEP_LABELS[step],
        occurrences: row ? Number(row.occurrences) : 0,
        firstAt: row?.first_at.toISOString() ?? null,
        lastAt: row?.last_at.toISOString() ?? null,
        minutesFromStart:
          row && startRow ? minutesBetween(startRow.first_at, row.first_at) : null,
      };
    });

    // Walk the steps that actually happened, in time order, capping each gap.
    const occurred = steps
      .filter((step) => step.firstAt !== null)
      .map((step) => ({ step, at: new Date(step.firstAt as string) }))
      .sort((left, right) => left.at.getTime() - right.at.getTime());

    let handsOnMinutes: number | null = null;
    if (occurred.length > 1) {
      handsOnMinutes = 0;
      for (let index = 1; index < occurred.length; index += 1) {
        const gap = minutesBetween(occurred[index - 1]!.at, occurred[index]!.at);
        handsOnMinutes += Math.min(gap, HANDS_ON_CAP_MINUTES);
      }
      handsOnMinutes = Math.round(handsOnMinutes * 10) / 10;
    }

    return {
      programId: program.id,
      programName: program.name,
      startedAt: startRow?.first_at.toISOString() ?? null,
      completedAt: endRow?.last_at.toISOString() ?? null,
      totalMinutes:
        startRow && endRow ? minutesBetween(startRow.first_at, endRow.last_at) : null,
      handsOnMinutes,
      steps,
      applicantCount: Number(program.applicant_count),
      participantCount: Number(program.participant_count),
      lettersGenerated: Number(program.letters_generated),
      complete: Boolean(startRow && endRow),
    };
  });
}

export async function programCycleMetrics(programIds?: string[]): Promise<ProgramCycleMetrics[]> {
  const filter = programIds?.length ? 'AND p.id = ANY($1::uuid[])' : '';
  const params = programIds?.length ? [programIds] : [];

  const programResult = await pool.query<CycleProgramRow>(
    `SELECT p.id, p.name,
            (SELECT COUNT(*) FROM applicants a WHERE a.program_id = p.id) AS applicant_count,
            (SELECT COUNT(*) FROM participants pt
              WHERE pt.program_id = p.id AND pt.deselected_at IS NULL) AS participant_count,
            (SELECT COUNT(*) FROM generated_letters gl
              WHERE gl.program_id = p.id) AS letters_generated
       FROM programs p
      WHERE p.deleted_at IS NULL ${filter}
      ORDER BY p.created_at ASC`,
    params,
  );

  const auditResult = await pool.query<CycleAuditRow>(
    `SELECT program_id, action,
            COUNT(*) AS occurrences,
            MIN(timestamp) AS first_at,
            MAX(timestamp) AS last_at
       FROM audit_logs
      WHERE program_id IS NOT NULL
        AND action = ANY($1::text[])
      GROUP BY program_id, action`,
    [CYCLE_STEPS],
  );

  return computeCycleMetrics(programResult.rows, auditResult.rows);
}
