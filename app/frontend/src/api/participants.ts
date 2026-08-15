import { apiRequest } from './client';

export type Participant = {
  id: string;
  program_id: string;
  applicant_id: string;
  selection_rank: number | null;
  selection_reason: string | null;
  notification_status: 'pending' | 'sent' | 'bounced' | 'failed';
  notification_sent_at: string | null;
  notification_letter_id: string | null;
  survey_id: string | null;
  survey_status: 'not_sent' | 'sent' | 'in_progress' | 'completed';
  is_gift_eligible: boolean;
  gift_status: 'not_selected' | 'selected' | 'delivered';
  gift_selected_at: string | null;
  created_at: string;
  updated_at: string;
  name: string | null;
  email: string | null;
};

export type NotificationHistoryEntry = {
  participant_id: string;
  template_id: string;
  status: 'sent' | 'failed';
  sent_at: string;
};

type ParticipantsResponse = { participants: Participant[] };
type ParticipantResponse = { participant: Participant };
type NotificationHistoryResponse = { history: NotificationHistoryEntry[] };

export function listParticipants(
  programId: string,
  signal?: AbortSignal,
): Promise<ParticipantsResponse> {
  return apiRequest<ParticipantsResponse>(
    `/programs/${encodeURIComponent(programId)}/participants`,
    { signal },
  );
}

export function getNotificationHistory(
  programId: string,
  signal?: AbortSignal,
): Promise<NotificationHistoryResponse> {
  return apiRequest<NotificationHistoryResponse>(
    `/programs/${encodeURIComponent(programId)}/notification-history`,
    { signal },
  );
}

export function notifyParticipant(
  programId: string,
  participantId: string,
  templateId: string,
): Promise<ParticipantResponse> {
  return apiRequest<ParticipantResponse>(
    `/programs/${encodeURIComponent(programId)}/participants/${encodeURIComponent(participantId)}/notify`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    },
  );
}

export function recordSurveyResult(
  programId: string,
  participantId: string,
  input: { satisfaction_score: number; feedback_text?: string },
): Promise<{ participant: Pick<Participant, 'id' | 'program_id' | 'applicant_id' | 'survey_status'> }> {
  return apiRequest(
    `/programs/${encodeURIComponent(programId)}/participants/${encodeURIComponent(participantId)}/survey-result`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}
