import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { getIdentityProvider, isAuthEnforced } from '../services/auth/index.js';
import {
  canAccessBusinessUnit,
  isUserRole,
  roleAtLeast,
  type AuthenticatedUser,
  type UserRole,
} from '../services/auth/types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * The identity used when AUTH_PROVIDER=disabled. Preserves the app's previous behaviour: full
 * access, with the actor name taken from whatever the client claims.
 */
function unauthenticatedAdmin(request: Request): AuthenticatedUser {
  const claimed = request.header('X-Actor-Name');
  const name = claimed ? decodeURIComponent(claimed) : null;
  return {
    id: '00000000-0000-0000-0000-000000000000',
    email: 'unauthenticated@localhost',
    name,
    role: 'admin',
    businessUnitIds: [],
  };
}

function bootstrapAdminEmails(): string[] {
  return env.authBootstrapAdmins
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  business_unit_ids: string[] | null;
  is_active: boolean;
}

/**
 * Resolves the caller into an AuthenticatedUser and attaches it to `request.user`.
 *
 * Does not reject anonymous requests on its own — `requireRole` does that — so that public
 * endpoints (health checks, the session lookup itself) can share the same pipeline.
 */
export async function authenticate(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const provider = getIdentityProvider();

  if (!provider) {
    request.user = unauthenticatedAdmin(request);
    next();
    return;
  }

  const claim = provider.resolveIdentity(request.headers);
  if (!claim) {
    next();
    return;
  }

  const email = claim.email.trim().toLowerCase();
  const isBootstrapAdmin = bootstrapAdminEmails().includes(email);

  try {
    const { rows } = await pool.query<UserRow>(
      `SELECT id, email, name, role, business_unit_ids, is_active
         FROM users
        WHERE LOWER(email) = $1`,
      [email],
    );
    let row = rows[0];

    // A bootstrap admin who has never signed in is provisioned on first contact, so a fresh
    // deployment always has someone able to administer it.
    if (!row && isBootstrapAdmin) {
      const inserted = await pool.query<UserRow>(
        `INSERT INTO users (email, name, role)
              VALUES ($1, $2, 'admin')
         ON CONFLICT (email) DO UPDATE SET name = COALESCE(users.name, EXCLUDED.name)
           RETURNING id, email, name, role, business_unit_ids, is_active`,
        [email, claim.name ?? null],
      );
      row = inserted.rows[0];
    }

    if (!row) {
      response.status(403).json({
        error: 'This account has not been granted access to the application.',
        email,
      });
      return;
    }

    if (!row.is_active) {
      response.status(403).json({ error: 'This account has been deactivated.' });
      return;
    }

    // A configured bootstrap admin keeps admin rights even if the row says otherwise, so an
    // accidental self-demotion cannot lock every administrator out.
    const role: UserRole = isBootstrapAdmin
      ? 'admin'
      : isUserRole(row.role)
        ? row.role
        : 'viewer';

    request.user = {
      id: row.id,
      email: row.email,
      name: row.name ?? claim.name ?? null,
      role,
      businessUnitIds: row.business_unit_ids ?? [],
    };

    await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [row.id]);
    next();
  } catch (error) {
    next(error);
  }
}

/** Rejects the request unless the caller is authenticated and holds at least `minimum`. */
export function requireRole(minimum: UserRole) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.user) {
      response.status(401).json({ error: 'Sign-in required.' });
      return;
    }
    if (!roleAtLeast(request.user.role, minimum)) {
      response.status(403).json({
        error: 'Your role does not permit this action.',
        requiredRole: minimum,
        yourRole: request.user.role,
      });
      return;
    }
    next();
  };
}

/**
 * Read/write split for routers that serve both: any safe method needs `readRole`, anything that
 * mutates needs `writeRole`.
 *
 * Preferred over a plain `requireRole` mount, which only sets a floor and would let a viewer POST
 * to a router mounted at viewer level.
 */
export function requireRoleByMethod(readRole: UserRole, writeRole: UserRole) {
  const readGuard = requireRole(readRole);
  const writeGuard = requireRole(writeRole);

  return (request: Request, response: Response, next: NextFunction): void => {
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    (isRead ? readGuard : writeGuard)(request, response, next);
  };
}

/**
 * Rejects the request when the caller may not act in `businessUnitId`.
 *
 * Fails closed: with access control enabled and no resolved user, this denies rather than allows.
 */
export function assertBusinessUnitAccess(
  request: Request,
  response: Response,
  businessUnitId: string,
): boolean {
  if (!isAuthEnforced()) return true;

  if (!request.user) {
    response.status(401).json({ error: 'Sign-in required.' });
    return false;
  }
  if (!canAccessBusinessUnit(request.user, businessUnitId)) {
    response.status(403).json({ error: 'This program belongs to another business unit.' });
    return false;
  }
  return true;
}
