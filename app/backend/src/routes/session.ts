import { Router } from 'express';

import { isAuthEnforced } from '../services/auth/index.js';

export const sessionRouter = Router();

/**
 * Reports who the caller is and what the deployment enforces, so the frontend can hide actions the
 * user cannot perform and show a clear message when nobody is signed in.
 */
sessionRouter.get('/session', (request, response) => {
  response.json({
    authEnforced: isAuthEnforced(),
    user: request.user
      ? {
          id: request.user.id,
          email: request.user.email,
          name: request.user.name,
          role: request.user.role,
          business_unit_ids: request.user.businessUnitIds,
        }
      : null,
  });
});
