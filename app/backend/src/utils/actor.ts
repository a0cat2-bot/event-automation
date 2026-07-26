import type { Request } from 'express';

export function getActorName(request: Request): string | null {
  const header = request.get('x-actor-name')?.trim();
  if (!header) return null;
  try {
    return decodeURIComponent(header) || null;
  } catch {
    // Malformed percent-encoding (e.g. a stale un-encoded client) — fall back to the raw value.
    return header;
  }
}
