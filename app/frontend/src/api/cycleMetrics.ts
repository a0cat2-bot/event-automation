import { apiRequest } from './client';

export type StepTiming = {
  step: string;
  label: string;
  occurrences: number;
  firstAt: string | null;
  lastAt: string | null;
  minutesFromStart: number | null;
};

export type ProgramCycleMetrics = {
  programId: string;
  programName: string;
  startedAt: string | null;
  completedAt: string | null;
  totalMinutes: number | null;
  handsOnMinutes: number | null;
  steps: StepTiming[];
  applicantCount: number;
  participantCount: number;
  lettersGenerated: number;
  complete: boolean;
};

export type CycleMetricsResponse = {
  programs: ProgramCycleMetrics[];
  summary: {
    total_programs: number;
    completed_cycles: number;
    average_total_minutes: number | null;
    average_hands_on_minutes: number | null;
  };
};

export function getCycleMetrics(signal?: AbortSignal): Promise<CycleMetricsResponse> {
  return apiRequest<CycleMetricsResponse>('/cycle-metrics', { signal });
}

/** Renders a minute count the way a coordinator would say it. */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${Math.round(minutes)}분`;

  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  if (hours < 24) return remainder === 0 ? `${hours}시간` : `${hours}시간 ${remainder}분`;

  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return leftoverHours === 0 ? `${days}일` : `${days}일 ${leftoverHours}시간`;
}
