export type SelectionMode = 'first_come_first_served' | 'score' | 'written_justification';
export type IssueType = 'error' | 'warning' | 'duplicate';
export type UploadEncoding = 'utf-8' | 'iso-8859-1' | 'sally-xlsx';

export interface ValidationIssue {
  row_number: number | null;
  type: IssueType;
  code: string;
  message: string;
  field?: string;
}

export interface StagedApplicantRow {
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

export interface StagedUpload {
  uploadId: string;
  programId: string;
  selectionMode: SelectionMode;
  encoding: UploadEncoding;
  createdAt: number;
  expiresAt: number;
  rows: StagedApplicantRow[];
  uploadIssues: ValidationIssue[];
}

export const stagedUploadTtlMs = 30 * 60 * 1000;
const maximumStagedUploads = 100;

/**
 * Shared process-local staging lets Sally imports reuse the existing applicant preview/confirm
 * endpoints. Entries remain scoped by program, expire after 30 minutes, and are lost on restart.
 */
const stagedUploadsByProgram = new Map<string, Map<string, StagedUpload>>();

function cleanExpiredUploads(now = Date.now()) {
  for (const [programId, uploads] of stagedUploadsByProgram) {
    for (const [uploadId, upload] of uploads) {
      if (upload.expiresAt <= now) uploads.delete(uploadId);
    }
    if (uploads.size === 0) stagedUploadsByProgram.delete(programId);
  }
}

function stagedUploadCount() {
  let count = 0;
  for (const uploads of stagedUploadsByProgram.values()) count += uploads.size;
  return count;
}

export function removeStagedUpload(programId: string, uploadId: string) {
  const uploads = stagedUploadsByProgram.get(programId);
  uploads?.delete(uploadId);
  if (uploads?.size === 0) stagedUploadsByProgram.delete(programId);
}

export function stageUpload(upload: StagedUpload) {
  cleanExpiredUploads();

  while (stagedUploadCount() >= maximumStagedUploads) {
    let oldest: StagedUpload | undefined;
    for (const uploads of stagedUploadsByProgram.values()) {
      for (const candidate of uploads.values()) {
        if (!oldest || candidate.createdAt < oldest.createdAt) oldest = candidate;
      }
    }
    if (!oldest) break;
    removeStagedUpload(oldest.programId, oldest.uploadId);
  }

  let programUploads = stagedUploadsByProgram.get(upload.programId);
  if (!programUploads) {
    programUploads = new Map<string, StagedUpload>();
    stagedUploadsByProgram.set(upload.programId, programUploads);
  }
  programUploads.set(upload.uploadId, upload);
}

export function getStagedUpload(programId: string, uploadId: string) {
  cleanExpiredUploads();
  return stagedUploadsByProgram.get(programId)?.get(uploadId);
}

export function validationSummary(upload: Pick<StagedUpload, 'rows' | 'uploadIssues'>) {
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
