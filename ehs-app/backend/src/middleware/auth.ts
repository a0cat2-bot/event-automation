import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';

import { env } from '../config/env.js';

export const userRoles = ['admin', 'coordinator', 'viewer'] as const;
export type UserRole = (typeof userRoles)[number];

export interface AuthenticatedPrincipal {
  user_id: string;
  email: string;
  role: UserRole;
  business_units: string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedPrincipal;
  }
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && userRoles.includes(value as UserRole);
}

function decodePrincipal(payload: string | JwtPayload): AuthenticatedPrincipal | null {
  if (
    typeof payload === 'string' ||
    typeof payload.user_id !== 'string' ||
    typeof payload.email !== 'string' ||
    !isUserRole(payload.role) ||
    !Array.isArray(payload.business_units) ||
    !payload.business_units.every((unit) => typeof unit === 'string')
  ) {
    return null;
  }

  return {
    user_id: payload.user_id,
    email: payload.email,
    role: payload.role,
    business_units: payload.business_units,
  };
}

/**
 * Verifies the stateless session cookie and attaches its principal to request.user.
 */
export function authenticate(request: Request, response: Response, next: NextFunction) {
  const token = request.cookies?.[env.jwtCookieName] as unknown;

  if (typeof token !== 'string') {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    const principal = decodePrincipal(payload);

    if (!principal) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }

    request.user = principal;
    next();
  } catch {
    response.status(401).json({ error: 'Unauthorized' });
  }
}

/** Restricts a route to one or more roles after authenticate has run. */
export function requireRole(...roles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.user) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!roles.includes(request.user.role)) {
      response.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  };
}
