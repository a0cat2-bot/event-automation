import bcrypt from 'bcryptjs';
import { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import {
  authenticate,
  type AuthenticatedPrincipal,
  type UserRole,
  userRoles,
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginBody } from '../schemas/contracts.js';

export const authRouter = Router();

const sessionDurationMs = 24 * 60 * 60 * 1000;
const invalidCredentialsResponse = { error: 'invalid credentials' } as const;

// A valid hash keeps the password comparison path similar when no user is found.
const dummyPasswordHash = '$2y$12$HxOuemZwKhNWoFRl3wNl7ObA.CTveHQI3B1NrnS9AI/7pKjY/3kES';

interface UserRow {
  id: string;
  email: string;
  role: UserRole | null;
  business_units: string[] | null;
  hashed_password: string | null;
}

function isUserRole(role: UserRow['role']): role is UserRole {
  return role !== null && userRoles.includes(role);
}

const sessionCookieOptions = {
  httpOnly: true,
  // Secure requires HTTPS; local dev runs the API over plain http://localhost,
  // and browsers/HTTP clients that don't special-case localhost (e.g. Python
  // requests) silently drop a Secure cookie set over http, so the session
  // cookie never comes back on the next request. Gate it on NODE_ENV instead.
  secure: env.isProduction,
  sameSite: 'lax' as const,
  path: '/',
};

authRouter.post(
  '/login',
  validate({ body: loginBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { email, password } = request.body as { email: string; password: string };
      const result = await pool.query<UserRow>(
        `SELECT id, email, role, business_units, hashed_password
         FROM users
         WHERE LOWER(email) = LOWER($1) AND is_active = TRUE
         LIMIT 1`,
        [email],
      );
      const user = result.rows[0];

      let passwordMatches = false;
      try {
        passwordMatches = await bcrypt.compare(
          password,
          user?.hashed_password ?? dummyPasswordHash,
        );
      } catch {
        passwordMatches = false;
      }

      if (!user || !user.hashed_password || !passwordMatches || !isUserRole(user.role)) {
        response.status(401).json(invalidCredentialsResponse);
        return;
      }

      const principal: AuthenticatedPrincipal = {
        user_id: user.id,
        email: user.email,
        role: user.role,
        business_units: user.business_units ?? [],
      };
      const token = jwt.sign(principal, env.jwtSecret, {
        algorithm: 'HS256',
        expiresIn: '24h',
      });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1',
          [user.id],
        );
        await client.query(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
           VALUES ($1, 'user_login', 'user', $1, $2::jsonb, $3)`,
          [
            user.id,
            JSON.stringify({ business_units: principal.business_units }),
            request.ip || null,
          ],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      response.cookie(env.jwtCookieName, token, {
        ...sessionCookieOptions,
        maxAge: sessionDurationMs,
      });
      response.json(principal);
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post('/logout', (_request, response) => {
  response.clearCookie(env.jwtCookieName, sessionCookieOptions);
  response.status(204).send();
});

authRouter.get('/me', authenticate, (request, response) => {
  response.json(request.user);
});
