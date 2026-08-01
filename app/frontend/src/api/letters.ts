import { apiRequest } from './client';

export type GeneratedLetterResult = {
  id?: string;
  applicant_id: string;
  file_path?: string;
  status: 'generated' | 'cached' | 'failed';
  error?: string;
};

export type GenerateLetterResponse = {
  generated_count: number;
  cached_count: number;
  failed_count: number;
  results: GeneratedLetterResult[];
};

export function generateLetter(input: {
  template_id: string;
  program_id: string;
  applicant_ids: string[];
  brand_variant: string;
}): Promise<GenerateLetterResponse> {
  return apiRequest<GenerateLetterResponse>('/letters/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export type RecruitmentNoticeSetup = {
  source: string;
  survey_url: string | null;
  recipients: string[];
};

export type RecruitmentNoticePreview = {
  dry_run: true;
  recipients: string[];
  subject: string;
  email_html: string;
  email_text: string;
  letter_html: string;
  output_format: 'pdf' | 'image';
  survey_url: string;
  cta_text: string;
};

export type RecruitmentNoticeOutcome = {
  email: string;
  status: 'sent' | 'failed';
  message_id?: string;
  error?: string;
};

export function getRecruitmentNoticeSetup(
  programId: string,
  signal?: AbortSignal,
): Promise<RecruitmentNoticeSetup> {
  return apiRequest(`/programs/${encodeURIComponent(programId)}/recruitment-notice`, { signal });
}

export function saveRecruitmentRecipients(
  programId: string,
  emails: string[],
): Promise<{ source: string; recipients: string[] }> {
  return apiRequest(
    `/programs/${encodeURIComponent(programId)}/recruitment-notice/recipients`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails }),
    },
  );
}

export function previewRecruitmentNotice(
  programId: string,
  templateId: string,
): Promise<RecruitmentNoticePreview> {
  return apiRequest(`/programs/${encodeURIComponent(programId)}/recruitment-notice/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: templateId }),
  });
}

export function sendRecruitmentNotice(
  programId: string,
  templateId: string,
): Promise<{ dry_run: false; outcomes: RecruitmentNoticeOutcome[] }> {
  return apiRequest(`/programs/${encodeURIComponent(programId)}/recruitment-notice/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: templateId, confirmed: true }),
  });
}
