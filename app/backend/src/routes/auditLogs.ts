import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';

const auditLogQuery = z.object({ program_id: z.string().uuid().optional() });

interface AuditLogRow {
  id: string;
  user_id: string | null;
  actor_name: string | null;
  action: string | null;
  entity_type: string | null;
  entity_id: string | null;
  program_id: string | null;
  details: unknown;
  ip_address: string | null;
  timestamp: Date;
}

const auditLogColumns = `id, user_id, actor_name, action, entity_type, entity_id,
       program_id, details, ip_address, timestamp`;

async function queryAuditLogs(programId?: string) {
  return pool.query<AuditLogRow>(
    `SELECT ${auditLogColumns}
     FROM audit_logs
     WHERE ($1::uuid IS NULL OR program_id = $1)
     ORDER BY timestamp DESC, id DESC
     LIMIT 200`,
    [programId ?? null],
  );
}

function csvCell(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export const auditLogsRouter = Router();

auditLogsRouter.get(
  '/audit-logs',
  validate({ query: auditLogQuery }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = auditLogQuery.parse(request.query);
      const result = await queryAuditLogs(query.program_id);
      response.json({ entries: result.rows });
    } catch (error) {
      next(error);
    }
  },
);

auditLogsRouter.get(
  '/audit-logs/export',
  validate({ query: auditLogQuery }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = auditLogQuery.parse(request.query);
      const result = await queryAuditLogs(query.program_id);
      const headers = [
        'id',
        'user_id',
        'actor_name',
        'action',
        'entity_type',
        'entity_id',
        'program_id',
        'details',
        'ip_address',
        'timestamp',
      ];
      const rows = result.rows.map((entry) =>
        [
          entry.id,
          entry.user_id,
          entry.actor_name,
          entry.action,
          entry.entity_type,
          entry.entity_id,
          entry.program_id,
          JSON.stringify(entry.details),
          entry.ip_address,
          entry.timestamp,
        ]
          .map(csvCell)
          .join(','),
      );

      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
      response.send([headers.map(csvCell).join(','), ...rows].join('\r\n'));
    } catch (error) {
      next(error);
    }
  },
);
