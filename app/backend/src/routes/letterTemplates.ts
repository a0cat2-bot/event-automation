import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Router, type NextFunction, type Request, type Response } from 'express';
import { imageSize } from 'image-size';
import multer from 'multer';
import { z } from 'zod';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../schemas/common.js';
import {
  letterStandardContentBody,
  letterTemplateCreateBody,
  letterTemplateFieldsBody,
} from '../schemas/contracts.js';
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
  layout_mode: 'freeform' | 'standard';
  category_id: string | null;
  standard_content: unknown;
}

interface LetterCategoryFlagsRow {
  id: string;
  has_datetime: boolean;
  has_location: boolean;
  has_gift_info: boolean;
  has_precautions: boolean;
  has_cta_link: boolean;
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
  validate({ body: letterTemplateCreateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const id = randomUUID();
      const { name, template_type, brand_variant, output_format, layout_mode, category_id } =
        letterTemplateCreateBody.parse(request.body);

      if (category_id) {
        const categoryResult = await pool.query<{ id: string }>(
          'SELECT id FROM letter_categories WHERE id = $1 LIMIT 1',
          [category_id],
        );
        if (!categoryResult.rows[0]) {
          response.status(404).json({ error: 'Letter category not found' });
          return;
        }
      }

      const result = await pool.query<LetterTemplateRow>(
        `INSERT INTO letter_templates
           (id, name, template_type, brand_variant, output_format, layout_mode, category_id)
         VALUES ($1, $2, $3, $4, COALESCE($5::output_format, 'pdf'::output_format),
                 COALESCE($6::letter_layout_mode, 'freeform'::letter_layout_mode), $7)
         RETURNING id, name, template_type, brand_variant, output_format, version,
                   created_at, created_by, is_active, layout_mode, category_id,
                   standard_content`,
        [
          id,
          name,
          template_type,
          brand_variant,
          output_format ?? null,
          layout_mode ?? null,
          category_id ?? null,
        ],
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
                canvas_width, canvas_height, layout_mode, category_id, standard_content
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
                canvas_width, canvas_height, text_fields, layout_mode, category_id,
                standard_content
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
                   canvas_width, canvas_height, text_fields, layout_mode, category_id,
                   standard_content`,
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
                   canvas_width, canvas_height, text_fields, layout_mode, category_id,
                   standard_content`,
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

letterTemplatesRouter.put(
  '/letter-templates/:id/standard-content',
  validate({ params: idParams, body: letterStandardContentBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const content = letterStandardContentBody.parse(request.body);
      const templateResult = await pool.query<
        Pick<LetterTemplateRow, 'id' | 'layout_mode' | 'category_id'>
      >(
        `SELECT id, layout_mode, category_id
         FROM letter_templates
         WHERE id = $1 AND is_active = TRUE
         LIMIT 1`,
        [request.params.id],
      );
      const template = templateResult.rows[0];
      if (!template) {
        response.status(404).json({ error: 'Letter template not found' });
        return;
      }
      if (template.layout_mode !== 'standard') {
        response.status(400).json({
          error: 'this endpoint is only for standard-mode templates',
        });
        return;
      }

      const categoryResult = await pool.query<LetterCategoryFlagsRow>(
        `SELECT id, has_datetime, has_location, has_gift_info, has_precautions,
                has_cta_link
         FROM letter_categories
         WHERE id = $1
         LIMIT 1`,
        [template.category_id],
      );
      const category = categoryResult.rows[0];
      if (!category) {
        response.status(404).json({ error: 'Letter category not found' });
        return;
      }

      const requireContent = (
        condition: boolean,
        value: string | null | undefined,
        field: string,
      ) => {
        if (condition && !value?.trim()) {
          response.status(400).json({ error: `${field} is required for this category`, field });
          return false;
        }
        return true;
      };

      if (!requireContent(category.has_datetime, content.datetime_text, 'datetime_text')) return;
      if (!requireContent(category.has_location, content.location_text, 'location_text')) return;
      if (!requireContent(category.has_gift_info, content.gift_info_text, 'gift_info_text')) return;
      if (category.has_precautions && content.precautions.length === 0) {
        response.status(400).json({
          error: 'precautions is required for this category',
          field: 'precautions',
        });
        return;
      }
      if (!requireContent(category.has_cta_link, content.cta_text, 'cta_text')) return;
      if (!requireContent(category.has_cta_link, content.cta_link, 'cta_link')) return;

      const normalizedContent = {
        title_override: content.title_override || null,
        datetime_text: category.has_datetime ? content.datetime_text || null : null,
        location_text: category.has_location ? content.location_text || null : null,
        body_text: content.body_text,
        gift_info_text: category.has_gift_info ? content.gift_info_text || null : null,
        precautions: category.has_precautions ? content.precautions : [],
        cta_text: category.has_cta_link ? content.cta_text || null : null,
        cta_link: category.has_cta_link ? content.cta_link || null : null,
      };

      const result = await pool.query<LetterTemplateRow>(
        `UPDATE letter_templates
         SET standard_content = $2::jsonb, version = version + 1
         WHERE id = $1 AND is_active = TRUE
         RETURNING id, name, template_type, brand_variant, output_format, version,
                   created_at, created_by, is_active, background_image_url,
                   canvas_width, canvas_height, text_fields, layout_mode, category_id,
                   standard_content`,
        [request.params.id, JSON.stringify(normalizedContent)],
      );

      response.json({ template: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

letterTemplatesRouter.delete(
  '/letter-templates/:id',
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
