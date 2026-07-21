import { Router } from 'express';

import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { programParams, reportParams } from '../schemas/common.js';
import { reportGenerateBody } from '../schemas/contracts.js';
import { notImplemented } from '../utils/notImplemented.js';

export const reportsRouter = Router();

// TODO(DESIGN.md §9): Render report output and optionally create a Confluence draft page.
reportsRouter.post(
  '/programs/:program_id/reports/generate',
  requireRole('admin', 'coordinator'),
  validate({ params: programParams, body: reportGenerateBody }),
  notImplemented('§9 (Report Generation API)', 'Generate results report'),
);

// TODO(DESIGN.md §9): Authorize and return report job metadata or the generated artifact.
reportsRouter.get(
  '/programs/:program_id/reports/:report_id',
  validate({ params: reportParams }),
  notImplemented('§9', 'Retrieve results report'),
);
