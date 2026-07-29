export const USER_ROLES = ['admin', 'coordinator', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** An identity claim asserted by the configured provider, before it is matched to a user row. */
export interface IdentityClaim {
  email: string;
  name?: string | undefined;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  /** Business units this user may act in. Empty means all — the normal state for admins. */
  businessUnitIds: string[];
}

/**
 * Resolves *who* is making a request. Deliberately does not verify credentials: authentication is
 * delegated to the corporate SSO / reverse proxy, and this application only performs authorization.
 * No provider here stores or checks a password.
 */
export interface IdentityProvider {
  /** Provider id as configured — recorded in the audit log alongside the resolved user. */
  readonly name: string;
  /**
   * Returns the claimed identity, or null when the request carries none. Returning null is not an
   * error; the caller decides whether anonymous access is permitted.
   */
  resolveIdentity(headers: Record<string, string | string[] | undefined>): IdentityClaim | null;
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

/** Ranked least- to most-privileged, so route guards can express "at least this role". */
const ROLE_RANK: Record<UserRole, number> = { viewer: 0, coordinator: 1, admin: 2 };

export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Admins (and any user with no explicit list) may act across every business unit. */
export function canAccessBusinessUnit(user: AuthenticatedUser, businessUnitId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.businessUnitIds.length === 0) return true;
  return user.businessUnitIds.includes(businessUnitId);
}
