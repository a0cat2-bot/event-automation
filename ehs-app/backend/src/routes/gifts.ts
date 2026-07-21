import { Router } from 'express';

import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { programParams } from '../schemas/common.js';
import { notImplemented } from '../utils/notImplemented.js';

export const giftsRouter = Router();

// TODO(DESIGN.md §10): Apply eligibility, random selection, and optional manual overrides.
giftsRouter.post(
  '/programs/:program_id/gifts/select',
  requireRole('admin', 'coordinator'),
  validate({ params: programParams }),
  notImplemented('§10 (Algorithm Options & Selected Approach)', 'Select gift recipients'),
);

// TODO(DESIGN.md §10): Return recipients and gift fulfillment status.
giftsRouter.get(
  '/programs/:program_id/gifts',
  validate({ params: programParams }),
  notImplemented('§10', 'List gift recipients'),
);
