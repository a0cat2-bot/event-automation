import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';

import { env } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { uploadsRoot } from './utils/storage.js';

export const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: env.frontendOrigin }));
app.use(express.json({ limit: '1mb' }));

// Backgrounds are loaded directly by the editor; generated letters use opaque UUID names.
app.use('/uploads', express.static(uploadsRoot));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'event-automation-backend' });
});

app.use('/api/v1', apiRouter);

app.use((_request, response) => {
  response.status(404).json({ error: 'Route not found' });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof multer.MulterError) {
    response.status(400).json({ error: 'File upload rejected', code: error.code });
    return;
  }

  console.error(error);
  response.status(500).json({ error: 'Unexpected server error' });
};

app.use(errorHandler);
