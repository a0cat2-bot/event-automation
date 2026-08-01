import { API_BASE_URL } from '../config/api';

async function request(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const actorName = localStorage.getItem('actorName');
  if (actorName?.trim()) {
    // Header values must be ISO-8859-1 — Korean names (or any non-Latin text) throw on
    // Headers.set() otherwise, so the value is percent-encoded and decoded on the backend.
    headers.set('X-Actor-Name', encodeURIComponent(actorName));
  }

  // Development aid for exercising role-based UI without an SSO proxy, paired with the backend's
  // AUTH_PROVIDER=dev_header. Guarded by import.meta.env.DEV so it is stripped from production
  // builds and can never authenticate a real deployment.
  if (import.meta.env.DEV) {
    const devUserEmail = localStorage.getItem('devUserEmail') ?? import.meta.env.VITE_DEV_USER_EMAIL;
    if (devUserEmail) headers.set('X-Dev-User-Email', devUserEmail);
  }

  return fetch(`${API_BASE_URL.replace(/\/$/, '')}${path}`, {
    ...init,
    headers,
  });
}

async function errorMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  return payload?.message ?? payload?.error ?? '요청을 처리하지 못했습니다.';
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
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

export async function apiBlobRequest(path: string, init?: RequestInit): Promise<Blob> {
  const response = await request(path, init);
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.blob();
}
