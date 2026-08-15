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

/**
 * A Sally answer column is headed by a question number, optionally with a sub-question suffix
 * ("11-1"). Everything else in the header row — Open time, Submit time, Email, Note, Device info,
 * the UTM columns — is metadata and carries no answer.
 */
const questionCodePattern = /^\d+(?:-\d+)?$/;

/**
 * Marks a question as asking whether the person intends to take part, so a declining answer can be
 * acted on. Deliberately narrow: it wants both the subject (참석/참여) and a forward-looking form,
 * because "이전에 참여한 적 있습니까?" answered No must not be read as a decline.
 */
const attendanceQuestionPattern = /(?:참석|참여)\s*(?:여부|하시겠|하시나요|하실|하시겠습니까)/;
const decliningAnswers = new Set(['no', '아니오', '아니요', '불참', '미참석', '참석하지 않음']);
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

/**
 * Every answer column except the identity question.
 *
 * Question numbers are not hardcoded: a survey's numbering is its own, and pinning specific ones
 * here would mean a code change for each new survey — and silently empty answers for any survey
 * that numbers its questions differently.
 */
function answerColumns(headers: unknown[], questions: unknown[], identityIndex: number) {
  const usedKeys = new Set<string>();
  return headers.flatMap((header, index) => {
    if (index === identityIndex) return [];
    const code = textValue(header);
    if (!questionCodePattern.test(code)) return [];

    const questionText = textValue(questions[index]) || `Question ${code}`;
    const key = usedKeys.has(questionText) ? `${questionText} [${code}]` : questionText;
    usedKeys.add(key);
    return [{ index, key, questionText }];
  });
}

/** True when this row answered an attendance question saying they will not take part. */
function declinedAttendance(
  columns: Array<{ index: number; questionText: string }>,
  row: unknown[],
): boolean {
  return columns.some(
    (column) =>
      attendanceQuestionPattern.test(column.questionText) &&
      decliningAnswers.has(textValue(row[column.index]).toLowerCase()),
  );
}

/** Parses row 4 onward from the first sheet of a Sally results export on disk. */
export function parseSallyImport(filePath: string): SallyStagedApplicantRecord[] {
  return parseSallyExport(readFileSync(filePath));
}

/**
 * Same parse, from bytes rather than a path.
 *
 * The browser automation writes the export to disk before parsing it; a coordinator uploading the
 * file they already downloaded from Sally has only a buffer. Both go through here so the two
 * routes cannot drift into accepting different things.
 */
export function parseSallyExport(data: Buffer): SallyStagedApplicantRecord[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { cellDates: true });
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
  const columns = answerColumns(headers, questions, identityIndex);

  return rows.slice(3).flatMap<SallyStagedApplicantRecord>((row) => {
    if (!row || row.every((value) => textValue(value) === '')) return [];

    const identity = parseSallyIdentity(row[identityIndex]);
    const answers = Object.fromEntries(
      columns.map(({ index, key }) => [key, answerValue(row[index])]),
    );
    const issues = [...identity.issues];

    // Someone who said they will not attend is kept in the staged list rather than dropped, so the
    // coordinator can see the decision was made and by whom. Flagged as an error because that is
    // what the confirm step already excludes from the import.
    if (declinedAttendance(columns, row)) {
      issues.push({
        type: 'error',
        code: 'declined_attendance',
        message: '참석하지 않겠다고 응답해 신청자에서 제외했습니다.',
      });
    }

    return [
      {
        knox_id: identity.knoxId,
        name: identity.name,
        applied_at: appliedAtValue(row[submitTimeIndex]),
        justification: JSON.stringify(answers),
        score: null,
        issues,
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
    // Question 1 asks for "Knox ID / 성명" and a predictable share of people answer with the ID
    // alone. They are real signups and their address is derivable, so the ID stands in as a
    // placeholder name rather than the row being dropped. Flagged below so it gets corrected.
    const submittedName = record.name?.trim() ?? '';
    const name = submittedName || knoxId;
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
    else if (!submittedName) {
      // A warning, not an error: the row imports, but the coordinator should replace the ID with a
      // real name before letters go out, or the greeting reads as an account rather than a person.
      addIssue(
        row,
        'warning',
        'name_defaulted_to_knox_id',
        '이름을 적지 않아 Knox ID를 임시 이름으로 넣었습니다. 레터 발송 전에 실제 이름으로 수정하세요.',
        'name',
      );
    }
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
