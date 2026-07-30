import type { Request } from 'express';

import { isAuthEnforced } from '../services/auth/index.js';

/**
 * The name recorded against an action in the audit log.
 *
 * When access control is enforced, this is the authenticated identity — the client cannot
 * influence it, which is what makes the audit trail trustworthy. The self-declared X-Actor-Name
 * header is only consulted on deployments running without access control, where it is the sole
 * available attribution and is understood to be unverified.
 */
export function getActorName(request: Request): string | null {
  if (isAuthEnforced() && request.user) {
    return request.user.name ?? request.user.email;
  }

  const header = request.get('x-actor-name')?.trim();
  if (!header) return null;
  try {
    return decodeURIComponent(header) || null;
  } catch {
    // Malformed percent-encoding (e.g. a stale un-encoded client) — fall back to the raw value.
    return header;
  }
}
