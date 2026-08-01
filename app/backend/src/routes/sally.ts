import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import { pool } from '../db/pool.js';
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
  parseSallyExport,
  parseSallyImport,
  SallyImportParseError,
  stageSallyImport,
} from '../services/sallyImport.js';
import { getActorName } from '../utils/actor.js';

interface ProgramRow {
  id: string;
  selection_mode: SelectionMode | null;
}

const selectionModes: SelectionMode[] = [
  'first_come_first_served',
  'score',
  'written_justification',
];

async function accessibleProgram(programId: string) {
  const result = await pool.query<ProgramRow>(
    `SELECT id, selection_mode
     FROM programs
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [programId],
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
  validate({ params: programParams, body: sallyImportApplicantsBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const program = await accessibleProgram(programId);
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
             (actor_name, action, entity_type, entity_id, program_id, details, ip_address)
           VALUES ($1, 'sally_import', 'program', $2, $2, $3::jsonb, $4)`,
          [
            getActorName(request),
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

/** Sally exports are .xlsx; the same 10 MB ceiling the CSV upload uses. */
const sallyFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

/**
 * Stages applicants from a Sally export the coordinator already has.
 *
 * The sibling route drives a browser to fetch the same file, which needs Sally credentials,
 * network reach, and Sally's own screens to be unchanged. None of that is available when someone
 * simply has the export sitting in their downloads folder, which is how this work usually starts.
 * Both routes end at the same parser and the same staging, so what gets imported is identical.
 */
sallyRouter.post(
  '/programs/:program_id/sally/import/upload',
  validate({ params: programParams }),
  sallyFileUpload.single('file'),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const program = await accessibleProgram(programId);
      if (!program) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }
      if (!program.selection_mode || !selectionModes.includes(program.selection_mode)) {
        response.status(400).json({ error: 'Program selection_mode is not configured' });
        return;
      }

      const file = request.file;
      if (!file) {
        response.status(400).json({ error: 'Sally 엑셀 파일을 선택하세요.' });
        return;
      }

      const records = parseSallyExport(file.buffer);
      const upload = await stageSallyImport({
        programId,
        selectionMode: program.selection_mode,
        records,
      });

      try {
        await pool.query(
          `INSERT INTO audit_logs
             (actor_name, action, entity_type, entity_id, program_id, details, ip_address)
           VALUES ($1, 'sally_import', 'program', $2, $2, $3::jsonb, $4)`,
          [
            getActorName(request),
            programId,
            JSON.stringify({
              source: 'manual_upload',
              filename: file.originalname,
              row_count: upload.rows.length,
            }),
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
