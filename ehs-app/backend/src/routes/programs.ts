import { Router } from 'express';

import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../schemas/common.js';
import { programCreateBody, programUpdateBody } from '../schemas/contracts.js';
import { notImplemented } from '../utils/notImplemented.js';

export const programsRouter = Router();

// TODO(DESIGN.md §8, Program Setup): Persist a planning program and its intake metadata.
programsRouter.post(
  '/programs',
  requireRole('admin', 'coordinator'),
  validate({ body: programCreateBody }),
  notImplemented('§8 (Program Setup)', 'Create program'),
);

// TODO(DESIGN.md §8, Dashboard/Program Detail): Load a program and workflow summary.
programsRouter.get(
  '/programs/:id',
  validate({ params: idParams }),
  notImplemented('§8 (Dashboard)', 'Retrieve program details'),
);

// TODO(DESIGN.md §8, Program Setup): Update program metadata and lifecycle status.
programsRouter.put(
  '/programs/:id',
  requireRole('admin', 'coordinator'),
  validate({ params: idParams, body: programUpdateBody }),
  notImplemented('§8 (Program Setup)', 'Update program'),
);

// TODO(DESIGN.md §11): Filter programs by the authenticated user's business units.
programsRouter.get(
  '/programs',
  notImplemented('§8 (Dashboard) and §11', 'List programs'),
);
