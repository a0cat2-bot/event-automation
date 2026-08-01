import { apiRequest } from './client';

export const SELECTION_MODES = [
  { value: 'first_come_first_served', label: '선착순' },
  { value: 'score', label: '점수 기반' },
  { value: 'written_justification', label: '서술형 심사' },
] as const;

export type SelectionMode = (typeof SELECTION_MODES)[number]['value'];

export type Program = {
  id: string;
  name: string;
  business_unit_id: string;
  business_unit: string;
  intake_data: Record<string, unknown> | null;
  recruitment_survey_url: string | null;
  template_version_id: string | null;
  selection_mode: SelectionMode;
  max_participants: number;
  requires_approval: boolean;
  status: 'planning' | 'recruitment_active' | 'selection_in_progress' | 'completed';
  created_at: string;
  updated_at: string;
  created_by: string | null;
  deleted_at: string | null;
  applicant_count: number;
  participant_count: number;
  notified_count: number;
  survey_completed_count: number;
  gift_recipient_count: number;
  has_report: boolean;
};

type ProgramResponse = { program: Program };
type ProgramsResponse = { programs: Program[] };

export type CreateProgramInput = {
  name: string;
  business_unit_id: string;
  selection_mode: SelectionMode;
  max_participants: number;
  requires_approval?: boolean;
  intake_data?: Record<string, unknown>;
};

export function createProgram(input: CreateProgramInput): Promise<ProgramResponse> {
  return apiRequest<ProgramResponse>('/programs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function listPrograms(signal?: AbortSignal): Promise<ProgramsResponse> {
  return apiRequest<ProgramsResponse>('/programs', { signal });
}

export function getProgram(programId: string, signal?: AbortSignal): Promise<ProgramResponse> {
  return apiRequest<ProgramResponse>(`/programs/${encodeURIComponent(programId)}`, { signal });
}

export type UpdateProgramInput = Partial<CreateProgramInput> & {
  status?: Program['status'];
};

export function updateProgram(
  programId: string,
  input: UpdateProgramInput,
): Promise<ProgramResponse> {
  return apiRequest<ProgramResponse>(`/programs/${encodeURIComponent(programId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteProgram(programId: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/programs/${encodeURIComponent(programId)}`, {
    method: 'DELETE',
  });
}
