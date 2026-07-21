import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Router, type NextFunction, type Request, type Response } from 'express';
import { imageSize } from 'image-size';
import multer from 'multer';
import { z } from 'zod';

import { pool } from '../db/pool.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../schemas/common.js';
import { letterTemplateCreateBody, letterTemplateFieldsBody } from '../schemas/contracts.js';
import { uploadsRoot } from '../utils/storage.js';

interface LetterTemplateRow {
  id: string;
  name: string;
  template_type: 'recruitment' | 'notification' | 'gift_notification' | null;
  brand_variant: string | null;
  output_format: 'pdf' | 'image';
  version: number;
  created_at: Date;
  created_by: string | null;
  is_active: boolean;
  background_image_url?: string | null;
  canvas_width?: number | null;
  canvas_height?: number | null;
  text_fields?: unknown;
}

const templateListQuery = z.object({
  template_type: z.enum(['recruitment', 'notification', 'gift_notification']).optional(),
});

const backgroundUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const imageExtensionsByMimeType: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export const letterTemplatesRouter = Router();

letterTemplatesRouter.post(
  '/letter-templates',
  requireRole('admin', 'coordinator'),
  validate({ body: letterTemplateCreateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const user = request.user!;
      const id = randomUUID();
      const { name, template_type, brand_variant, output_format } =
        letterTemplateCreateBody.parse(request.body);
      const result = await pool.query<LetterTemplateRow>(
        `INSERT INTO letter_templates
           (id, name, template_type, brand_variant, created_by, output_format)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'pdf'))
         RETURNING id, name, template_type, brand_variant, output_format, version,
                   created_at, created_by, is_active`,
        [id, name, template_type, brand_variant, user.user_id, output_format ?? null],
      );

      response.status(201).json({ template: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

letterTemplatesRouter.get(
  '/letter-templates',
  validate({ query: templateListQuery }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { template_type } = templateListQuery.parse(request.query);
      const result = await pool.query<LetterTemplateRow>(
        `SELECT id, name, template_type, brand_variant, output_format, version,
                created_at, created_by, is_active, background_image_url,
                canvas_width, canvas_height
         FROM letter_templates
         WHERE is_active = TRUE
           AND ($1::template_type IS NULL OR template_type = $1::template_type)
         ORDER BY name ASC, version DESC, created_at DESC`,
        [template_type ?? null],
      );

      response.json({ templates: result.rows });
    } catch (error) {
      next(error);
    }
  },
);

letterTemplatesRouter.get(
  '/letter-templates/:id',
  validate({ params: idParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const result = await pool.query<LetterTemplateRow>(
        `SELECT id, name, template_type, brand_variant, output_format, version,
                created_at, created_by, is_active, background_image_url,
                canvas_width, canvas_height, text_fields
         FROM letter_templates
         WHERE id = $1 AND is_active = TRUE
         LIMIT 1`,
        [request.params.id],
      );
      const template = result.rows[0];
      if (!template) {
        response.status(404).json({ error: 'Letter template not found' });
        return;
      }

      response.json({ template });
    } catch (error) {
      next(error);
    }
  },
);

letterTemplatesRouter.post(
  '/letter-templates/:id/background',
  requireRole('admin', 'coordinator'),
  validate({ params: idParams }),
  backgroundUpload.single('image'),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
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

      const templateId = request.params.id as string;
      const exists = await pool.query<{ id: string }>(
        'SELECT id FROM letter_templates WHERE id = $1 AND is_active = TRUE LIMIT 1',
        [templateId],
      );
      if (!exists.rows[0]) {
        response.status(404).json({ error: 'Letter template not found' });
        return;
      }

      const contentDigest = createHash('sha256').update(file.buffer).digest('hex').slice(0, 20);
      const filename = `${templateId}-${contentDigest}-${randomUUID()}.${detectedExtension}`;
      const directory = join(uploadsRoot, 'letter-backgrounds');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, filename), file.buffer, { flag: 'wx' });

      const backgroundImageUrl = `/uploads/letter-backgrounds/${filename}`;
      const result = await pool.query<LetterTemplateRow>(
        `UPDATE letter_templates
         SET background_image_url = $2,
             canvas_width = $3,
             canvas_height = $4,
             version = version + 1
         WHERE id = $1 AND is_active = TRUE
         RETURNING id, name, template_type, brand_variant, output_format, version,
                   created_at, created_by, is_active, background_image_url,
                   canvas_width, canvas_height, text_fields`,
        [templateId, backgroundImageUrl, dimensions.width, dimensions.height],
      );

      response.json({ template: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

letterTemplatesRouter.put(
  '/letter-templates/:id/fields',
  requireRole('admin', 'coordinator'),
  validate({ params: idParams, body: letterTemplateFieldsBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { text_fields } = letterTemplateFieldsBody.parse(request.body);
      const result = await pool.query<LetterTemplateRow>(
        `UPDATE letter_templates
         SET text_fields = $2::jsonb, version = version + 1
         WHERE id = $1 AND is_active = TRUE
         RETURNING id, name, template_type, brand_variant, output_format, version,
                   created_at, created_by, is_active, background_image_url,
                   canvas_width, canvas_height, text_fields`,
        [request.params.id, JSON.stringify(text_fields)],
      );
      const template = result.rows[0];
      if (!template) {
        response.status(404).json({ error: 'Letter template not found' });
        return;
      }

      response.json({ template });
    } catch (error) {
      next(error);
    }
  },
);

letterTemplatesRouter.delete(
  '/letter-templates/:id',
  requireRole('admin'),
  validate({ params: idParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const result = await pool.query<{ id: string }>(
        `UPDATE letter_templates
         SET is_active = FALSE
         WHERE id = $1 AND is_active = TRUE
         RETURNING id`,
        [request.params.id],
      );
      if (!result.rows[0]) {
        response.status(404).json({ error: 'Letter template not found' });
        return;
      }

      response.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
