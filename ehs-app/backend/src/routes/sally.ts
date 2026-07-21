import { Router, type NextFunction, type Request, type Response } from 'express';

import { pool } from '../db/pool.js';
import { requireRole, type AuthenticatedPrincipal } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { programParams } from '../schemas/common.js';
import { sallyImportApplicantsBody } from '../schemas/contracts.js';
import {
  removeStagedUpload,
  validationSummary,
  type SelectionMode,
} from '../services/applicantStaging.js';
import {
  downloadSurveyResults,
  SallyConfigurationError,
  SallyDownloadError,
  SallyLoginError,
  SallySurveyNotFoundError,
} from '../services/sally.js';
import {
  parseSallyImport,
  SallyImportParseError,
  stageSallyImport,
} from '../services/sallyImport.js';

interface ProgramRow {
  id: string;
  business_unit: string;
  selection_mode: SelectionMode | null;
}

const selectionModes: SelectionMode[] = [
  'first_come_first_served',
  'score',
  'written_justification',
];

function currentUser(request: Request): AuthenticatedPrincipal {
  if (!request.user) throw new Error('Authenticated principal is missing');
  return request.user;
}

async function accessibleProgram(programId: string, user: AuthenticatedPrincipal) {
  const result =
    user.role === 'admin'
      ? await pool.query<ProgramRow>(
          `SELECT id, business_unit, selection_mode
           FROM programs
           WHERE id = $1 AND deleted_at IS NULL
           LIMIT 1`,
          [programId],
        )
      : await pool.query<ProgramRow>(
          `SELECT id, business_unit, selection_mode
           FROM programs
           WHERE id = $1
             AND deleted_at IS NULL
             AND business_unit = ANY($2::text[])
           LIMIT 1`,
          [programId, user.business_units],
        );
  return result.rows[0];
}

function handleSallyError(response: Response, error: unknown) {
  if (error instanceof SallyConfigurationError) {
    response.status(500).json({ error: 'Sally login failed', details: error.message });
    return true;
  }
  if (error instanceof SallyLoginError) {
    response.status(502).json({ error: 'Sally login failed', details: error.message });
    return true;
  }
  if (error instanceof SallySurveyNotFoundError) {
    response.status(502).json({ error: 'Sally survey not found', details: error.message });
    return true;
  }
  if (error instanceof SallyDownloadError) {
    response.status(502).json({ error: 'Sally download failed', details: error.message });
    return true;
  }
  if (error instanceof SallyImportParseError) {
    response.status(500).json({ error: 'Sally export parsing failed', details: error.message });
    return true;
  }
  return false;
}

export const sallyRouter = Router();

sallyRouter.post(
  '/programs/:program_id/sally/import',
  requireRole('admin', 'coordinator'),
  validate({ params: programParams, body: sallyImportApplicantsBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const user = currentUser(request);
      const program = await accessibleProgram(programId, user);
      if (!program) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }
      if (!program.selection_mode || !selectionModes.includes(program.selection_mode)) {
        response.status(400).json({ error: 'Program selection_mode is not configured' });
        return;
      }

      const { survey_title: surveyTitle } = sallyImportApplicantsBody.parse(request.body);
      const exportPath = await downloadSurveyResults(surveyTitle);
      const records = parseSallyImport(exportPath);
      const upload = await stageSallyImport({
        programId,
        selectionMode: program.selection_mode,
        records,
      });

      try {
        await pool.query(
          `INSERT INTO audit_logs
             (user_id, action, entity_type, entity_id, program_id, details, ip_address)
           VALUES ($1, 'sally_import', 'program', $2, $2, $3::jsonb, $4)`,
          [
            user.user_id,
            programId,
            JSON.stringify({ survey_title: surveyTitle, row_count: upload.rows.length }),
            request.ip || null,
          ],
        );
      } catch (error) {
        removeStagedUpload(programId, upload.uploadId);
        throw error;
      }

      response.status(201).json({
        upload_id: upload.uploadId,
        row_count: upload.rows.length,
        validation_summary: validationSummary(upload),
      });
    } catch (error) {
      if (!handleSallyError(response, error)) next(error);
    }
  },
);
