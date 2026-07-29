import { env } from '../../config/env.js';
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
 * Takes the caller's identity from headers injected by the corporate SSO reverse proxy.
 *
 * SECURITY: this provider trusts its headers completely, which is only safe when the application
 * is reachable *exclusively* through the proxy and the proxy strips these headers from inbound
 * client requests. If the backend port is directly reachable, anyone can impersonate anyone by
 * setting a header. Do not enable this provider until that network path is confirmed.
 *
 * The default header names below (`X-Forwarded-User` / `X-Forwarded-Email` / `X-Forwarded-
 * DisplayName`) are a BEST-GUESS PLACEHOLDER, not a confirmed internal SSO contract — the same
 * staging approach used by KnoxPortalProvider. Override them with AUTH_SSO_*_HEADER once the real
 * gateway's headers are known.
 */
export class SsoHeaderProvider implements IdentityProvider {
  readonly name = 'sso_header';

  resolveIdentity(headers: Record<string, string | string[] | undefined>): IdentityClaim | null {
    const email =
      readHeader(headers, env.authSsoEmailHeader) ?? readHeader(headers, env.authSsoUserHeader);
    if (!email) return null;

    return {
      email,
      name: readHeader(headers, env.authSsoNameHeader) ?? undefined,
    };
  }
}
