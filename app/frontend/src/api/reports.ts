import { apiRequest } from './client';

export type ReportSummary = {
  applicant_count: number;
  participant_count: number;
  selection_rate: number;
  survey_completion_rate: number;
  average_satisfaction_score: number | null;
  gift_recipient_count: number;
};

export type Report = {
  id: string;
  program_id: string;
  format: 'markdown' | 'html' | 'pdf';
  content: string | null;
  file_path: string | null;
  summary: ReportSummary;
  created_at: string;
};

type ReportResponse = { report: Report };

export function generateReport(
  programId: string,
  input: { format: Report['format']; include_sections: string[] },
): Promise<ReportResponse> {
  return apiRequest<ReportResponse>(
    `/programs/${encodeURIComponent(programId)}/reports/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function getReport(
  programId: string,
  reportId: string,
  signal?: AbortSignal,
): Promise<ReportResponse> {
  return apiRequest<ReportResponse>(
    `/programs/${encodeURIComponent(programId)}/reports/${encodeURIComponent(reportId)}`,
    { signal },
  );
}
