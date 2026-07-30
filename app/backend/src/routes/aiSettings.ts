import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../middleware/validate.js';
import { env } from '../config/env.js';
import { isLlmConfigured } from '../services/llm/index.js';
import { readAiSettings, writeAiSettings } from '../services/llm/featureFlags.js';
import { getActorName } from '../utils/actor.js';

export const aiSettingsRouter = Router();

/**
 * Reports both gates so the UI can explain *why* a toggle is unavailable rather than just
 * disabling it: `provider`/`configured` describe the deployment-level gate, `flags` the per-feature
 * one.
 */
aiSettingsRouter.get('/ai-settings', async (_request, response, next) => {
  try {
    const { flags, updatedAt, updatedBy } = await readAiSettings();
    response.json({
      provider: env.llmProvider,
      configured: isLlmConfigured(),
      flags,
      updated_at: updatedAt,
      updated_by: updatedBy,
    });
  } catch (error) {
    next(error);
  }
});

const updateBody = z
  .object({
    justification_screening: z.boolean().optional(),
    letter_copy: z.boolean().optional(),
    survey_summary: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: '변경할 항목이 없습니다.' });

aiSettingsRouter.put(
  '/ai-settings',
  validate({ body: updateBody }),
  async (request, response, next) => {
    const body = request.body as z.infer<typeof updateBody>;
    try {
      // Refuse to switch a feature on when no provider could serve it — otherwise the setting
      // would read as enabled while every call silently fell back to the non-AI path.
      const turningSomethingOn = Object.values(body).some((value) => value === true);
      if (turningSomethingOn && !isLlmConfigured()) {
        response.status(409).json({
          error:
            'AI 제공자가 설정되지 않아 기능을 켤 수 없습니다. 서버의 LLM_PROVIDER와 인증 정보를 먼저 설정하세요.',
          provider: env.llmProvider,
        });
        return;
      }

      const flags = await writeAiSettings(body, getActorName(request));
      response.json({ provider: env.llmProvider, configured: isLlmConfigured(), flags });
    } catch (error) {
      next(error);
    }
  },
);
