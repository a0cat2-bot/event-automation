import { Router } from 'express';

import { applicantsRouter } from './applicants.js';
import { auditLogsRouter } from './auditLogs.js';
import { businessUnitsRouter } from './businessUnits.js';
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

export const apiRouter = Router();

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
