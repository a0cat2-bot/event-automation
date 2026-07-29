import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Router, type NextFunction, type Request, type Response } from 'express';
import { imageSize } from 'image-size';
import multer from 'multer';
import { z } from 'zod';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { letterStandardContentBody, letterTemplateFieldsBody } from '../schemas/contracts.js';
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
  background_image_url: string | null;
  canvas_width: number | null;
  canvas_height: number | null;
  text_fields: unknown;
  layout_mode: 'freeform' | 'standard';
  category_id: string | null;
  standard_content: unknown;
}

interface ProgramLetterCustomizationRow {
  id: string;
  program_id: string;
  template_id: string;
  standard_content: unknown;
  text_fields: unknown;
  background_image_url: string | null;
  canvas_width: number | null;
  canvas_height: number | null;
  created_at: Date;
  updated_at: Date;
}

const programTemplateParams = z.object({
  programId: z.string().uuid(),
  templateId: z.string().uuid(),
});

const cloneParams = z.object({
  newProgramId: z.string().uuid(),
  sourceProgramId: z.string().uuid(),
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

const templateColumns = `id, name, template_type, brand_variant, output_format, version,
                         created_at, created_by, is_active, background_image_url, canvas_width,
                         canvas_height, text_fields, layout_mode, category_id, standard_content`;

async function findActiveTemplate(templateId: string) {
  const result = await pool.query<LetterTemplateRow>(
    `SELECT ${templateColumns}
     FROM letter_templates
     WHERE id = $1 AND is_active = TRUE
     LIMIT 1`,
    [templateId],
  );
  return result.rows[0];
}

export const programLetterContentRouter = Router();

programLetterContentRouter.get(
  '/programs/:programId/letter-templates/:templateId/content',
  validate({ params: programTemplateParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { programId, templateId } = programTemplateParams.parse(request.params);
      const template = await findActiveTemplate(templateId);
      if (!template) {
        response.status(404).json({ error: 'Letter template not found' });
        return;
      }

      const customizationResult = await pool.query<ProgramLetterCustomizationRow>(
        `SELECT id, program_id, template_id, standard_content, text_fields,
                background_image_url, canvas_width, canvas_height, created_at, updated_at
         FROM program_letter_customizations
         WHERE program_id = $1 AND template_id = $2
         LIMIT 1`,
        [programId, templateId],
      );
      const customization = customizationResult.rows[0] ?? null;

      response.json({
        template,
        customization,
        is_customized: customization !== null,
      });
    } catch (error) {
      next(error);
    }
  },
);

programLetterContentRouter.put(
  '/programs/:programId/letter-templates/:templateId/content',
  validate({ params: programTemplateParams, body: letterStandardContentBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { programId, templateId } = programTemplateParams.parse(request.params);
      const template = await findActiveTemplate(templateId);
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

      const content = letterStandardContentBody.parse(request.body);
      const result = await pool.query<ProgramLetterCustomizationRow>(
        `INSERT INTO program_letter_customizations
           (program_id, template_id, standard_content)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (program_id, template_id) DO UPDATE
         SET standard_content = EXCLUDED.standard_content,
             updated_at = NOW()
         RETURNING id, program_id, template_id, standard_content, text_fields,
                   background_image_url, canvas_width, canvas_height, created_at, updated_at`,
        [programId, templateId, JSON.stringify(content)],
      );

      response.json({ customization: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

programLetterContentRouter.put(
  '/programs/:programId/letter-templates/:templateId/fields',
  validate({ params: programTemplateParams, body: letterTemplateFieldsBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { programId, templateId } = programTemplateParams.parse(request.params);
      const template = await findActiveTemplate(templateId);
      if (!template) {
        response.status(404).json({ error: 'Letter template not found' });
        return;
      }
      if (template.layout_mode !== 'freeform') {
        response.status(400).json({
          error: 'this endpoint is only for freeform-mode templates',
        });
        return;
      }

      const { text_fields: textFields } = letterTemplateFieldsBody.parse(request.body);
      const result = await pool.query<ProgramLetterCustomizationRow>(
        `INSERT INTO program_letter_customizations
           (program_id, template_id, text_fields)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (program_id, template_id) DO UPDATE
         SET text_fields = EXCLUDED.text_fields,
             updated_at = NOW()
         RETURNING id, program_id, template_id, standard_content, text_fields,
                   background_image_url, canvas_width, canvas_height, created_at, updated_at`,
        [programId, templateId, JSON.stringify(textFields)],
      );

      response.json({ customization: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

programLetterContentRouter.post(
  '/programs/:programId/letter-templates/:templateId/background',
  validate({ params: programTemplateParams }),
  backgroundUpload.single('image'),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { programId, templateId } = programTemplateParams.parse(request.params);
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

      const template = await findActiveTemplate(templateId);
      if (!template) {
        response.status(404).json({ error: 'Letter template not found' });
        return;
      }
      if (template.layout_mode !== 'freeform') {
        response.status(400).json({
          error: 'this endpoint is only for freeform-mode templates',
        });
        return;
      }

      const contentDigest = createHash('sha256').update(file.buffer).digest('hex').slice(0, 20);
      const filename = `${templateId}-${contentDigest}-${randomUUID()}.${detectedExtension}`;
      const directory = join(uploadsRoot, 'letter-backgrounds');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, filename), file.buffer, { flag: 'wx' });

      const backgroundImageUrl = `/uploads/letter-backgrounds/${filename}`;
      const result = await pool.query<ProgramLetterCustomizationRow>(
        `INSERT INTO program_letter_customizations
           (program_id, template_id, background_image_url, canvas_width, canvas_height)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (program_id, template_id) DO UPDATE
         SET background_image_url = EXCLUDED.background_image_url,
             canvas_width = EXCLUDED.canvas_width,
             canvas_height = EXCLUDED.canvas_height,
             updated_at = NOW()
         RETURNING id, program_id, template_id, standard_content, text_fields,
                   background_image_url, canvas_width, canvas_height, created_at, updated_at`,
        [programId, templateId, backgroundImageUrl, dimensions.width, dimensions.height],
      );

      response.json({ customization: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

programLetterContentRouter.delete(
  '/programs/:programId/letter-templates/:templateId/content',
  validate({ params: programTemplateParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { programId, templateId } = programTemplateParams.parse(request.params);
      const template = await findActiveTemplate(templateId);
      if (!template) {
        response.status(404).json({ error: 'Letter template not found' });
        return;
      }

      const result = await pool.query<{ id: string }>(
        `DELETE FROM program_letter_customizations
         WHERE program_id = $1 AND template_id = $2
         RETURNING id`,
        [programId, templateId],
      );

      response.json({ template, deleted: result.rows.length > 0 });
    } catch (error) {
      next(error);
    }
  },
);

programLetterContentRouter.post(
  '/programs/:newProgramId/letter-customizations/clone-from/:sourceProgramId',
  validate({ params: cloneParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { newProgramId, sourceProgramId } = cloneParams.parse(request.params);
      const programsResult = await pool.query<{ id: string }>(
        `SELECT id
         FROM programs
         WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [[newProgramId, sourceProgramId]],
      );
      const programIds = new Set(programsResult.rows.map((program) => program.id));
      if (!programIds.has(newProgramId)) {
        response.status(404).json({ error: 'Destination program not found' });
        return;
      }
      if (!programIds.has(sourceProgramId)) {
        response.status(404).json({ error: 'Source program not found' });
        return;
      }

      const result = await pool.query<{ id: string }>(
        `INSERT INTO program_letter_customizations
           (program_id, template_id, standard_content, text_fields, background_image_url,
            canvas_width, canvas_height)
         SELECT $1, template_id, standard_content, text_fields, background_image_url,
                canvas_width, canvas_height
         FROM program_letter_customizations
         WHERE program_id = $2
         ON CONFLICT (program_id, template_id) DO NOTHING
         RETURNING id`,
        [newProgramId, sourceProgramId],
      );

      response.json({ cloned_count: result.rows.length });
    } catch (error) {
      next(error);
    }
  },
);
