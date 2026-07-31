import { randomUUID } from 'node:crypto';

import { parse } from 'csv-parse/sync';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { programParams, uploadParams } from '../schemas/common.js';
import { applicantConfirmBody } from '../schemas/contracts.js';
import {
  getStagedUpload,
  removeStagedUpload,
  stageUpload,
  stagedUploadTtlMs,
} from '../services/applicantStaging.js';
import { getActorName } from '../utils/actor.js';
import { redactPersonalData } from '../utils/redaction.js';

type SelectionMode = 'first_come_first_served' | 'score' | 'written_justification';
type IssueType = 'error' | 'warning' | 'duplicate';

interface ProgramRow {
  id: string;
  selection_mode: SelectionMode | null;
  intake_data: unknown;
}

interface ValidationLimits {
  scoreMin: number;
  scoreMax: number;
  justificationMinLength: number;
  justificationMaxLength: number;
}

interface ValidationIssue {
  row_number: number | null;
  type: IssueType;
  code: string;
  message: string;
  field?: string;
}

interface StagedApplicantRow {
  rowNumber: number;
  email: string;
  name: string;
  department: string;
  score: number | null;
  justification: string | null;
  appliedAt: string;
  issues: ValidationIssue[];
}

interface StagedUpload {
  uploadId: string;
  programId: string;
  selectionMode: SelectionMode;
  encoding: 'utf-8' | 'iso-8859-1';
  createdAt: number;
  expiresAt: number;
  rows: StagedApplicantRow[];
  uploadIssues: ValidationIssue[];
}

interface ApplicantCsvRecord {
  [column: string]: string | undefined;
}

interface ConfirmBody {
  action: 'import' | 'discard';
  conflict_resolution: 'skip_duplicates' | 'overwrite';
}

interface ApplicantResultRow {
  id: string;
  program_id: string;
  email: string;
  name: string | null;
  department: string | null;
  score: number | null;
  justification: string | null;
  applied_at: Date;
  created_at: Date;
  updated_at: Date;
}

const previewQuery = z.object({
  status: z.enum(['all', 'errors', 'warnings', 'duplicates']).default('all'),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(50).default(50),
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const maximumRecommendedRows = 5_000;
const selectionModes: SelectionMode[] = [
  'first_come_first_served',
  'score',
  'written_justification',
];
const basicEmailPattern =
  /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const applicantParams = programParams.extend({ applicant_id: z.string().uuid() });
const applicantBody = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().min(1).max(255).regex(basicEmailPattern),
  department: z.string().trim().min(1).max(100),
  applied_at: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: 'applied_at must be a valid date-time',
    }),
  score: z.number().int().optional(),
  justification: z.string().trim().optional(),
});
const applicantUpdateBody = applicantBody.partial().refine(
  (body) => Object.keys(body).length > 0,
  { message: 'At least one field must be supplied' },
);
type ApplicantBody = z.infer<typeof applicantBody>;

function validateSelectionFields(
  body: Partial<ApplicantBody>,
  selectionMode: SelectionMode,
  limits: ValidationLimits,
  context: z.RefinementCtx,
  requireSelectionField: boolean,
) {
  if (selectionMode === 'score') {
    if (requireSelectionField && body.score === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score'],
        message: 'score is required',
      });
    } else if (
      body.score !== undefined &&
      (body.score < limits.scoreMin || body.score > limits.scoreMax)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score'],
        message: `score must be between ${limits.scoreMin} and ${limits.scoreMax}`,
      });
    }
  }

  if (selectionMode === 'written_justification') {
    if (requireSelectionField && !body.justification) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['justification'],
        message: 'justification is required',
      });
    } else if (
      body.justification !== undefined &&
      (body.justification.length < limits.justificationMinLength ||
        body.justification.length > limits.justificationMaxLength)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['justification'],
        message: `justification must be between ${limits.justificationMinLength} and ${limits.justificationMaxLength} characters`,
      });
    }
  }
}

function applicantCreateSchema(selectionMode: SelectionMode, limits: ValidationLimits) {
  return applicantBody.superRefine((body, context) => {
    validateSelectionFields(body, selectionMode, limits, context, true);
  });
}

function applicantEditSchema(selectionMode: SelectionMode, limits: ValidationLimits) {
  return applicantUpdateBody.superRefine((body, context) => {
    validateSelectionFields(body, selectionMode, limits, context, false);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configuredNumber(
  configuration: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = configuration[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function validationLimits(intakeData: unknown): ValidationLimits {
  const intake = isRecord(intakeData) ? intakeData : {};
  const nested = isRecord(intake.applicant_validation)
    ? intake.applicant_validation
    : isRecord(intake.validation)
      ? intake.validation
      : intake;

  const configuredScoreMin = configuredNumber(nested, 'score_min', 0);
  const configuredScoreMax = configuredNumber(nested, 'score_max', 100);
  const configuredJustificationMin = configuredNumber(nested, 'justification_min_length', 10);
  const configuredJustificationMax = configuredNumber(nested, 'justification_max_length', 500);

  const scoreMin = Number.isInteger(configuredScoreMin) ? configuredScoreMin : 0;
  const scoreMax =
    Number.isInteger(configuredScoreMax) && configuredScoreMax >= scoreMin
      ? configuredScoreMax
      : Math.max(100, scoreMin);
  const justificationMinLength =
    Number.isInteger(configuredJustificationMin) && configuredJustificationMin >= 0
      ? configuredJustificationMin
      : 10;
  const justificationMaxLength =
    Number.isInteger(configuredJustificationMax) &&
    configuredJustificationMax >= justificationMinLength
      ? configuredJustificationMax
      : Math.max(500, justificationMinLength);

  return { scoreMin, scoreMax, justificationMinLength, justificationMaxLength };
}

function decodeCsv(buffer: Buffer): { text: string; encoding: StagedUpload['encoding'] } {
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
      encoding: 'utf-8',
    };
  } catch {
    return {
      text: new TextDecoder('iso-8859-1').decode(buffer),
      encoding: 'iso-8859-1',
    };
  }
}

function parseCsv(buffer: Buffer) {
  const decoded = decodeCsv(buffer);
  const records = parse(decoded.text, {
    bom: true,
    columns: (headers: string[]) => headers.map((header) => header.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
  }) as ApplicantCsvRecord[];

  return { ...decoded, records };
}

function addIssue(
  row: StagedApplicantRow,
  type: IssueType,
  code: string,
  message: string,
  field?: string,
) {
  row.issues.push({ row_number: row.rowNumber, type, code, message, field });
}

function requiredField(row: StagedApplicantRow, value: string, field: string, label = field) {
  if (!value) {
    addIssue(row, 'error', 'required', `${label} is required`, field);
  }
}

function parseApplicantRows(
  records: ApplicantCsvRecord[],
  selectionMode: SelectionMode,
  limits: ValidationLimits,
  uploadTime: number,
) {
  const rows = records.map<StagedApplicantRow>((record, index) => {
    const email = (record.email ?? '').trim();
    const name = (record.name ?? '').trim();
    const department = (record.department ?? '').trim();
    const rawScore = (record.score ?? '').trim();
    const rawJustification = (record.justification ?? '').trim();
    const rawAppliedAt = (record.applied_at ?? '').trim();
    // §5 does not make applied_at required; preserve CSV order with upload-time defaults.
    const fallbackAppliedAt = new Date(uploadTime + index).toISOString();
    const parsedAppliedAt = rawAppliedAt ? new Date(rawAppliedAt) : new Date(fallbackAppliedAt);

    const row: StagedApplicantRow = {
      rowNumber: index + 2,
      email,
      name,
      department,
      score: null,
      justification: rawJustification || null,
      appliedAt: Number.isNaN(parsedAppliedAt.getTime())
        ? fallbackAppliedAt
        : parsedAppliedAt.toISOString(),
      issues: [],
    };

    requiredField(row, name, 'name');
    requiredField(row, email, 'email');
    requiredField(row, department, 'department');

    if (name.length > 255) {
      addIssue(row, 'error', 'too_long', 'name must be at most 255 characters', 'name');
    }
    if (email.length > 255) {
      addIssue(row, 'error', 'too_long', 'email must be at most 255 characters', 'email');
    } else if (email && !basicEmailPattern.test(email)) {
      addIssue(row, 'error', 'invalid_email', 'email is not a valid email address', 'email');
    }
    if (department.length > 100) {
      addIssue(row, 'error', 'too_long', 'department must be at most 100 characters', 'department');
    }

    if (selectionMode === 'score') {
      requiredField(row, rawScore, 'score');
      if (rawScore) {
        if (!/^-?\d+$/.test(rawScore)) {
          addIssue(row, 'error', 'invalid_score', 'score must be an integer', 'score');
        } else {
          const score = Number(rawScore);
          if (!Number.isSafeInteger(score)) {
            addIssue(row, 'error', 'invalid_score', 'score must be an integer', 'score');
          } else {
            row.score = score;
            if (score < limits.scoreMin || score > limits.scoreMax) {
              addIssue(
                row,
                'error',
                'score_out_of_range',
                `score must be between ${limits.scoreMin} and ${limits.scoreMax}`,
                'score',
              );
            }
          }
        }
      }
    }

    if (selectionMode === 'written_justification') {
      requiredField(row, rawJustification, 'justification');
      if (
        rawJustification &&
        (rawJustification.length < limits.justificationMinLength ||
          rawJustification.length > limits.justificationMaxLength)
      ) {
        addIssue(
          row,
          'error',
          'justification_length',
          `justification must be between ${limits.justificationMinLength} and ${limits.justificationMaxLength} characters`,
          'justification',
        );
      }
    }

    if (rawAppliedAt && Number.isNaN(parsedAppliedAt.getTime())) {
      addIssue(
        row,
        'error',
        'invalid_applied_at',
        'applied_at must be a valid date-time',
        'applied_at',
      );
    }

    return row;
  });

  // Email identifies an applicant, and is compared case-insensitively to match the database's
  // unique index on (program_id, LOWER(email)).
  const firstRowByEmail = new Map<string, number>();
  for (const row of rows) {
    if (!row.email) continue;
    const key = row.email.toLowerCase();
    const firstRow = firstRowByEmail.get(key);
    if (firstRow === undefined) {
      firstRowByEmail.set(key, row.rowNumber);
    } else {
      addIssue(
        row,
        'duplicate',
        'duplicate_in_upload',
        `email duplicates row ${firstRow} in this upload`,
        'email',
      );
    }
  }

  return rows;
}

function validationSummary(upload: Pick<StagedUpload, 'rows' | 'uploadIssues'>) {
  return {
    errors: upload.rows.filter((row) => row.issues.some((issue) => issue.type === 'error')).length,
    warnings:
      upload.uploadIssues.filter((issue) => issue.type === 'warning').length +
      upload.rows.filter((row) => row.issues.some((issue) => issue.type === 'warning')).length,
    duplicates_count: upload.rows.filter((row) =>
      row.issues.some((issue) => issue.type === 'duplicate'),
    ).length,
  };
}

function previewStatus(row: StagedApplicantRow) {
  if (row.issues.some((issue) => issue.type === 'error')) return 'errors';
  if (row.issues.some((issue) => issue.type === 'duplicate')) return 'duplicates';
  if (row.issues.some((issue) => issue.type === 'warning')) return 'warnings';
  return 'valid';
}

function rowMatchesStatus(
  row: StagedApplicantRow,
  status: 'all' | 'errors' | 'warnings' | 'duplicates',
) {
  if (status === 'all') return true;
  const issueType: IssueType = status === 'errors' ? 'error' : (status.slice(0, -1) as IssueType);
  return row.issues.some((issue) => issue.type === issueType);
}

function previewRow(row: StagedApplicantRow) {
  return {
    row_number: row.rowNumber,
    name: row.name,
    email: row.email,
    department: row.department,
    score: row.score,
    justification: row.justification,
    applied_at: row.appliedAt,
    status: previewStatus(row),
    issues: row.issues,
  };
}

async function accessibleProgram(programId: string) {
  const result = await pool.query<ProgramRow>(
    `SELECT id, selection_mode, intake_data
     FROM programs
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [programId],
  );

  return result.rows[0];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown database error';
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

export const applicantsRouter = Router();

applicantsRouter.post(
  '/programs/:program_id/applicants/upload',
  validate({ params: programParams }),
  csvUpload.single('csv_file'),
  (request, response, next) => {
    if (!request.file) {
      response.status(400).json({ error: 'Multipart field csv_file is required' });
      return;
    }
    next();
  },
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

      let parsed: ReturnType<typeof parseCsv>;
      try {
        parsed = parseCsv(request.file!.buffer);
      } catch (error) {
        response.status(400).json({
          error: 'CSV parsing failed',
          details: errorMessage(error),
        });
        return;
      }

      const createdAt = Date.now();
      const rows = parseApplicantRows(
        parsed.records,
        program.selection_mode,
        validationLimits(program.intake_data),
        createdAt,
      );
      const emails = [...new Set(rows.map((row) => row.email.toLowerCase()).filter(Boolean))];
      if (emails.length > 0) {
        const duplicateResult = await pool.query<{ email: string }>(
          `SELECT LOWER(email) AS email
           FROM applicants
           WHERE program_id = $1 AND LOWER(email) = ANY($2::text[])`,
          [programId, emails],
        );
        const committedEmails = new Set(duplicateResult.rows.map((row) => row.email));
        for (const row of rows) {
          if (committedEmails.has(row.email.toLowerCase())) {
            addIssue(
              row,
              'duplicate',
              'duplicate_existing_applicant',
              'email already exists for this program',
              'email',
            );
          }
        }
      }

      const uploadIssues: ValidationIssue[] = [];
      if (rows.length > maximumRecommendedRows) {
        uploadIssues.push({
          row_number: null,
          type: 'warning',
          code: 'row_limit_exceeded',
          message: `Upload contains more than the recommended ${maximumRecommendedRows} rows`,
        });
      }

      const upload: StagedUpload = {
        uploadId: randomUUID(),
        programId,
        selectionMode: program.selection_mode,
        encoding: parsed.encoding,
        createdAt,
        expiresAt: createdAt + stagedUploadTtlMs,
        rows,
        uploadIssues,
      };
      stageUpload(upload);

      response.status(201).json({
        upload_id: upload.uploadId,
        row_count: rows.length,
        validation_summary: validationSummary(upload),
      });
    } catch (error) {
      next(error);
    }
  },
);

applicantsRouter.get(
  '/programs/:program_id/applicants/upload/:upload_id/preview',
  validate({ params: uploadParams, query: previewQuery }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const uploadId = request.params.upload_id as string;
      const program = await accessibleProgram(programId);
      const upload = getStagedUpload(programId, uploadId);
      if (!program || !upload) {
        response.status(404).json({ error: 'Upload not found' });
        return;
      }

      const query = previewQuery.parse(request.query);
      const filteredRows = upload.rows.filter((row) => rowMatchesStatus(row, query.status));
      const start = (query.page - 1) * query.page_size;
      const pageRows = filteredRows.slice(start, start + query.page_size);
      const issueType =
        query.status === 'all'
          ? null
          : query.status === 'errors'
            ? 'error'
            : query.status.slice(0, -1);
      const allIssues = [
        ...upload.uploadIssues,
        ...filteredRows.flatMap((row) => row.issues),
      ].filter((issue) => issueType === null || issue.type === issueType);

      response.json({
        upload_id: upload.uploadId,
        row_count: upload.rows.length,
        selection_mode: upload.selectionMode,
        encoding: upload.encoding,
        validation_summary: validationSummary(upload),
        page: query.page,
        page_size: query.page_size,
        total_rows: filteredRows.length,
        total_pages: Math.ceil(filteredRows.length / query.page_size),
        rows: pageRows.map(previewRow),
        validation_issues: allIssues,
      });
    } catch (error) {
      next(error);
    }
  },
);

applicantsRouter.post(
  '/programs/:program_id/applicants/upload/:upload_id/confirm',
  validate({ params: uploadParams, body: applicantConfirmBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const uploadId = request.params.upload_id as string;
      const program = await accessibleProgram(programId);
      const upload = getStagedUpload(programId, uploadId);
      if (!program || !upload) {
        response.status(404).json({ error: 'Upload not found' });
        return;
      }

      const body = request.body as ConfirmBody;
      if (body.action === 'discard') {
        removeStagedUpload(programId, uploadId);
        response.json({ discarded: true });
        return;
      }

      const validRows = upload.rows.filter(
        (row) => !row.issues.some((issue) => issue.type === 'error'),
      );
      const invalidRowCount = upload.rows.length - validRows.length;
      const failedCount = 0;
      const client = await pool.connect();
      let importedCount = 0;
      let skippedCount = invalidRowCount;
      let failedRow: StagedApplicantRow | null = null;
      let failedPhase = 'applicant';

      try {
        await client.query('BEGIN');
        for (const row of validRows) {
          failedRow = row;
          const values = [
            randomUUID(),
            programId,
            row.email,
            row.name,
            row.department || null,
            row.score,
            row.justification,
            row.appliedAt,
          ];

          // The conflict target matches the unique index applicants_program_email_key, which is
          // on the LOWER(email) expression rather than the column.
          if (body.conflict_resolution === 'skip_duplicates') {
            const result = await client.query(
              `INSERT INTO applicants
                 (id, program_id, email, name, department, score, justification, applied_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (program_id, LOWER(email)) DO NOTHING
               RETURNING id`,
              values,
            );
            if (result.rowCount === 0) skippedCount += 1;
            else importedCount += 1;
          } else {
            await client.query(
              `INSERT INTO applicants
                 (id, program_id, email, name, department, score, justification, applied_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (program_id, LOWER(email)) DO UPDATE SET
                 email = EXCLUDED.email,
                 name = EXCLUDED.name,
                 department = EXCLUDED.department,
                 score = EXCLUDED.score,
                 justification = EXCLUDED.justification,
                 applied_at = EXCLUDED.applied_at,
                 updated_at = NOW()`,
              values,
            );
            importedCount += 1;
          }
        }

        failedRow = null;
        failedPhase = 'audit';
        await client.query(
          `INSERT INTO audit_logs
             (actor_name, action, entity_type, entity_id, program_id, details, ip_address)
           VALUES ($1, 'applicant_import', 'program', $2, $2, $3::jsonb, $4)`,
          [
            getActorName(request),
            programId,
            JSON.stringify({
              upload_id: uploadId,
              row_count: upload.rows.length,
              imported_count: importedCount,
              skipped_count: skippedCount,
              failed_count: failedCount,
              invalid_row_count: invalidRowCount,
              conflict_resolution: body.conflict_resolution,
            }),
            request.ip || null,
          ],
        );
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original transaction failure in the response.
        }
        response.status(500).json({
          error: 'Applicant import failed; no rows were committed',
          failed_row: failedRow
            ? { row_number: failedRow.rowNumber, email: failedRow.email }
            : null,
          phase: failedPhase,
          details: errorMessage(error),
        });
        return;
      } finally {
        client.release();
      }

      removeStagedUpload(programId, uploadId);
      response.json({
        imported_count: importedCount,
        skipped_count: skippedCount,
        failed_count: failedCount,
      });
    } catch (error) {
      next(error);
    }
  },
);

const applicantListQuery = z.object({
  // Set by the MCP server, which hands these rows to an AI client. The coordinator's own screen
  // never sets it, because a coordinator is entitled to read exactly what the applicant wrote.
  redact_free_text: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

applicantsRouter.get(
  '/programs/:program_id/applicants',
  validate({ params: programParams, query: applicantListQuery }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const program = await accessibleProgram(programId);
      if (!program) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }

      const { redact_free_text: redactFreeText } = applicantListQuery.parse(request.query);
      const result = await pool.query<ApplicantResultRow>(
        `SELECT id, program_id, email, name, department, score,
                justification, applied_at, created_at, updated_at
         FROM applicants
         WHERE program_id = $1
         ORDER BY applied_at ASC, id ASC`,
        [programId],
      );

      const applicants = redactFreeText
        ? result.rows.map((row) => ({
            ...row,
            justification: row.justification ? redactPersonalData(row.justification) : row.justification,
          }))
        : result.rows;
      response.json({ applicants });
    } catch (error) {
      next(error);
    }
  },
);

applicantsRouter.post(
  '/programs/:program_id/applicants',
  validate({ params: programParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const program = await accessibleProgram(programId);
      if (!program) {
        response.status(404).json({ error: '프로그램을 찾을 수 없습니다.' });
        return;
      }
      if (!program.selection_mode || !selectionModes.includes(program.selection_mode)) {
        response.status(400).json({ error: '프로그램의 선정 방식이 설정되지 않았습니다.' });
        return;
      }

      const parsed = applicantCreateSchema(
        program.selection_mode,
        validationLimits(program.intake_data),
      ).safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: '입력값을 확인해 주세요.',
          target: 'body',
          issues: parsed.error.issues,
        });
        return;
      }

      try {
        const applicant = parsed.data;
        const result = await pool.query<ApplicantResultRow>(
          `INSERT INTO applicants
             (id, program_id, email, name, department, score, justification, applied_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, program_id, email, name, department, score,
                     justification, applied_at, created_at, updated_at`,
          [
            randomUUID(),
            programId,
            applicant.email,
            applicant.name,
            applicant.department,
            applicant.score ?? null,
            applicant.justification ?? null,
            new Date(applicant.applied_at).toISOString(),
          ],
        );
        response.status(201).json({ applicant: result.rows[0] });
      } catch (error) {
        if (isUniqueViolation(error)) {
          response.status(409).json({
            error: '이 프로그램에 같은 이메일의 신청자가 이미 있습니다.',
          });
          return;
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  },
);

applicantsRouter.put(
  '/programs/:program_id/applicants/:applicant_id',
  validate({ params: applicantParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const applicantId = request.params.applicant_id as string;
      const program = await accessibleProgram(programId);
      if (!program) {
        response.status(404).json({ error: '프로그램을 찾을 수 없습니다.' });
        return;
      }
      if (!program.selection_mode || !selectionModes.includes(program.selection_mode)) {
        response.status(400).json({ error: '프로그램의 선정 방식이 설정되지 않았습니다.' });
        return;
      }

      const parsed = applicantEditSchema(
        program.selection_mode,
        validationLimits(program.intake_data),
      ).safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: '입력값을 확인해 주세요.',
          target: 'body',
          issues: parsed.error.issues,
        });
        return;
      }

      try {
        const applicant = parsed.data;
        const result = await pool.query<ApplicantResultRow>(
          `UPDATE applicants
           SET email = COALESCE($3, email),
               name = COALESCE($4, name),
               department = COALESCE($5, department),
               score = COALESCE($6::int, score),
               justification = COALESCE($7, justification),
               applied_at = COALESCE($8::timestamp, applied_at),
               updated_at = NOW()
           WHERE id = $1
             AND program_id = $2
           RETURNING id, program_id, email, name, department, score,
                     justification, applied_at, created_at, updated_at`,
          [
            applicantId,
            programId,
            applicant.email ?? null,
            applicant.name ?? null,
            applicant.department ?? null,
            applicant.score ?? null,
            applicant.justification ?? null,
            applicant.applied_at ? new Date(applicant.applied_at).toISOString() : null,
          ],
        );
        const updatedApplicant = result.rows[0];
        if (!updatedApplicant) {
          response.status(404).json({ error: 'Applicant not found' });
          return;
        }
        response.json({ applicant: updatedApplicant });
      } catch (error) {
        if (isUniqueViolation(error)) {
          response.status(409).json({
            error: '이 프로그램에 같은 이메일의 신청자가 이미 있습니다.',
          });
          return;
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  },
);
