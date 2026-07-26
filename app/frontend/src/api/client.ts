import { API_BASE_URL } from '../config/api';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const actorName = localStorage.getItem('actorName');
  if (actorName?.trim()) {
    // Header values must be ISO-8859-1 — Korean names (or any non-Latin text) throw on
    // Headers.set() otherwise, so the value is percent-encoded and decoded on the backend.
    headers.set('X-Actor-Name', encodeURIComponent(actorName));
  }

  const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}${path}`, {
    ...init,
    headers,
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
