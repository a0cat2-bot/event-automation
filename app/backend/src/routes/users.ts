import { Router } from 'express';
import { z } from 'zod';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../services/auth/types.js';

export const usersRouter = Router();

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  business_unit_ids: string[] | null;
  is_active: boolean;
  last_seen_at: Date | null;
  created_at: Date;
}

const userColumns = `id, email, name, role, business_unit_ids, is_active, last_seen_at, created_at`;

function serialize(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    business_unit_ids: row.business_unit_ids ?? [],
    is_active: row.is_active,
    last_seen_at: row.last_seen_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}

usersRouter.get('/users', async (_request, response, next) => {
  try {
    const { rows } = await pool.query<UserRow>(
      `SELECT ${userColumns} FROM users ORDER BY role DESC, email`,
    );
    response.json({ users: rows.map(serialize) });
  } catch (error) {
    next(error);
  }
});

const createUserSchema = z.object({
  email: z.string().trim().email().max(255),
  name: z.string().trim().max(255).optional(),
  role: z.enum(USER_ROLES),
  business_unit_ids: z.array(z.string().uuid()).optional(),
});

usersRouter.post(
  '/users',
  validate({ body: createUserSchema }),
  async (request, response, next) => {
    const body = request.body as z.infer<typeof createUserSchema>;
    try {
      const { rows } = await pool.query<UserRow>(
        `INSERT INTO users (email, name, role, business_unit_ids)
              VALUES ($1, $2, $3, $4)
           RETURNING ${userColumns}`,
        [
          body.email.toLowerCase(),
          body.name ?? null,
          body.role,
          body.business_unit_ids ?? [],
        ],
      );
      response.status(201).json({ user: serialize(rows[0]!) });
    } catch (error) {
      // 23505 = unique_violation on the email index.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        response.status(409).json({ error: '이미 등록된 이메일입니다.' });
        return;
      }
      next(error);
    }
  },
);

const updateUserSchema = z
  .object({
    name: z.string().trim().max(255).nullable().optional(),
    role: z.enum(USER_ROLES).optional(),
    business_unit_ids: z.array(z.string().uuid()).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: '변경할 항목이 없습니다.' });

usersRouter.put(
  '/users/:id',
  validate({ params: z.object({ id: z.string().uuid() }), body: updateUserSchema }),
  async (request, response, next) => {
    const { id } = request.params as { id: string };
    const body = request.body as z.infer<typeof updateUserSchema>;

    // Guard against an admin removing the last remaining admin and locking everyone out. Checked
    // for both a role change and a deactivation, since either one can be the last exit.
    const losesAdmin = (body.role !== undefined && body.role !== 'admin') || body.is_active === false;
    if (losesAdmin) {
      const { rows } = await pool.query<{ remaining: string }>(
        `SELECT COUNT(*)::text AS remaining
           FROM users
          WHERE role = 'admin' AND is_active = TRUE AND id <> $1`,
        [id],
      );
      if (Number(rows[0]?.remaining ?? '0') === 0) {
        response.status(409).json({
          error: '마지막 관리자입니다. 다른 관리자를 먼저 지정한 뒤 변경하세요.',
        });
        return;
      }
    }

    try {
      const { rows } = await pool.query<UserRow>(
        `UPDATE users
            SET name = COALESCE($2, name),
                role = COALESCE($3, role),
                business_unit_ids = COALESCE($4, business_unit_ids),
                is_active = COALESCE($5, is_active),
                updated_at = NOW()
          WHERE id = $1
      RETURNING ${userColumns}`,
        [
          id,
          body.name ?? null,
          body.role ?? null,
          body.business_unit_ids ?? null,
          body.is_active ?? null,
        ],
      );

      const row = rows[0];
      if (!row) {
        response.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
        return;
      }
      response.json({ user: serialize(row) });
    } catch (error) {
      next(error);
    }
  },
);
