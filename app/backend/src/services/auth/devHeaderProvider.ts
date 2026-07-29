import type { IdentityClaim, IdentityProvider } from './types.js';

/**
 * Reads the caller's identity from an `X-Dev-User-Email` header set by hand.
 *
 * DEVELOPMENT ONLY. This lets role-based behaviour be exercised locally without standing up an SSO
 * proxy — switch identities by changing one header. It performs no verification whatsoever, so
 * enabling it in a deployment is equivalent to having no access control at all. `app.ts` logs a
 * startup warning when it is selected.
 */
export class DevHeaderProvider implements IdentityProvider {
  readonly name = 'dev_header';

  resolveIdentity(headers: Record<string, string | string[] | undefined>): IdentityClaim | null {
    const raw = headers['x-dev-user-email'];
    const email = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!email) return null;

    const rawName = headers['x-dev-user-name'];
    const name = (Array.isArray(rawName) ? rawName[0] : rawName)?.trim();

    return { email, name: name || undefined };
  }
}
