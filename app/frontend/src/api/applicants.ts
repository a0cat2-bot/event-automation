import { apiRequest } from './client';

export type ValidationIssue = {
  row_number: number | null;
  type: 'error' | 'warning' | 'duplicate';
  code: string;
  message: string;
  field?: string;
};

export type ValidationSummary = {
  errors: number;
  warnings: number;
  duplicates_count: number;
};

export type PreviewRow = {
  row_number: number;
  name: string;
  email: string;
  department: string;
  score: number | null;
  justification: string | null;
  applied_at: string;
  status: 'valid' | 'error' | 'warning' | 'duplicate';
  issues: ValidationIssue[];
};

export type UploadResponse = {
  upload_id: string;
  row_count: number;
  validation_summary: ValidationSummary;
};

export type PreviewResponse = {
  upload_id: string;
  row_count: number;
  selection_mode: 'first_come_first_served' | 'score' | 'written_justification';
  encoding: string;
  validation_summary: ValidationSummary;
  page: number;
  page_size: number;
  total_rows: number;
  total_pages: number;
  rows: PreviewRow[];
  validation_issues: ValidationIssue[];
};

export type ConfirmResponse = {
  imported_count: number;
  skipped_count: number;
  failed_count: number;
};

export type Applicant = {
  id: string;
  program_id: string;
  email: string | null;
  name: string | null;
  department: string | null;
  score: number | null;
  justification: string | null;
  applied_at: string;
  created_at: string;
  updated_at: string;
};

type ApplicantsResponse = { applicants: Applicant[] };
type ApplicantResponse = { applicant: Applicant };

export type ApplicantInput = {
  name: string;
  email: string;
  department: string;
  applied_at: string;
  score?: number;
  justification?: string;
};

export function uploadApplicantCsv(
  programId: string,
  file: File,
): Promise<UploadResponse> {
  const body = new FormData();
  body.append('csv_file', file);

  return apiRequest<UploadResponse>(
    `/programs/${encodeURIComponent(programId)}/applicants/upload`,
    { method: 'POST', body },
  );
}

export function previewApplicantUpload(
  programId: string,
  uploadId: string,
  signal?: AbortSignal,
): Promise<PreviewResponse> {
  return apiRequest<PreviewResponse>(
    `/programs/${encodeURIComponent(programId)}/applicants/upload/${encodeURIComponent(uploadId)}/preview`,
    { signal },
  );
}

export function confirmApplicantUpload(
  programId: string,
  uploadId: string,
  input: { action: 'import' | 'discard'; conflict_resolution: 'skip_duplicates' | 'overwrite' },
): Promise<ConfirmResponse> {
  return apiRequest<ConfirmResponse>(
    `/programs/${encodeURIComponent(programId)}/applicants/upload/${encodeURIComponent(uploadId)}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function listApplicants(
  programId: string,
  signal?: AbortSignal,
): Promise<ApplicantsResponse> {
  return apiRequest<ApplicantsResponse>(
    `/programs/${encodeURIComponent(programId)}/applicants`,
    { signal },
  );
}

export function createApplicant(
  programId: string,
  input: ApplicantInput,
): Promise<ApplicantResponse> {
  return apiRequest<ApplicantResponse>(
    `/programs/${encodeURIComponent(programId)}/applicants`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function updateApplicant(
  programId: string,
  applicantId: string,
  input: Partial<ApplicantInput>,
): Promise<ApplicantResponse> {
  return apiRequest<ApplicantResponse>(
    `/programs/${encodeURIComponent(programId)}/applicants/${encodeURIComponent(applicantId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}
