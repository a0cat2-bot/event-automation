import { apiRequest } from './client';

export const USER_ROLES = ['viewer', 'coordinator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: '관리자',
  coordinator: '코디네이터',
  viewer: '조회자',
};

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  business_unit_ids: string[];
};

export type Session = {
  /** False when the deployment runs without access control; every action is then permitted. */
  authEnforced: boolean;
  user: SessionUser | null;
};

export function getSession(signal?: AbortSignal): Promise<Session> {
  return apiRequest<Session>('/session', { signal });
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, coordinator: 1, admin: 2 };

/**
 * Whether the session permits an action needing at least `minimum`.
 *
 * Mirrors the backend's `roleAtLeast`. This only decides what the UI offers — the backend enforces
 * the same rule independently, so hiding a control is never the sole protection.
 */
export function sessionAllows(session: Session | null, minimum: UserRole): boolean {
  if (!session) return false;
  if (!session.authEnforced) return true;
  if (!session.user) return false;
  return ROLE_RANK[session.user.role] >= ROLE_RANK[minimum];
}
