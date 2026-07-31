import { env } from '../../config/env.js';
import { knoxIdToEmail } from '../../utils/knoxId.js';
import type { IdentityClaim, IdentityProvider } from './types.js';

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name.toLowerCase()];
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Takes the caller's identity from headers injected by the corporate SSO gateway.
 *
 * Header names follow the AI Pro developer guide, which documents the gateway verifying the JWT
 * and passing `X-User-ID` and `X-User-Roles` downstream. They remain configurable because that
 * guide describes the AI Pro gateway specifically, and this app may sit behind a different one.
 *
 * `X-User-Roles` is deliberately NOT consumed. The roles it carries are corporate-wide, whereas
 * this app's roles (admin / coordinator / viewer) and its business-unit scoping are
 * application-specific and live in the users table. Taking authorization from the gateway would
 * mean two disagreeing sources of truth for who may run a selection.
 *
 * SECURITY: this provider trusts its headers completely, which is only safe when the application
 * is reachable *exclusively* through the gateway and the gateway strips these headers from inbound
 * client requests. If the backend port is directly reachable, anyone can impersonate anyone by
 * setting a header.
 */
export class SsoHeaderProvider implements IdentityProvider {
  readonly name = 'sso_header';

  resolveIdentity(headers: Record<string, string | string[] | undefined>): IdentityClaim | null {
    const raw =
      readHeader(headers, env.authSsoEmailHeader) ?? readHeader(headers, env.authSsoUserHeader);
    if (!raw) return null;

    // The gateway may pass a bare Knox ID rather than a full address; users are keyed by email.
    const email = knoxIdToEmail(raw);
    if (!email) return null;

    return {
      email,
      name: readHeader(headers, env.authSsoNameHeader) ?? undefined,
    };
  }
}
