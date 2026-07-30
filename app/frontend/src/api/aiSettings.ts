import { apiRequest } from './client';

export const AI_FEATURES = ['justification_screening', 'letter_copy', 'survey_summary'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export type AiFeatureFlags = Record<AiFeature, boolean>;

export type AiSettings = {
  /** Deployment-level provider: 'disabled' | 'claude' | 'ai_pro'. Not editable from the UI. */
  provider: string;
  /** Whether that provider actually has usable credentials. */
  configured: boolean;
  flags: AiFeatureFlags;
  updated_at?: string | null;
  updated_by?: string | null;
};

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  justification_screening: '서술형 지원서 심사 보조',
  letter_copy: '레터 문구 초안 생성',
  survey_summary: '설문 자유응답 요약',
};

export const AI_FEATURE_DESCRIPTIONS: Record<AiFeature, string> = {
  justification_screening:
    '서술형 지원서를 평가해 점수와 판단 근거를 제시합니다. 최종 선정은 코디네이터가 확정합니다.',
  letter_copy: '레터 본문 초안을 만들어 줍니다. 발송 전에 사람이 수정할 수 있습니다.',
  survey_summary: '설문 자유응답을 주제별로 요약해 결과 보고서에 넣습니다.',
};

export function getAiSettings(signal?: AbortSignal): Promise<AiSettings> {
  return apiRequest<AiSettings>('/ai-settings', { signal });
}

export function updateAiSettings(updates: Partial<AiFeatureFlags>): Promise<AiSettings> {
  return apiRequest<AiSettings>('/ai-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}
