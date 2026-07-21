import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../middleware/validate.js';
import { notImplemented } from '../utils/notImplemented.js';

const auditLogQuery = z.object({ program_id: z.string().uuid().optional() });

export const auditLogsRouter = Router();

// TODO(DESIGN.md §11): Query authorized audit entries, filtered by optional program_id.
auditLogsRouter.get(
  '/audit-logs',
  validate({ query: auditLogQuery }),
  notImplemented('§11 (Audit Logging)', 'List audit logs'),
);

// TODO(DESIGN.md §11): Export authorized audit entries as CSV.
auditLogsRouter.get(
  '/audit-logs/export',
  validate({ query: auditLogQuery }),
  notImplemented('§11 (Audit Logging)', 'Export audit logs'),
);
