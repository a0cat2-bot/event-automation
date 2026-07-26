import { apiRequest } from './client';

export type SelectedParticipant = {
  participant_id: string;
  applicant_id: string;
  selection_rank: number;
  selection_reason: string;
};

export type JustificationCandidate = {
  applicant_id: string;
  email: string | null;
  name: string | null;
  justification: string | null;
  applied_at: string;
  quality_score: number;
  matched_keywords: string[];
  readability_grade: number | null;
};

export type SelectionResult = {
  job_id: string;
  status: string;
  dry_run: boolean;
  estimated_completion_time: string;
  selected_participants: SelectedParticipant[];
  total_selected: number;
  completed_at: string;
  candidates?: JustificationCandidate[];
};

export type RunSelectionInput = {
  selection_mode: 'first_come_first_served' | 'score' | 'written_justification';
  quality_score_threshold: number;
  manual_review_count_multiplier: number;
  override_selections: Array<{ applicant_id: string; selected: boolean; reason: string }>;
  dry_run?: boolean;
  approved_by?: string;
};

export function runSelection(
  programId: string,
  input: RunSelectionInput,
): Promise<SelectionResult> {
  return apiRequest<SelectionResult>(
    `/programs/${encodeURIComponent(programId)}/selection/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}
