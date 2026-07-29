import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';

import { env } from './config/env.js';
import { authenticate } from './middleware/auth.js';
import { apiRouter } from './routes/index.js';
import { uploadsRoot } from './utils/storage.js';

export const app = express();

if (env.authProvider === 'disabled') {
  console.warn(
    '[auth] AUTH_PROVIDER=disabled — every request is treated as an admin and the actor name is unverified. Set AUTH_PROVIDER=sso_header before deploying.',
  );
} else if (env.authProvider === 'dev_header') {
  console.warn(
    '[auth] AUTH_PROVIDER=dev_header — identity is read from an unverified X-Dev-User-Email header. Development only.',
  );
}

app.disable('x-powered-by');
app.use(cors({ origin: env.frontendOrigin }));
app.use(express.json({ limit: '1mb' }));

// Backgrounds are loaded directly by the editor; generated letters use opaque UUID names.
app.use('/uploads', express.static(uploadsRoot));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'event-automation-backend' });
});

app.use('/api/v1', authenticate, apiRouter);

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
