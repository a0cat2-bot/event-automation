import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as XLSX from 'xlsx';

import { pool } from '../db/pool.js';
import { knoxIdToEmail } from '../utils/knoxId.js';
import {
  stageUpload,
  stagedUploadTtlMs,
  type IssueType,
  type SelectionMode,
  type StagedApplicantRow,
  type StagedUpload,
} from './applicantStaging.js';

interface SourceIssue {
  type: IssueType;
  code: string;
  message: string;
  field?: string;
}

export interface SallyStagedApplicantRecord {
  /** Knox ID from question 1. Sally's own Email column is empty in real exports. */
  knox_id: string | null;
  name: string | null;
  applied_at: string | Date | null;
  department: null;
  justification: string;
  score: null;
  issues: SourceIssue[];
}

export class SallyImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SallyImportParseError';
  }
}

const healthQuestionCodePattern = /^(?:[4-9]|1[0-3])(?:-\d+)?$/;
const basicEmailPattern =
  /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const maximumRecommendedRows = 5_000;

function textValue(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function answerValue(value: unknown): string | number | boolean | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

function appliedAtValue(value: unknown): string | Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(
        Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S)),
      );
    }
  }
  return textValue(value) || null;
}

function identityIssue(code: string, message: string, field?: string): SourceIssue {
  const type: IssueType = 'warning';
  return { type, code, message, field };
}

export function parseSallyIdentity(value: unknown): {
  knoxId: string | null;
  name: string | null;
  issues: SourceIssue[];
} {
  const identity = textValue(value);
  if (!identity) {
    return {
      knoxId: null,
      name: null,
      issues: [
        identityIssue(
          'missing_sally_identity',
          'Sally question 1 is empty; Knox ID and name could not be parsed',
          'email',
        ),
      ],
    };
  }

  const slashIndex = identity.indexOf('/');
  if (slashIndex < 0) {
    return {
      knoxId: identity,
      name: null,
      issues: [
        identityIssue(
          'invalid_sally_identity_format',
          'Sally question 1 is missing the "/" separator; the value was kept as the Knox ID',
          'name',
        ),
      ],
    };
  }

  const knoxId = identity.slice(0, slashIndex).trim() || null;
  const name = identity.slice(slashIndex + 1).trim() || null;
  const issues: SourceIssue[] = [];
  if (!knoxId) {
    issues.push(
      identityIssue(
        'missing_sally_knox_id',
        'Sally question 1 has no Knox ID before the "/" separator',
        'email',
      ),
    );
  }
  if (!name) {
    issues.push(
      identityIssue(
        'missing_sally_name',
        'Sally question 1 has no name after the "/" separator',
        'name',
      ),
    );
  }
  return { knoxId, name, issues };
}

function findRequiredColumn(headers: unknown[], name: string) {
  const index = headers.findIndex((header) => textValue(header) === name);
  if (index < 0) throw new SallyImportParseError(`Sally export is missing column "${name}"`);
  return index;
}

function healthQuestionColumns(headers: unknown[], questions: unknown[]) {
  const usedKeys = new Set<string>();
  return headers.flatMap((header, index) => {
    const code = textValue(header);
    if (!healthQuestionCodePattern.test(code)) return [];

    const questionText = textValue(questions[index]) || `Question ${code}`;
    const key = usedKeys.has(questionText) ? `${questionText} [${code}]` : questionText;
    usedKeys.add(key);
    return [{ index, key }];
  });
}

/** Parses row 4 onward from the first sheet of a Sally results export. */
export function parseSallyImport(filePath: string): SallyStagedApplicantRecord[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(readFileSync(filePath), { cellDates: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SallyImportParseError(`Could not read Sally Excel export: ${message}`);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new SallyImportParseError('Sally export has no worksheet');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: true,
  });
  const headers = rows[0];
  const questions = rows[1];
  if (!headers || !questions) {
    throw new SallyImportParseError('Sally export is missing its header or question-text row');
  }

  const submitTimeIndex = findRequiredColumn(headers, 'Submit time');
  const identityIndex = findRequiredColumn(headers, '1');
  const healthColumns = healthQuestionColumns(headers, questions);

  return rows.slice(3).flatMap<SallyStagedApplicantRecord>((row) => {
    if (!row || row.every((value) => textValue(value) === '')) return [];

    const identity = parseSallyIdentity(row[identityIndex]);
    const healthAnswers = Object.fromEntries(
      healthColumns.map(({ index, key }) => [key, answerValue(row[index])]),
    );

    return [
      {
        knox_id: identity.knoxId,
        name: identity.name,
        applied_at: appliedAtValue(row[submitTimeIndex]),
        department: null,
        justification: JSON.stringify(healthAnswers),
        score: null,
        issues: identity.issues,
      },
    ];
  });
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

/** Validates Sally rows and places them into the shared CSV preview/confirm staging store. */
export async function stageSallyImport(options: {
  programId: string;
  selectionMode: SelectionMode;
  records: SallyStagedApplicantRecord[];
}) {
  const createdAt = Date.now();
  const rows = options.records.map<StagedApplicantRow>((record, index) => {
    const rowNumber = index + 4;
    const knoxId = record.knox_id?.trim() ?? '';
    const email = knoxIdToEmail(knoxId);
    const name = record.name?.trim() ?? '';
    const rawAppliedAt =
      record.applied_at instanceof Date
        ? record.applied_at.toISOString()
        : (record.applied_at?.trim() ?? '');
    const fallbackAppliedAt = new Date(createdAt + index).toISOString();
    const parsedAppliedAt = rawAppliedAt ? new Date(rawAppliedAt) : new Date(fallbackAppliedAt);
    const row: StagedApplicantRow = {
      rowNumber,
      email,
      name,
      department: '',
      score: null,
      justification: record.justification,
      appliedAt: Number.isNaN(parsedAppliedAt.getTime())
        ? fallbackAppliedAt
        : parsedAppliedAt.toISOString(),
      issues: record.issues.map((issue) => ({ row_number: rowNumber, ...issue })),
    };

    // Sally's own "Email" export column is empty for every respondent in real exports (confirmed
    // against an actual production download — Sally doesn't collect it for link-based/anonymous
    // submissions), so the Knox ID from question 1 is the only reliable identifier. Applicants are
    // keyed by email, so the Knox ID is expanded into an address via KNOX_EMAIL_DOMAIN.
    if (!knoxId) {
      addIssue(row, 'error', 'required', 'Knox ID is required', 'email');
    } else if (!email) {
      addIssue(
        row,
        'error',
        'missing_knox_email_domain',
        'KNOX_EMAIL_DOMAIN is not configured, so the Knox ID cannot be turned into an email address',
        'email',
      );
    }
    if (!name) addIssue(row, 'error', 'required', 'name is required', 'name');
    if (email.length > 255) {
      addIssue(row, 'error', 'too_long', 'email must be at most 255 characters', 'email');
    } else if (email && !basicEmailPattern.test(email)) {
      addIssue(row, 'error', 'invalid_email', 'email is not a valid email address', 'email');
    }
    if (name.length > 255) {
      addIssue(row, 'error', 'too_long', 'name must be at most 255 characters', 'name');
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

  const emails = [...firstRowByEmail.keys()];
  if (emails.length > 0) {
    const result = await pool.query<{ email: string }>(
      `SELECT LOWER(email) AS email
       FROM applicants
       WHERE program_id = $1 AND LOWER(email) = ANY($2::text[])`,
      [options.programId, emails],
    );
    const existingEmails = new Set(result.rows.map((row) => row.email));
    for (const row of rows) {
      if (existingEmails.has(row.email.toLowerCase())) {
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

  const uploadIssues: StagedUpload['uploadIssues'] = [];
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
    programId: options.programId,
    selectionMode: options.selectionMode,
    encoding: 'sally-xlsx',
    createdAt,
    expiresAt: createdAt + stagedUploadTtlMs,
    rows,
    uploadIssues,
  };
  stageUpload(upload);
  return upload;
}
