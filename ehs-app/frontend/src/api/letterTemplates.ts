import { API_BASE_URL } from '../config/api';

export const LETTER_FIELD_KEYS = [
  'applicant_name',
  'applicant_email',
  'department',
  'program_name',
  'program_date',
  'program_location',
  'program_time',
  'survey_link',
  'gift_amount',
  'coordinator_name',
  'coordinator_contact',
  'static',
] as const;

export type LetterFieldKey = (typeof LETTER_FIELD_KEYS)[number];

export type TextField = {
  id: string;
  key: LetterFieldKey;
  static_text: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  font_family: string;
  font_size: number;
  font_weight: string;
  color: string;
  text_align: 'left' | 'center' | 'right';
};

export type LetterTemplate = {
  id: string | number;
  name: string;
  template_type: string;
  brand_variant: string;
  background_image_url: string | null;
  canvas_width: number | null;
  canvas_height: number | null;
  text_fields: TextField[];
};

type TemplateResponse = { template: LetterTemplate };
type TemplatesResponse = { templates: LetterTemplate[] };

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  // The backend session cookie is issued on a different origin/port (3000 vs
  // the frontend's 5173), so it's cross-origin from the browser's point of
  // view. Fetch only sends cookies cross-origin with credentials: 'include'
  // (the backend's CORS config already allows this origin with credentials).
  const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}${path}`, {
    credentials: 'include',
    ...init,
  });
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: string; message?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.message ?? payload?.error ?? '요청을 처리하지 못했습니다.');
  }

  if (!payload) {
    throw new Error('서버 응답을 읽지 못했습니다.');
  }

  return payload;
}

export function getLetterTemplates(signal?: AbortSignal): Promise<TemplatesResponse> {
  return apiRequest<TemplatesResponse>('/letter-templates', { signal });
}

export function getLetterTemplate(
  templateId: string,
  signal?: AbortSignal,
): Promise<TemplateResponse> {
  return apiRequest<TemplateResponse>(`/letter-templates/${encodeURIComponent(templateId)}`, {
    signal,
  });
}

export function createLetterTemplate(input: {
  name: string;
  template_type: string;
  brand_variant: string;
}): Promise<TemplateResponse> {
  return apiRequest<TemplateResponse>('/letter-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function uploadLetterTemplateBackground(
  templateId: string,
  image: File,
): Promise<TemplateResponse> {
  const body = new FormData();
  body.append('image', image);

  return apiRequest<TemplateResponse>(
    `/letter-templates/${encodeURIComponent(templateId)}/background`,
    { method: 'POST', body },
  );
}

export function updateLetterTemplateFields(
  templateId: string,
  textFields: TextField[],
): Promise<TemplateResponse> {
  return apiRequest<TemplateResponse>(
    `/letter-templates/${encodeURIComponent(templateId)}/fields`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text_fields: textFields }),
    },
  );
}
