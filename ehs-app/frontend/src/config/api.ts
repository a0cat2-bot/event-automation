/** Base URL shared by frontend API clients. */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export function resolveBackendAssetUrl(path: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(path)) {
    return path;
  }

  const apiUrl = new URL(API_BASE_URL, window.location.origin);
  return new URL(path, apiUrl.origin).toString();
}
