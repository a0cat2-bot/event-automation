import { randomUUID } from 'node:crypto';

import { parse } from 'csv-parse/sync';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { pool } from '../db/pool.js';
import { requireRole, type AuthenticatedPrincipal } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { programParams, uploadParams } from '../schemas/common.js';
import { applicantConfirmBody } from '../schemas/contracts.js';
import {
  getStagedUpload,
  removeStagedUpload,
  stageUpload,
  stagedUploadTtlMs,
} from '../services/applicantStaging.js';

type SelectionMode = 'first_come_first_served' | 'score' | 'written_justification';
type IssueType = 'error' | 'warning' | 'duplicate';

interface ProgramRow {
  id: string;
  business_unit: string;
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
  externalId: string;
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
  external_id: string | null;
  email: string | null;
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
    const externalId = (record.external_id ?? '').trim();
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
      externalId,
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

    requiredField(row, externalId, 'external_id');
    requiredField(row, name, 'name');
    requiredField(row, email, 'email');
    requiredField(row, department, 'department');

    if (externalId.length > 50) {
      addIssue(
        row,
        'error',
        'too_long',
        'external_id must be at most 50 characters',
        'external_id',
      );
    }
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

  const firstRowByExternalId = new Map<string, number>();
  for (const row of rows) {
    if (!row.externalId) continue;
    const firstRow = firstRowByExternalId.get(row.externalId);
    if (firstRow === undefined) {
      firstRowByExternalId.set(row.externalId, row.rowNumber);
    } else {
      addIssue(
        row,
        'duplicate',
        'duplicate_in_upload',
        `external_id duplicates row ${firstRow} in this upload`,
        'external_id',
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
    external_id: row.externalId,
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

async function accessibleProgram(programId: string, user: AuthenticatedPrincipal) {
  const result =
    user.role === 'admin'
      ? await pool.query<ProgramRow>(
          `SELECT id, business_unit, selection_mode, intake_data
           FROM programs
           WHERE id = $1 AND deleted_at IS NULL
           LIMIT 1`,
          [programId],
        )
      : await pool.query<ProgramRow>(
          `SELECT id, business_unit, selection_mode, intake_data
           FROM programs
           WHERE id = $1
             AND deleted_at IS NULL
             AND business_unit = ANY($2::text[])
           LIMIT 1`,
          [programId, user.business_units],
        );

  return result.rows[0];
}

function currentUser(request: Request): AuthenticatedPrincipal {
  // All routes are mounted after authenticate; this guard keeps the handler safe in isolation.
  if (!request.user) throw new Error('Authenticated principal is missing');
  return request.user;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown database error';
}

export const applicantsRouter = Router();

applicantsRouter.post(
  '/programs/:program_id/applicants/upload',
  requireRole('admin', 'coordinator'),
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
      const program = await accessibleProgram(programId, currentUser(request));
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
      const externalIds = [...new Set(rows.map((row) => row.externalId).filter(Boolean))];
      if (externalIds.length > 0) {
        const duplicateResult = await pool.query<{ external_id: string }>(
          `SELECT external_id
           FROM applicants
           WHERE program_id = $1 AND external_id = ANY($2::text[])`,
          [programId, externalIds],
        );
        const committedExternalIds = new Set(duplicateResult.rows.map((row) => row.external_id));
        for (const row of rows) {
          if (committedExternalIds.has(row.externalId)) {
            addIssue(
              row,
              'duplicate',
              'duplicate_existing_applicant',
              'external_id already exists for this program',
              'external_id',
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
      const program = await accessibleProgram(programId, currentUser(request));
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
  requireRole('admin', 'coordinator'),
  validate({ params: uploadParams, body: applicantConfirmBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const uploadId = request.params.upload_id as string;
      const user = currentUser(request);
      const program = await accessibleProgram(programId, user);
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
            row.externalId || null,
            row.email,
            row.name,
            row.department || null,
            row.score,
            row.justification,
            row.appliedAt,
          ];

          if (body.conflict_resolution === 'skip_duplicates') {
            const result = await client.query(
              `INSERT INTO applicants
                 (id, program_id, external_id, email, name, department, score, justification, applied_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (program_id, external_id) DO NOTHING
               RETURNING id`,
              values,
            );
            if (result.rowCount === 0) skippedCount += 1;
            else importedCount += 1;
          } else {
            await client.query(
              `INSERT INTO applicants
                 (id, program_id, external_id, email, name, department, score, justification, applied_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (program_id, external_id) DO UPDATE SET
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
             (user_id, action, entity_type, entity_id, program_id, details, ip_address)
           VALUES ($1, 'applicant_import', 'program', $2, $2, $3::jsonb, $4)`,
          [
            user.user_id,
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
            ? { row_number: failedRow.rowNumber, external_id: failedRow.externalId }
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

applicantsRouter.get(
  '/programs/:program_id/applicants',
  validate({ params: programParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const program = await accessibleProgram(programId, currentUser(request));
      if (!program) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }

      const result = await pool.query<ApplicantResultRow>(
        `SELECT id, program_id, external_id, email, name, department, score,
                justification, applied_at, created_at, updated_at
         FROM applicants
         WHERE program_id = $1
         ORDER BY applied_at ASC, id ASC`,
        [programId],
      );
      response.json({ applicants: result.rows });
    } catch (error) {
      next(error);
    }
  },
);
