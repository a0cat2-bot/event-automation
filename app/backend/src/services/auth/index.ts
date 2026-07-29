import { env } from '../../config/env.js';
import { DevHeaderProvider } from './devHeaderProvider.js';
import { SsoHeaderProvider } from './ssoHeaderProvider.js';
import type { IdentityProvider } from './types.js';

export type {
  AuthenticatedUser,
  IdentityClaim,
  IdentityProvider,
  UserRole,
} from './types.js';
export { canAccessBusinessUnit, isUserRole, roleAtLeast, USER_ROLES } from './types.js';

export const AUTH_PROVIDERS = ['disabled', 'dev_header', 'sso_header'] as const;
export type AuthProviderName = (typeof AUTH_PROVIDERS)[number];

export interface AuthConfig {
  authProvider: string;
}

/**
 * Returns the configured identity provider, or null when access control is switched off.
 *
 * `disabled` preserves the app's previous no-auth behaviour: every request is treated as an admin
 * and the actor is whatever name the client claims. That is the default so existing deployments
 * keep working, but it provides no access control — `app.ts` logs a startup warning.
 */
export function resolveIdentityProvider(config: AuthConfig): IdentityProvider | null {
  if (config.authProvider === 'disabled') return null;
  if (config.authProvider === 'dev_header') return new DevHeaderProvider();
  if (config.authProvider === 'sso_header') return new SsoHeaderProvider();

  throw new Error(
    `Unsupported AUTH_PROVIDER "${config.authProvider}". Expected one of: ${AUTH_PROVIDERS.join(', ')}.`,
  );
}

export function getIdentityProvider(): IdentityProvider | null {
  return resolveIdentityProvider(env);
}

/** Whether role-based access control is being enforced on this deployment. */
export function isAuthEnforced(): boolean {
  return env.authProvider !== 'disabled';
}
