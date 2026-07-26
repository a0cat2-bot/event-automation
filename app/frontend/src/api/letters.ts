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
