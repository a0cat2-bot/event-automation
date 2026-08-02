import { Router } from 'express';

import { requireRole, requireRoleByMethod } from '../middleware/auth.js';
import { aiSettingsRouter } from './aiSettings.js';
import { applicantsRouter } from './applicants.js';
import { auditLogsRouter } from './auditLogs.js';
import { businessUnitsRouter } from './businessUnits.js';
import { cycleMetricsRouter } from './cycleMetrics.js';
import { giftsRouter } from './gifts.js';
import { letterCategoriesRouter } from './letterCategories.js';
import { lettersRouter } from './letters.js';
import { letterTemplatesRouter } from './letterTemplates.js';
import { orgSettingsRouter } from './orgSettings.js';
import { participantsRouter } from './participants.js';
import { programLetterContentRouter } from './programLetterContent.js';
import { programsRouter } from './programs.js';
import { reportsRouter } from './reports.js';
import { sallyRouter } from './sally.js';
import { selectionRouter } from './selection.js';
import { sessionRouter } from './session.js';
import { usersRouter } from './users.js';

export const apiRouter = Router();

// Guards are attached to PATH PREFIXES, not bare `apiRouter.use(guard, router)`. Every router below
// declares absolute paths and is mounted at the API root, so a bare `use` would apply its guard to
// every later request too — an admin-only router would silently raise the bar for all of them.

// Always reachable: the frontend calls this before it knows whether anyone is signed in.
apiRouter.use(sessionRouter);

// Org-wide configuration. Reading it is needed to render ordinary screens (letter categories and
// the org name appear on letters), but changing it affects every program, so writes are admin-only.
apiRouter.use('/business-units', requireRoleByMethod('viewer', 'admin'));
apiRouter.use('/org-settings', requireRoleByMethod('viewer', 'admin'));
apiRouter.use('/letter-categories', requireRoleByMethod('viewer', 'admin'));

// Audit history is an oversight function, not an operational one.
apiRouter.use('/audit-logs', requireRole('admin'));

// Effectiveness reporting is oversight, same as the audit history it derives from.
apiRouter.use('/cycle-metrics', requireRole('admin'));

// Granting roles is the most privileged action in the app.
apiRouter.use('/users', requireRole('admin'));

// Whether AI may be used is a governance decision, so only admins may change it. Reading it is
// allowed more widely so ordinary screens can tell whether an AI-assisted action is available.
apiRouter.use('/ai-settings', requireRoleByMethod('viewer', 'admin'));

// Program operation. Viewers may read; only coordinators and above may change anything.
// Business-unit scoping is enforced per program inside the routers.
apiRouter.use('/sally', requireRoleByMethod('viewer', 'coordinator'));
apiRouter.use('/programs', requireRoleByMethod('viewer', 'coordinator'));
apiRouter.use('/letters', requireRoleByMethod('viewer', 'coordinator'));
apiRouter.use('/letter-templates', requireRoleByMethod('viewer', 'coordinator'));

apiRouter.use(programsRouter);
apiRouter.use(businessUnitsRouter);
apiRouter.use(applicantsRouter);
apiRouter.use(sallyRouter);
apiRouter.use(selectionRouter);
apiRouter.use(participantsRouter);
apiRouter.use(lettersRouter);
apiRouter.use(letterTemplatesRouter);
apiRouter.use(programLetterContentRouter);
apiRouter.use(letterCategoriesRouter);
apiRouter.use(orgSettingsRouter);
apiRouter.use(giftsRouter);
apiRouter.use(reportsRouter);
apiRouter.use(auditLogsRouter);
apiRouter.use(usersRouter);
apiRouter.use(aiSettingsRouter);
apiRouter.use(cycleMetricsRouter);
