import { readFile } from 'node:fs/promises';

import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { validate } from '../middleware/validate.js';
import { programParams } from '../schemas/common.js';
import {
  sallyImportApplicantsBody,
  sallySessionBody,
  sallySurveyBody,
  sallySurveyDescriptionImageParams,
} from '../schemas/contracts.js';
import {
  removeStagedUpload,
  validationSummary,
  type SelectionMode,
} from '../services/applicantStaging.js';
import {
  connectSallyAccount,
  createSallySurvey,
  downloadSurveyResults,
  SallyConfigurationError,
  SallyCreationError,
  SallyDownloadError,
  SallyLoginError,
  SallySurveyNotFoundError,
  SallyUiMismatchError,
} from '../services/sally.js';
import {
  deleteSallySession,
  getSallySessionStatus,
  SallyConnectionRequiredError,
  SallySessionConfigurationError,
} from '../services/sallySession.js';
import { getEmailProvider } from '../services/email/index.js';
import {
  parseSallyExport,
  parseSallyImport,
  SallyImportParseError,
  stageSallyImport,
} from '../services/sallyImport.js';
import {
  buildSallySurveyDescriptionHtml,
  sallyDescriptionImageHeight,
  sallyDescriptionImageWidth,
} from '../services/sallySurveyDescriptionImage.js';
import { generateSallySurveyDraft } from '../services/sallySurveyDraft.js';
import { getActorName } from '../utils/actor.js';
import { mimeTypeForImagePath, renderLetter } from './letters.js';
import { uploadUrlToFilePath } from '../utils/storage.js';

interface ProgramRow {
  id: string;
  name: string;
  business_unit: string;
  max_participants: number;
  intake_data: unknown;
  selection_mode: SelectionMode | null;
}

interface SallyOrgSettingsRow {
  character_image_url: string | null;
  org_display_name: string;
}

const selectionModes: SelectionMode[] = [
  'first_come_first_served',
  'score',
  'written_justification',
];

async function accessibleProgram(programId: string) {
  const result = await pool.query<ProgramRow>(
    `SELECT p.id, p.name, bu.name AS business_unit, p.max_participants, p.intake_data,
            p.selection_mode
     FROM programs p
     JOIN business_units bu ON bu.id = p.business_unit_id
     WHERE p.id = $1 AND p.deleted_at IS NULL
     LIMIT 1`,
    [programId],
  );
  return result.rows[0];
}

function handleSallyError(response: Response, error: unknown) {
  if (error instanceof SallySessionConfigurationError) {
    response.status(500).json({ error: error.message });
    return true;
  }
  if (error instanceof SallyConfigurationError) {
    response.status(500).json({ error: 'Sally login failed', details: error.message });
    return true;
  }
  if (error instanceof SallyConnectionRequiredError) {
    response.status(409).json({
      error: error.expired
        ? '저장된 Sally 로그인이 만료되었습니다. Sally 계정을 다시 연결해주세요.'
        : 'Sally 계정 연결이 필요합니다. Sally 아이디와 비밀번호로 연결한 뒤 다시 시도하세요.',
      code: 'SALLY_CONNECTION_REQUIRED',
      expired: error.expired,
      stored_at: error.storedAt ?? null,
      last_used_at: error.lastUsedAt ?? null,
    });
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
  if (error instanceof SallyCreationError) {
    response.status(502).json({ error: 'Sally survey creation failed', details: error.message });
    return true;
  }
  if (error instanceof SallyImportParseError) {
    response.status(500).json({ error: 'Sally export parsing failed', details: error.message });
    return true;
  }
  return false;
}

export const sallyRouter = Router();

sallyRouter.get(
  '/sally/session',
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.user) {
        response.status(401).json({ error: 'Sign-in required.' });
        return;
      }
      const status = await getSallySessionStatus(request.user.email);
      response.json({
        connected: status.connected,
        stored_at: status.storedAt,
        last_used_at: status.lastUsedAt,
      });
    } catch (error) {
      if (!handleSallyError(response, error)) next(error);
    }
  },
);

sallyRouter.post(
  '/sally/session',
  validate({ body: sallySessionBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.user) {
        response.status(401).json({ error: 'Sign-in required.' });
        return;
      }
      const body = sallySessionBody.parse(request.body);
      let password = body.password;
      try {
        await connectSallyAccount(request.user.email, { email: body.sally_id, password });
      } finally {
        password = '';
        body.password = '';
        if (request.body && typeof request.body === 'object') request.body.password = '';
      }
      const status = await getSallySessionStatus(request.user.email);
      response.status(201).json({
        connected: status.connected,
        stored_at: status.storedAt,
        last_used_at: status.lastUsedAt,
      });
    } catch (error) {
      if (!handleSallyError(response, error)) next(error);
    }
  },
);

sallyRouter.delete(
  '/sally/session',
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.user) {
        response.status(401).json({ error: 'Sign-in required.' });
        return;
      }
      await deleteSallySession(request.user.email);
      response.json({ connected: false });
    } catch (error) {
      next(error);
    }
  },
);

async function notifySallyUiMismatch(step: string) {
  if (!env.sallyAutomationAdminEmail) return;

  try {
    await getEmailProvider().sendEmail({
      to: env.sallyAutomationAdminEmail,
      subject: '[Sally] 설문 자동 생성 UI 변경 감지',
      html: `<p>Sally UI가 변경되어 설문 자동 생성을 중단했습니다.</p><p>중단 단계: ${step}</p>`,
      text: `Sally UI가 변경되어 설문 자동 생성을 중단했습니다.\n중단 단계: ${step}`,
    });
  } catch {
    // The coordinator still needs the draft even when the optional notification channel is down.
  }
}

sallyRouter.post(
  '/programs/:program_id/sally/surveys/draft',
  validate({ params: programParams, body: sallySurveyBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const program = await accessibleProgram(request.params.program_id as string);
      if (!program) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }

      const { kind } = sallySurveyBody.parse(request.body);
      response.json({ draft: generateSallySurveyDraft(program, kind) });
    } catch (error) {
      next(error);
    }
  },
);

sallyRouter.get(
  '/programs/:program_id/sally/surveys/recruitment',
  validate({ params: programParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const result = await pool.query<{ recruitment_survey_url: string | null }>(
        `SELECT recruitment_survey_url
         FROM programs
         WHERE id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [request.params.program_id],
      );
      const program = result.rows[0];
      if (!program) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }
      response.json({ survey_url: program.recruitment_survey_url });
    } catch (error) {
      next(error);
    }
  },
);

sallyRouter.get(
  '/programs/:program_id/sally/surveys/description-image',
  validate({ params: sallySurveyDescriptionImageParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { program_id: programId } = sallySurveyDescriptionImageParams.parse(request.params);
      const program = await accessibleProgram(programId);
      if (!program) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }

      const settingsResult = await pool.query<SallyOrgSettingsRow>(
        `SELECT character_image_url, org_display_name
         FROM org_settings
         WHERE business_unit IN ($1, '')
         ORDER BY CASE WHEN business_unit = $1 THEN 0 ELSE 1 END
         LIMIT 1`,
        [program.business_unit],
      );
      const settings = settingsResult.rows[0];
      if (!settings) {
        response.status(500).json({ error: 'Organization settings are unavailable' });
        return;
      }

      let characterDataUrl: string | null = null;
      if (settings.character_image_url) {
        const characterPath = uploadUrlToFilePath(settings.character_image_url);
        if (characterPath) {
          try {
            const characterBytes = await readFile(characterPath);
            characterDataUrl = `data:${mimeTypeForImagePath(characterPath)};base64,${characterBytes.toString('base64')}`;
          } catch {
            // Leave the reserved character space empty when the configured file is unavailable.
          }
        }
      }

      const html = buildSallySurveyDescriptionHtml({
        program,
        orgDisplayName: settings.org_display_name,
        characterDataUrl,
      });
      const image = await renderLetter(
        html,
        sallyDescriptionImageWidth,
        sallyDescriptionImageHeight,
        'image',
      );
      response.type('png');
      response.setHeader('Content-Length', String(image.byteLength));
      response.setHeader('Content-Disposition', `inline; filename="DESCRIPTION_${programId}.png"`);
      response.send(image);
    } catch (error) {
      next(error);
    }
  },
);

sallyRouter.post(
  '/programs/:program_id/sally/surveys/create',
  validate({ params: programParams, body: sallySurveyBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const program = await accessibleProgram(programId);
      if (!program) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }

      const { kind } = sallySurveyBody.parse(request.body);
      const draft = generateSallySurveyDraft(program, kind);
      try {
        const surveyUrl = await createSallySurvey(request.user!.email, draft);
        if (kind === 'recruitment') {
          await pool.query(
            `UPDATE programs
             SET recruitment_survey_url = $2, updated_at = NOW()
             WHERE id = $1`,
            [programId, surveyUrl],
          );
        }

        await pool.query(
          `INSERT INTO audit_logs
             (actor_name, action, entity_type, entity_id, program_id, details, ip_address)
           VALUES ($1, 'sally_survey_created', 'program', $2, $2, $3::jsonb, $4)`,
          [
            getActorName(request),
            programId,
            JSON.stringify({ kind, survey_title: draft.title, survey_url: surveyUrl }),
            request.ip || null,
          ],
        );

        response.status(201).json({
          draft,
          created: true,
          automation_available: true,
          survey_url: surveyUrl,
        });
        return;
      } catch (error) {
        if (!(error instanceof SallyUiMismatchError)) throw error;
        await notifySallyUiMismatch(error.step);
        response.json({
          draft,
          created: false,
          automation_available: false,
          reason: error.message,
        });
        return;
      }
    } catch (error) {
      if (!handleSallyError(response, error)) next(error);
    }
  },
);

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
      const exportPath = await downloadSurveyResults(request.user!.email, surveyTitle);
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
