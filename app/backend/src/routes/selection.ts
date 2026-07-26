import { randomUUID } from 'node:crypto';

import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { programParams } from '../schemas/common.js';
import { selectionGenerateBody } from '../schemas/contracts.js';
import { getActorName } from '../utils/actor.js';

type SelectionMode = 'first_come_first_served' | 'score' | 'written_justification';
type SelectionGenerateBody = z.infer<typeof selectionGenerateBody>;

interface ProgramRow {
  id: string;
  selection_mode: SelectionMode | null;
  max_participants: number | null;
  requires_approval: boolean;
}

interface ApplicantRow {
  id: string;
  email: string | null;
  name: string | null;
  score: number | null;
  justification: string | null;
  applied_at: Date;
}

interface SelectedApplicant {
  applicant: ApplicantRow;
  reason: string;
}

interface QualityResult {
  qualityScore: number;
  matchedKeywords: string[];
  readabilityGrade: number | null;
}

// Deliberately small and transparent for the MVP's deterministic phase-1 filter.
const wellnessKeywords = [
  'health',
  'exercise',
  'balance',
  'stress',
  'fitness',
  'wellbeing',
  'mindfulness',
  'nutrition',
] as const;

function compareAppliedAt(left: ApplicantRow, right: ApplicantRow): number {
  const difference = new Date(left.applied_at).getTime() - new Date(right.applied_at).getTime();
  return difference || left.id.localeCompare(right.id);
}

// Postgres error code 23503 = foreign_key_violation.
function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23503'
  );
}

function approximateSyllableCount(word: string): number {
  const normalized = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!normalized) return 0;
  if (normalized.length <= 3) return 1;

  const vowelGroups = normalized.match(/[aeiouy]+/g)?.length ?? 1;
  const silentEAdjustment = normalized.endsWith('e') && !normalized.endsWith('le') ? 1 : 0;
  return Math.max(1, vowelGroups - silentEAdjustment);
}

/**
 * Simplified Flesch-Kincaid grade approximation: words and sentence-ending punctuation are
 * counted directly, while syllables are estimated from English vowel groups (with a basic
 * silent-e adjustment). This avoids a heavyweight readability dependency for the MVP.
 */
function approximateFleschKincaidGrade(text: string): number | null {
  const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
  if (words.length === 0) return null;

  const sentenceCount = Math.max(
    1,
    text
      .split(/[.!?]+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean).length,
  );
  const syllableCount = words.reduce((total, word) => total + approximateSyllableCount(word), 0);

  return 0.39 * (words.length / sentenceCount) + 11.8 * (syllableCount / words.length) - 15.59;
}

function justificationQuality(text: string | null): QualityResult {
  const justification = text ?? '';
  const words = new Set((justification.toLowerCase().match(/[a-z]+/g) ?? []).map(String));
  const matchedKeywords = wellnessKeywords.filter((keyword) => words.has(keyword));
  const readabilityGrade = approximateFleschKincaidGrade(justification);
  const lengthBonus = Math.min(justification.length / 500, 1) * 20;
  const keywordBonus = Math.min(matchedKeywords.length * 10, 30);
  const readabilityBonus = readabilityGrade !== null && readabilityGrade < 12 ? 10 : 0;

  return {
    qualityScore: lengthBonus + keywordBonus + readabilityBonus,
    matchedKeywords: [...matchedKeywords],
    readabilityGrade,
  };
}

export const selectionRouter = Router();

selectionRouter.post(
  '/programs/:program_id/selection/generate',
  validate({ params: programParams, body: selectionGenerateBody }),
  async (
    request: Request<{ program_id: string }, unknown, SelectionGenerateBody>,
    response: Response,
    next: NextFunction,
  ) => {
    // TODO(DESIGN.md §6): promote to a real async job queue once applicant volume or algorithm cost requires it.
    // This MVP intentionally computes inline and returns the future-compatible job envelope as completed.
    let client: PoolClient | undefined;
    let transactionStarted = false;

    try {
      client = await pool.connect();
      const programId = request.params.program_id;

      await client.query('BEGIN');
      transactionStarted = true;

      const programResult = await client.query<ProgramRow>(
        `SELECT id, selection_mode, max_participants, requires_approval
         FROM programs
         WHERE id = $1
           AND deleted_at IS NULL
         FOR UPDATE`,
        [programId],
      );
      const program = programResult.rows[0];
      if (!program) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        response.status(404).json({ error: 'Program not found' });
        return;
      }
      if (!program.selection_mode || !program.max_participants || program.max_participants < 1) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        response.status(400).json({
          error: 'Program selection_mode and max_participants must be configured',
        });
        return;
      }
      if (request.body.selection_mode !== program.selection_mode) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        response.status(409).json({
          error: 'Requested selection_mode does not match the program configuration',
          requested_selection_mode: request.body.selection_mode,
          configured_selection_mode: program.selection_mode,
        });
        return;
      }

      const approvedBy = request.body.approved_by?.trim();
      if (!request.body.dry_run && program.requires_approval && !approvedBy) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        response.status(400).json({
          error: '승인자 이름을 입력해야 선정을 확정할 수 있습니다.',
        });
        return;
      }

      const applicantResult = await client.query<ApplicantRow>(
        `SELECT id, email, name, score, justification, applied_at
         FROM applicants
         WHERE program_id = $1`,
        [programId],
      );
      const applicants = applicantResult.rows;
      const applicantsById = new Map(applicants.map((applicant) => [applicant.id, applicant]));

      const existingParticipantResult = await client.query<{ id: string; applicant_id: string }>(
        `SELECT id, applicant_id FROM participants WHERE program_id = $1`,
        [programId],
      );
      const existingParticipantIdByApplicantId = new Map(
        existingParticipantResult.rows.map((row) => [row.applicant_id, row.id]),
      );
      const missingOverrideApplicantIds = [
        ...new Set(
          request.body.override_selections
            .map((override) => override.applicant_id)
            .filter((applicantId) => !applicantsById.has(applicantId)),
        ),
      ];
      if (missingOverrideApplicantIds.length > 0) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        response.status(400).json({
          error: 'Every override applicant must belong to the program',
          invalid_applicant_ids: missingOverrideApplicantIds,
        });
        return;
      }

      const selectedByApplicantId = new Map<string, SelectedApplicant>();
      let candidates: Array<{
        applicant_id: string;
        email: string | null;
        name: string | null;
        justification: string | null;
        applied_at: Date;
        quality_score: number;
        matched_keywords: string[];
        readability_grade: number | null;
      }> = [];

      // Excluded applicants are removed from the candidate pool BEFORE ranking (not just
      // deleted from the result afterward), and forced-includes reserve a slot up front — so
      // when a coordinator excludes someone, the next-ranked applicant automatically backfills
      // the freed slot instead of the selection simply shrinking below max_participants.
      const exclusionReasonByApplicantId = new Map(
        request.body.override_selections
          .filter((override) => !override.selected)
          .map((override) => [override.applicant_id, override.reason]),
      );
      const forcedIncludes = request.body.override_selections.filter(
        (override) => override.selected,
      );
      const forcedIncludeIds = new Set(forcedIncludes.map((override) => override.applicant_id));
      const eligibleApplicants = applicants.filter(
        (applicant) =>
          !exclusionReasonByApplicantId.has(applicant.id) && !forcedIncludeIds.has(applicant.id),
      );
      const remainingSlots = Math.max(0, program.max_participants - forcedIncludes.length);

      if (program.selection_mode === 'first_come_first_served') {
        const algorithmicSelection = [...eligibleApplicants]
          .sort(compareAppliedAt)
          .slice(0, remainingSlots);
        for (const applicant of algorithmicSelection) {
          selectedByApplicantId.set(applicant.id, {
            applicant,
            reason: 'First Come, First Served',
          });
        }
      } else if (program.selection_mode === 'score') {
        const algorithmicSelection = [...eligibleApplicants]
          .sort((left, right) => {
            const leftScore = left.score ?? Number.NEGATIVE_INFINITY;
            const rightScore = right.score ?? Number.NEGATIVE_INFINITY;
            return rightScore - leftScore || compareAppliedAt(left, right);
          })
          .slice(0, remainingSlots);
        for (const applicant of algorithmicSelection) {
          selectedByApplicantId.set(applicant.id, {
            applicant,
            reason: `Score: ${applicant.score ?? 'null'}`,
          });
        }
      } else {
        // §6 fixes phase-1 at exactly 3x max_participants. The request's threshold and
        // multiplier remain accepted only for forward API compatibility in this pass.
        candidates = eligibleApplicants
          .map((applicant) => ({
            applicant,
            quality: justificationQuality(applicant.justification),
          }))
          .sort(
            (left, right) =>
              right.quality.qualityScore - left.quality.qualityScore ||
              compareAppliedAt(left.applicant, right.applicant),
          )
          .slice(0, 3 * program.max_participants)
          .map(({ applicant, quality }) => ({
            applicant_id: applicant.id,
            email: applicant.email,
            name: applicant.name,
            justification: applicant.justification,
            applied_at: applicant.applied_at,
            quality_score: quality.qualityScore,
            matched_keywords: quality.matchedKeywords,
            readability_grade: quality.readabilityGrade,
          }));
      }

      // Forced includes (selected:true overrides) always get a seat, regardless of rank —
      // applied last so their custom reason always wins for duplicate applicant IDs.
      for (const override of forcedIncludes) {
        const applicant = applicantsById.get(override.applicant_id);
        if (!applicant) throw new Error('Validated override applicant unexpectedly missing');
        selectedByApplicantId.set(override.applicant_id, {
          applicant,
          reason: override.reason,
        });
      }

      const selected = [...selectedByApplicantId.values()];
      // Reuse the existing participant row's id for anyone who stays selected across a re-run,
      // rather than always minting a new one — otherwise re-running selection after any
      // downstream data exists (survey results, gift recipients) fails on a foreign-key
      // violation when the old row is deleted out from under it.
      const selectedParticipants = selected.map((selection, index) => ({
        participant_id:
          existingParticipantIdByApplicantId.get(selection.applicant.id) ?? randomUUID(),
        applicant_id: selection.applicant.id,
        selection_rank: index + 1,
        selection_reason: selection.reason,
      }));

      if (request.body.dry_run) {
        // Preview only: a coordinator can review who would be selected (and why) before
        // committing, so nothing is written and the row lock taken above is simply released.
        await client.query('ROLLBACK');
        transactionStarted = false;

        const completedAt = new Date().toISOString();
        response.json({
          job_id: randomUUID(),
          status: 'preview',
          dry_run: true,
          estimated_completion_time: completedAt,
          selected_participants: selectedParticipants,
          total_selected: selectedParticipants.length,
          completed_at: completedAt,
          ...(program.selection_mode === 'written_justification' ? { candidates } : {}),
        });
        return;
      }

      // Re-runs transactionally replace the prior selection, but only remove participants who are
      // no longer selected and upsert the rest in place (see the participant_id reuse above) so
      // existing survey/gift/notification progress for people who remain selected is untouched.
      const selectedApplicantIds = new Set(
        selectedParticipants.map((participant) => participant.applicant_id),
      );
      const removedParticipants = existingParticipantResult.rows.filter(
        (row) => !selectedApplicantIds.has(row.applicant_id),
      );

      if (removedParticipants.length > 0) {
        const removedParticipantIds = removedParticipants.map((row) => row.id);
        // Anyone who already has a survey result or gift selection can't be hard-deleted — the
        // row is kept and marked deselected instead, so that history stays intact and re-running
        // selection later doesn't hit a foreign-key violation (see isForeignKeyViolation below,
        // kept as a defensive fallback for any FK this pass doesn't know about).
        const historyResult = await client.query<{ participant_id: string }>(
          `SELECT participant_id FROM survey_results WHERE participant_id = ANY($1::uuid[])
           UNION
           SELECT participant_id FROM gift_recipients WHERE participant_id = ANY($1::uuid[])`,
          [removedParticipantIds],
        );
        const participantIdsWithHistory = new Set(
          historyResult.rows.map((row) => row.participant_id),
        );
        const hardDeleteIds = removedParticipantIds.filter(
          (id) => !participantIdsWithHistory.has(id),
        );
        const softDeselect = removedParticipants.filter((row) =>
          participantIdsWithHistory.has(row.id),
        );

        if (hardDeleteIds.length > 0) {
          try {
            await client.query('DELETE FROM participants WHERE id = ANY($1::uuid[])', [
              hardDeleteIds,
            ]);
          } catch (deleteError) {
            if (isForeignKeyViolation(deleteError)) {
              await client.query('ROLLBACK');
              transactionStarted = false;
              response.status(409).json({
                error:
                  'Cannot exclude one or more participants — they already have recorded survey results or gift selections',
              });
              return;
            }
            throw deleteError;
          }
        }

        if (softDeselect.length > 0) {
          await client.query(
            `UPDATE participants
             SET deselected_at = NOW(), deselection_reason = deselection.reason, updated_at = NOW()
             FROM UNNEST($1::uuid[], $2::varchar[]) AS deselection(id, reason)
             WHERE participants.id = deselection.id`,
            [
              softDeselect.map((row) => row.id),
              softDeselect.map(
                (row) =>
                  exclusionReasonByApplicantId.get(row.applicant_id) ??
                  '재선정으로 다음 순위 신청자로 대체됨',
              ),
            ],
          );
        }
      }

      if (selectedParticipants.length > 0) {
        await client.query(
          `INSERT INTO participants
             (id, program_id, applicant_id, selection_rank, selection_reason)
           SELECT inserted.id, $1, inserted.applicant_id, inserted.selection_rank,
                  inserted.selection_reason
           FROM UNNEST($2::uuid[], $3::uuid[], $4::int[], $5::varchar[]) AS inserted(
             id, applicant_id, selection_rank, selection_reason
           )
           ON CONFLICT (id) DO UPDATE SET
             selection_rank = EXCLUDED.selection_rank,
             selection_reason = EXCLUDED.selection_reason,
             deselected_at = NULL,
             deselection_reason = NULL,
             updated_at = NOW()`,
          [
            programId,
            selectedParticipants.map((participant) => participant.participant_id),
            selectedParticipants.map((participant) => participant.applicant_id),
            selectedParticipants.map((participant) => participant.selection_rank),
            selectedParticipants.map((participant) => participant.selection_reason),
          ],
        );
      }

      await client.query(
        `INSERT INTO audit_logs
           (actor_name, action, entity_type, entity_id, program_id, details, ip_address)
         VALUES ($1, 'participant_selection', 'program', $2, $2, $3::jsonb, $4)`,
        [
          getActorName(request),
          programId,
          JSON.stringify({
            selection_mode: program.selection_mode,
            total_selected: selectedParticipants.length,
            override_count: request.body.override_selections.length,
            ...(approvedBy ? { approved_by: approvedBy } : {}),
          }),
          request.ip || null,
        ],
      );

      await client.query('COMMIT');
      transactionStarted = false;

      const completedAt = new Date().toISOString();
      response.json({
        job_id: randomUUID(),
        status: 'completed',
        dry_run: false,
        estimated_completion_time: completedAt,
        selected_participants: selectedParticipants,
        total_selected: selectedParticipants.length,
        completed_at: completedAt,
        ...(program.selection_mode === 'written_justification' ? { candidates } : {}),
      });
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original transaction error for the central error handler.
        }
      }
      next(error);
    } finally {
      client?.release();
    }
  },
);
