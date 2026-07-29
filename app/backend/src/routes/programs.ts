import { randomUUID } from 'node:crypto';

import { Router, type NextFunction, type Request, type Response } from 'express';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../schemas/common.js';
import { programCreateBody, programUpdateBody } from '../schemas/contracts.js';
import { getActorName } from '../utils/actor.js';

interface ProgramRow {
  id: string;
  name: string;
  business_unit: string;
  intake_data: unknown;
  template_version_id: string | null;
  selection_mode: 'first_come_first_served' | 'score' | 'written_justification';
  max_participants: number;
  requires_approval: boolean;
  status: 'planning' | 'recruitment_active' | 'selection_in_progress' | 'completed';
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  deleted_at: Date | null;
  applicant_count: number;
  participant_count: number;
  notified_count: number;
  survey_completed_count: number;
  gift_recipient_count: number;
  has_report: boolean;
}

// Shared between the GET and PUT handlers below so the two never drift on how a count is
// computed (e.g. which rows count as an "active" participant).
const programCountColumns = `
       (SELECT COUNT(*)::int FROM applicants a WHERE a.program_id = p.id) AS applicant_count,
       (SELECT COUNT(*)::int FROM participants pt
          WHERE pt.program_id = p.id AND pt.deselected_at IS NULL) AS participant_count,
       (SELECT COUNT(*)::int FROM participants pt
          WHERE pt.program_id = p.id AND pt.deselected_at IS NULL
            AND pt.notification_status = 'sent') AS notified_count,
       (SELECT COUNT(*)::int FROM participants pt
          WHERE pt.program_id = p.id AND pt.deselected_at IS NULL
            AND pt.survey_status = 'completed') AS survey_completed_count,
       (SELECT COUNT(*)::int FROM gift_recipients gr WHERE gr.program_id = p.id)
         AS gift_recipient_count,
       EXISTS(SELECT 1 FROM results_reports rr WHERE rr.program_id = p.id) AS has_report`;

const programWithCountsSelect = `SELECT p.*,
       bu.name AS business_unit,
${programCountColumns}
FROM programs p
JOIN business_units bu ON bu.id = p.business_unit_id`;

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23503'
  );
}

export const programsRouter = Router();

programsRouter.post(
  '/programs',
  validate({ body: programCreateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const program = programCreateBody.parse(request.body);
      const result = await pool.query<ProgramRow>(
        `WITH inserted_program AS (
           INSERT INTO programs
             (id, name, business_unit_id, intake_data, template_version_id, selection_mode,
              max_participants, requires_approval, status, created_by)
           VALUES
             ($1, $2, $3, $4::jsonb, $5, $6::selection_mode, $7,
              COALESCE($8, FALSE),
              COALESCE($9::program_status, 'planning'::program_status), NULL)
           RETURNING *
         )
         SELECT p.*,
                bu.name AS business_unit,
                0::int AS applicant_count,
                0::int AS participant_count,
                0::int AS notified_count,
                0::int AS survey_completed_count,
                0::int AS gift_recipient_count,
                FALSE AS has_report
         FROM inserted_program p
         JOIN business_units bu ON bu.id = p.business_unit_id`,
        [
          randomUUID(),
          program.name,
          program.business_unit_id,
          program.intake_data === undefined ? null : JSON.stringify(program.intake_data),
          program.template_version_id ?? null,
          program.selection_mode,
          program.max_participants,
          program.requires_approval ?? false,
          program.status ?? null,
        ],
      );

      response.status(201).json({ program: result.rows[0] });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        response.status(400).json({ error: '존재하지 않는 사업부입니다.' });
        return;
      }
      next(error);
    }
  },
);

programsRouter.get(
  '/programs/:id',
  validate({ params: idParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const result = await pool.query<ProgramRow>(
        `${programWithCountsSelect}
         WHERE p.id = $1
           AND p.deleted_at IS NULL
         LIMIT 1`,
        [request.params.id],
      );
      const program = result.rows[0];
      if (!program) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }

      response.json({ program });
    } catch (error) {
      next(error);
    }
  },
);

programsRouter.put(
  '/programs/:id',
  validate({ params: idParams, body: programUpdateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const program = programUpdateBody.parse(request.body);
      const result = await pool.query<ProgramRow>(
        `WITH updated_program AS (
           UPDATE programs
           SET name = COALESCE($2, name),
               business_unit_id = COALESCE($3::uuid, business_unit_id),
               intake_data = COALESCE($4::jsonb, intake_data),
               template_version_id = COALESCE($5::uuid, template_version_id),
               selection_mode = COALESCE($6::selection_mode, selection_mode),
               max_participants = COALESCE($7::int, max_participants),
               status = COALESCE($8::program_status, status),
               requires_approval = COALESCE($9::boolean, requires_approval),
               updated_at = NOW()
           WHERE id = $1
             AND deleted_at IS NULL
           RETURNING *
         )
         SELECT p.*,
                bu.name AS business_unit,
${programCountColumns}
         FROM updated_program p
         JOIN business_units bu ON bu.id = p.business_unit_id`,
        [
          request.params.id,
          program.name ?? null,
          program.business_unit_id ?? null,
          program.intake_data === undefined ? null : JSON.stringify(program.intake_data),
          program.template_version_id ?? null,
          program.selection_mode ?? null,
          program.max_participants ?? null,
          program.status ?? null,
          program.requires_approval ?? null,
        ],
      );
      const updatedProgram = result.rows[0];
      if (!updatedProgram) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }

      response.json({ program: updatedProgram });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        response.status(400).json({ error: '존재하지 않는 사업부입니다.' });
        return;
      }
      next(error);
    }
  },
);

programsRouter.get(
  '/programs',
  async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const result = await pool.query<ProgramRow>(
        `${programWithCountsSelect}
       WHERE p.deleted_at IS NULL
       ORDER BY p.created_at DESC`,
      );
      response.json({ programs: result.rows });
    } catch (error) {
      next(error);
    }
  },
);

programsRouter.delete(
  '/programs/:id',
  validate({ params: idParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const result = await pool.query<{ id: string }>(
        `UPDATE programs
         SET deleted_at = NOW()
         WHERE id = $1
           AND deleted_at IS NULL
         RETURNING id`,
        [request.params.id],
      );
      if (!result.rows[0]) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }

      await pool.query(
        `INSERT INTO audit_logs
           (actor_name, action, entity_type, entity_id, program_id, details, ip_address)
         VALUES ($1, 'program_deleted', 'program', $2, $2, '{}'::jsonb, $3)`,
        [getActorName(request), request.params.id, request.ip || null],
      );

      response.status(200).json({ deleted: true });
    } catch (error) {
      next(error);
    }
  },
);
