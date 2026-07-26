import { apiRequest } from './client';

export type GiftItem = {
  id: string;
  program_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  quantity: number;
  selected_count: number;
  created_at: string;
  updated_at: string;
};

export type GiftRecipient = {
  id: string;
  program_id: string;
  participant_id: string;
  gift_item_id: string | null;
  selection_rank: number | null;
  selection_reason: string | null;
  selected_at: string;
  selected_by: string | null;
  gift_status: 'selected' | 'delivered' | 'failed';
  delivery_date: string | null;
  delivery_method: string | null;
  created_at: string;
  name: string | null;
  email: string | null;
  gift_item_name: string | null;
};

export type SelectGiftRecipientsResult = {
  selected: GiftRecipient[];
  requested_count: number;
  selected_count: number;
  warning?: string;
};

type GiftItemResponse = { gift_item: GiftItem };
type GiftItemsResponse = { gift_items: GiftItem[] };
type GiftRecipientsResponse = { gift_recipients: GiftRecipient[] };
type GiftRecipientResponse = { gift_recipient: GiftRecipient };

export function createGiftItem(
  programId: string,
  input: { name: string; description?: string; quantity: number; image?: File },
): Promise<GiftItemResponse> {
  const body = new FormData();
  body.append('name', input.name);
  if (input.description) body.append('description', input.description);
  body.append('quantity', String(input.quantity));
  if (input.image) body.append('image', input.image);

  return apiRequest<GiftItemResponse>(`/programs/${encodeURIComponent(programId)}/gift-items`, {
    method: 'POST',
    body,
  });
}

export function listGiftItems(
  programId: string,
  signal?: AbortSignal,
): Promise<GiftItemsResponse> {
  return apiRequest<GiftItemsResponse>(`/programs/${encodeURIComponent(programId)}/gift-items`, {
    signal,
  });
}

export function selectGiftRecipients(
  programId: string,
  input: { gift_item_id: string; minimum_satisfaction_score?: number },
): Promise<SelectGiftRecipientsResult> {
  return apiRequest<SelectGiftRecipientsResult>(
    `/programs/${encodeURIComponent(programId)}/gifts/select`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function listGiftRecipients(
  programId: string,
  signal?: AbortSignal,
): Promise<GiftRecipientsResponse> {
  return apiRequest<GiftRecipientsResponse>(
    `/programs/${encodeURIComponent(programId)}/gifts`,
    { signal },
  );
}

export function confirmGiftDelivery(
  programId: string,
  giftRecipientId: string,
  input: { delivery_method?: string },
): Promise<GiftRecipientResponse> {
  return apiRequest<GiftRecipientResponse>(
    `/programs/${encodeURIComponent(programId)}/gifts/recipients/${encodeURIComponent(giftRecipientId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}
