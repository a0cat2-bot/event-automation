import { env } from '../config/env.js';

/**
 * Expands a Knox ID into the email address people are identified by across this app.
 *
 * Two places receive a bare Knox ID rather than a full address: Sally collects "Knox ID / 성명" in
 * question 1 and leaves its own Email column blank, and the SSO gateway may pass a Knox ID in
 * `X-User-ID`. Both need the same address to match an applicant or a user row.
 *
 * A value that already contains "@" is taken as-is; otherwise KNOX_EMAIL_DOMAIN is appended.
 * Returns an empty string when the ID has no domain and none is configured — callers surface that
 * rather than inventing an address, since a guessed address would silently mis-route mail or
 * mis-identify a user.
 */
export function knoxIdToEmail(knoxId: string): string {
  const trimmed = knoxId.trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed;
  const domain = env.knoxEmailDomain?.trim().replace(/^@/, '');
  return domain ? `${trimmed}@${domain}` : '';
}
