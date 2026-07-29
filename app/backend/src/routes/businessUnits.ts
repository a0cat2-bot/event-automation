import { randomUUID } from 'node:crypto';

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../schemas/common.js';
import { businessUnitCreateBody, businessUnitUpdateBody } from '../schemas/contracts.js';

interface BusinessUnitRow {
  id: string;
  name: string;
  is_active: boolean;
  created_at: Date;
}

const businessUnitsQuery = z.object({
  active: z.enum(['true']).optional(),
});

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

export const businessUnitsRouter = Router();

businessUnitsRouter.get(
  '/business-units',
  validate({ query: businessUnitsQuery }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { active } = businessUnitsQuery.parse(request.query);
      const result = await pool.query<BusinessUnitRow>(
        `SELECT id, name, is_active, created_at
         FROM business_units
         WHERE ($1::boolean IS NULL OR is_active = TRUE)
         ORDER BY name ASC`,
        [active === 'true' ? true : null],
      );

      response.json({ business_units: result.rows });
    } catch (error) {
      next(error);
    }
  },
);

businessUnitsRouter.post(
  '/business-units',
  validate({ body: businessUnitCreateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { name } = businessUnitCreateBody.parse(request.body);
      const result = await pool.query<BusinessUnitRow>(
        `INSERT INTO business_units (id, name, is_active)
         VALUES ($1, $2, TRUE)
         RETURNING id, name, is_active, created_at`,
        [randomUUID(), name],
      );

      response.status(201).json({ business_unit: result.rows[0] });
    } catch (error) {
      if (isUniqueViolation(error)) {
        response.status(409).json({ error: '이미 존재하는 사업부입니다.' });
        return;
      }
      next(error);
    }
  },
);

businessUnitsRouter.put(
  '/business-units/:id',
  validate({ params: idParams, body: businessUnitUpdateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = businessUnitUpdateBody.parse(request.body);
      const result = await pool.query<BusinessUnitRow>(
        `UPDATE business_units
         SET name = COALESCE($2, name),
             is_active = COALESCE($3::boolean, is_active),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, is_active, created_at`,
        [request.params.id, input.name ?? null, input.is_active ?? null],
      );
      const businessUnit = result.rows[0];
      if (!businessUnit) {
        response.status(404).json({ error: '사업부를 찾을 수 없습니다.' });
        return;
      }

      response.json({ business_unit: businessUnit });
    } catch (error) {
      if (isUniqueViolation(error)) {
        response.status(409).json({ error: '이미 존재하는 사업부입니다.' });
        return;
      }
      next(error);
    }
  },
);
