import { Router } from 'express';

import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { programParams } from '../schemas/common.js';
import { sallyWebhookBody } from '../schemas/contracts.js';
import { notImplemented } from '../utils/notImplemented.js';

export const surveysRouter = Router();
export const sallyWebhookRouter = Router();

// TODO(DESIGN.md §7): Call Sally to send participant survey invitations and track IDs/status.
surveysRouter.post(
  '/programs/:program_id/surveys/send',
  requireRole('admin', 'coordinator'),
  validate({ params: programParams }),
  notImplemented('§7 (Sally API Shape)', 'Send survey invitations'),
);

// TODO(DESIGN.md §7): Return matched Sally results and completion metrics for the program.
surveysRouter.get(
  '/programs/:program_id/survey-results',
  validate({ params: programParams }),
  notImplemented('§7', 'Fetch survey results'),
);

// TODO(DESIGN.md §7): Verify Sally, match by email/program, and persist the survey result.
sallyWebhookRouter.post(
  '/webhooks/sally/survey-complete',
  validate({ body: sallyWebhookBody }),
  notImplemented('§7 (Webhook Payload)', 'Ingest Sally survey completion'),
);
