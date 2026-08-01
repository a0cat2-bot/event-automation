import { apiBlobRequest, apiRequest } from './client';

export type SallyImportResponse = {
  upload_id: string;
  row_count: number;
  validation_summary: { errors: number; warnings: number; duplicates_count: number };
};

export type SallySurveyKind = 'recruitment' | 'satisfaction';

export type SallySurveyDraft = {
  title: string;
  description?: string;
  questions: Array<{
    type: 'short_answer' | 'single_choice' | 'rating_scale';
    text: string;
    choices?: Array<string | number>;
  }>;
};

export type SallySurveyCreationResponse = {
  draft: SallySurveyDraft;
  created: boolean;
  automation_available: boolean;
  reason?: string;
};

export function getSallySurveyDraft(
  programId: string,
  kind: SallySurveyKind,
  signal?: AbortSignal,
): Promise<{ draft: SallySurveyDraft }> {
  return apiRequest(`/programs/${encodeURIComponent(programId)}/sally/surveys/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
    signal,
  });
}

export function createSallySurvey(
  programId: string,
  kind: SallySurveyKind,
): Promise<SallySurveyCreationResponse> {
  return apiRequest(`/programs/${encodeURIComponent(programId)}/sally/surveys/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  });
}

export function getSallySurveyDescriptionImage(
  programId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return apiBlobRequest(
    `/programs/${encodeURIComponent(programId)}/sally/surveys/description-image`,
    { signal },
  );
}

/**
 * Triggers server-side Playwright automation against sally.coach to download the named survey
 * and stage its respondents. Note: despite the "Sally" name suggesting a post-selection
 * satisfaction survey, this currently imports respondents as NEW applicants (matching the
 * written-justification intake flow), staged the same way as a CSV upload — it does not record
 * post-selection satisfaction results. Requires SALLY_EMAIL/SALLY_PASSWORD to be configured.
 */
export function syncSallySurvey(
  programId: string,
  surveyTitle: string,
): Promise<SallyImportResponse> {
  return apiRequest<SallyImportResponse>(`/programs/${encodeURIComponent(programId)}/sally/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ survey_title: surveyTitle }),
  });
}

/**
 * Stages applicants from a Sally export the coordinator already downloaded.
 *
 * Unlike `syncSallySurvey`, this needs no Sally credentials, no network reach to Sally, and does
 * not depend on Sally's screens being unchanged — the file is already in hand. Both end at the
 * same parser, so the staged result is the same.
 */
export function uploadSallyExport(
  programId: string,
  file: File,
): Promise<SallyImportResponse> {
  const body = new FormData();
  body.append('file', file);

  return apiRequest<SallyImportResponse>(
    `/programs/${encodeURIComponent(programId)}/sally/import/upload`,
    { method: 'POST', body },
  );
}
