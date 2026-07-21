import { Router } from 'express';

import { applicantsRouter } from './applicants.js';
import { auditLogsRouter } from './auditLogs.js';
import { giftsRouter } from './gifts.js';
import { lettersRouter } from './letters.js';
import { letterTemplatesRouter } from './letterTemplates.js';
import { participantsRouter } from './participants.js';
import { programsRouter } from './programs.js';
import { reportsRouter } from './reports.js';
import { sallyRouter } from './sally.js';
import { selectionRouter } from './selection.js';
import { surveysRouter } from './surveys.js';

export const apiRouter = Router();

apiRouter.use(programsRouter);
apiRouter.use(applicantsRouter);
apiRouter.use(sallyRouter);
apiRouter.use(selectionRouter);
apiRouter.use(participantsRouter);
apiRouter.use(lettersRouter);
apiRouter.use(letterTemplatesRouter);
apiRouter.use(surveysRouter);
apiRouter.use(giftsRouter);
apiRouter.use(reportsRouter);
apiRouter.use(auditLogsRouter);
