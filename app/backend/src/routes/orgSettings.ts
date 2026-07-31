import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Router, type NextFunction, type Request, type Response } from 'express';
import { imageSize } from 'image-size';
import multer from 'multer';
import { z } from 'zod';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { generateCharacterImage } from '../services/llm/imageGeneration.js';
import { LlmUnavailableError } from '../services/llm/types.js';
import { getActorName } from '../utils/actor.js';
import { uploadsRoot } from '../utils/storage.js';

interface OrgSettingsRow {
  business_unit: string;
  character_image_url: string | null;
  org_display_name: string;
  default_coordinator_name: string | null;
  default_coordinator_contact: string | null;
  updated_at: Date;
  updated_by: string | null;
}

const orgSettingsUpdateBody = z
  .object({
    org_display_name: z.string().trim().min(1).max(255).optional(),
    default_coordinator_name: z.string().trim().max(255).nullable().optional(),
    default_coordinator_contact: z.string().trim().max(255).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be supplied',
  });

const orgSettingsQuery = z.object({
  business_unit: z.string().trim().max(100).optional().default(''),
});

const characterImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const imageExtensionsByMimeType: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export const orgSettingsRouter = Router();

orgSettingsRouter.get(
  '/org-settings',
  validate({ query: orgSettingsQuery }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { business_unit: businessUnit } = orgSettingsQuery.parse(request.query);
      const result = await pool.query<OrgSettingsRow>(
        `SELECT business_unit, character_image_url, org_display_name, default_coordinator_name,
                default_coordinator_contact, updated_at, updated_by
         FROM org_settings
         WHERE business_unit IN ($1, '')
         ORDER BY CASE WHEN business_unit = $1 THEN 0 ELSE 1 END
         LIMIT 1`,
        [businessUnit],
      );

      response.json({ org_settings: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

orgSettingsRouter.put(
  '/org-settings',
  validate({ query: orgSettingsQuery, body: orgSettingsUpdateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { business_unit: businessUnit } = orgSettingsQuery.parse(request.query);
      const settings = orgSettingsUpdateBody.parse(request.body);
      const result = await pool.query<OrgSettingsRow>(
        `INSERT INTO org_settings
           (business_unit, character_image_url, org_display_name, default_coordinator_name,
            default_coordinator_contact, updated_by)
         VALUES (
           $1,
           (SELECT character_image_url FROM org_settings WHERE business_unit = ''),
           COALESCE(
             $2,
             (SELECT org_display_name FROM org_settings WHERE business_unit = ''),
             'Your Organization'
           ),
           CASE WHEN $3::boolean THEN $4
                ELSE (SELECT default_coordinator_name
                      FROM org_settings WHERE business_unit = '') END,
           CASE WHEN $5::boolean THEN $6
                ELSE (SELECT default_coordinator_contact
                      FROM org_settings WHERE business_unit = '') END,
           $7
         )
         ON CONFLICT (business_unit) DO UPDATE SET
           org_display_name = COALESCE($2, org_settings.org_display_name),
           default_coordinator_name = CASE WHEN $3::boolean THEN $4
                                           ELSE org_settings.default_coordinator_name END,
           default_coordinator_contact = CASE WHEN $5::boolean THEN $6
                                              ELSE org_settings.default_coordinator_contact END,
           updated_at = NOW(),
           updated_by = $7
         RETURNING business_unit, character_image_url, org_display_name, default_coordinator_name,
                   default_coordinator_contact, updated_at, updated_by`,
        [
          businessUnit,
          settings.org_display_name ?? null,
          Object.hasOwn(settings, 'default_coordinator_name'),
          settings.default_coordinator_name ?? null,
          Object.hasOwn(settings, 'default_coordinator_contact'),
          settings.default_coordinator_contact ?? null,
          getActorName(request),
        ],
      );

      response.json({ org_settings: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

orgSettingsRouter.post(
  '/org-settings/character-image',
  validate({ query: orgSettingsQuery }),
  characterImageUpload.single('image'),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { business_unit: businessUnit } = orgSettingsQuery.parse(request.query);
      const file = request.file;
      if (!file) {
        response.status(400).json({ error: 'Multipart field image is required' });
        return;
      }

      if (!imageExtensionsByMimeType[file.mimetype]) {
        response.status(415).json({ error: 'Only PNG, JPEG, and WebP images are accepted' });
        return;
      }

      let dimensions: ReturnType<typeof imageSize>;
      try {
        dimensions = imageSize(file.buffer);
      } catch {
        response.status(400).json({ error: 'Uploaded file is not a readable image' });
        return;
      }
      if (!dimensions.width || !dimensions.height) {
        response.status(400).json({ error: 'Could not determine image dimensions' });
        return;
      }
      const detectedExtension = dimensions.type;
      if (!detectedExtension || !['png', 'jpg', 'webp'].includes(detectedExtension)) {
        response.status(415).json({ error: 'Only PNG, JPEG, and WebP images are accepted' });
        return;
      }

      const contentDigest = createHash('sha256').update(file.buffer).digest('hex').slice(0, 20);
      const filename = `character-${contentDigest}-${randomUUID()}.${detectedExtension}`;
      const directory = join(uploadsRoot, 'org-settings');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, filename), file.buffer, { flag: 'wx' });

      const characterImageUrl = `/uploads/org-settings/${filename}`;
      const result = await pool.query<OrgSettingsRow>(
        `INSERT INTO org_settings
           (business_unit, character_image_url, org_display_name, default_coordinator_name,
            default_coordinator_contact, updated_by)
         VALUES (
           $1,
           $2,
           COALESCE(
             (SELECT org_display_name FROM org_settings WHERE business_unit = ''),
             'Your Organization'
           ),
           (SELECT default_coordinator_name FROM org_settings WHERE business_unit = ''),
           (SELECT default_coordinator_contact FROM org_settings WHERE business_unit = ''),
           $3
         )
         ON CONFLICT (business_unit) DO UPDATE SET
           character_image_url = EXCLUDED.character_image_url,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by
         RETURNING business_unit, character_image_url, org_display_name, default_coordinator_name,
                   default_coordinator_contact, updated_at, updated_by`,
        [businessUnit, characterImageUrl, getActorName(request)],
      );

      response.json({ org_settings: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

const characterImageGenerateBody = z.object({
  description: z.string().trim().min(2).max(300),
});

/**
 * Generates the letter character illustration instead of requiring one to be uploaded.
 *
 * Only the illustration — the letter itself stays rendered from data by the HTML pipeline, because
 * the image model cannot render legible Korean and a generated letter would carry unverifiable
 * dates and mangled text. The result is written to the same directory and column as an uploaded
 * image, so everything downstream treats the two identically.
 */
orgSettingsRouter.post(
  '/org-settings/character-image/generate',
  validate({ query: orgSettingsQuery, body: characterImageGenerateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { business_unit: businessUnit } = orgSettingsQuery.parse(request.query);
      const { description } = characterImageGenerateBody.parse(request.body);

      let generated;
      try {
        generated = await generateCharacterImage(description);
      } catch (error) {
        if (error instanceof LlmUnavailableError) {
          response.status(502).json({ error: error.message });
          return;
        }
        throw error;
      }

      if (!generated) {
        response.status(503).json({
          error:
            'AI 이미지 생성을 사용할 수 없습니다. 조직 설정에서 기능이 켜져 있는지 확인하거나, 이미지를 직접 업로드하세요.',
        });
        return;
      }

      const contentDigest = createHash('sha256').update(generated.data).digest('hex').slice(0, 20);
      const filename = `character-ai-${contentDigest}-${randomUUID()}.png`;
      const directory = join(uploadsRoot, 'org-settings');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, filename), generated.data, { flag: 'wx' });

      const characterImageUrl = `/uploads/org-settings/${filename}`;
      const result = await pool.query<OrgSettingsRow>(
        `INSERT INTO org_settings
           (business_unit, character_image_url, org_display_name, default_coordinator_name,
            default_coordinator_contact, updated_by)
         VALUES (
           $1,
           $2,
           COALESCE(
             (SELECT org_display_name FROM org_settings WHERE business_unit = ''),
             'Your Organization'
           ),
           (SELECT default_coordinator_name FROM org_settings WHERE business_unit = ''),
           (SELECT default_coordinator_contact FROM org_settings WHERE business_unit = ''),
           $3
         )
         ON CONFLICT (business_unit) DO UPDATE SET
           character_image_url = EXCLUDED.character_image_url,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by
         RETURNING business_unit, character_image_url, org_display_name, default_coordinator_name,
                   default_coordinator_contact, updated_at, updated_by`,
        [businessUnit, characterImageUrl, getActorName(request)],
      );

      await pool.query(
        `INSERT INTO audit_logs
           (actor_name, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'character_image_generated', 'org_settings', NULL, $2::jsonb, $3)`,
        [
          getActorName(request),
          JSON.stringify({
            business_unit: businessUnit,
            model: generated.model,
            request_id: generated.requestId,
            description,
          }),
          request.ip || null,
        ],
      );

      response.json({
        org_settings: result.rows[0],
        generated_by: { model: generated.model, request_id: generated.requestId },
      });
    } catch (error) {
      next(error);
    }
  },
);
