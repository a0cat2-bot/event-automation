import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { Router, type NextFunction, type Request, type Response } from 'express';
import puppeteer, { type Browser } from 'puppeteer';

import { pool } from '../db/pool.js';
import { requireRole, type AuthenticatedPrincipal } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { letterParams } from '../schemas/common.js';
import {
  letterGenerateBody,
  letterTextFields,
  type LetterPlaceholderKey,
} from '../schemas/contracts.js';
import { uploadUrlToFilePath, uploadsRoot } from '../utils/storage.js';

type PlaceholderKey = Exclude<LetterPlaceholderKey, 'static'>;
type PlaceholderValues = Record<PlaceholderKey, string | null>;

interface GenerationContextRow {
  template_id: string;
  template_brand_variant: string | null;
  output_format: 'pdf' | 'image';
  background_image_url: string | null;
  canvas_width: number | null;
  canvas_height: number | null;
  text_fields: unknown;
  program_id: string;
  program_name: string;
  business_unit: string;
  intake_data: unknown;
}

interface ApplicantRow {
  id: string;
  name: string | null;
  email: string | null;
  department: string | null;
}

interface CoordinatorRow {
  name: string | null;
  email: string;
}

interface GeneratedLetterRow {
  id: string;
  applicant_id: string;
  file_path: string | null;
  file_size_bytes: number | null;
  content_hash: string | null;
  generated_at: Date;
}

interface DownloadLetterRow {
  file_path: string | null;
  file_size_bytes: number | null;
  output_format: 'pdf' | 'image';
}

let browserPromise: Promise<Browser> | null = null;

/**
 * A shared browser is intentionally reused across requests. Launching Chromium once per
 * letter is prohibitively expensive; a production deployment should also add lifecycle
 * monitoring and graceful shutdown/restart handling for this shared process.
 */
function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;

  // --no-sandbox is required on Linux hosts without the kernel namespace privileges
  // Chrome's sandbox needs (WSL2, most Docker/CI containers) — without it, launch()
  // fails immediately with "No usable sandbox!". Safe here because this process only
  // ever renders our own generated letter HTML, never third-party/untrusted pages.
  const launchedBrowser = puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  browserPromise = launchedBrowser;
  void launchedBrowser.catch(() => {
    browserPromise = null;
  });
  return launchedBrowser;
}

function currentUser(request: Request): AuthenticatedPrincipal {
  if (!request.user) throw new Error('Authenticated principal is missing');
  return request.user;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function intakeValue(intakeData: unknown, ...keys: string[]): string | null {
  if (!isRecord(intakeData)) return null;
  for (const key of keys) {
    const value = scalarString(intakeData[key]);
    if (value !== null) return value;
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeFontFamily(value: string): string {
  return value.replace(/["';&{}<>]/g, '').trim() || 'Arial, sans-serif';
}

function safeFontWeight(value: string): string {
  return /^(?:normal|bold|lighter|bolder|[1-9]00)$/i.test(value) ? value : 'normal';
}

function mimeTypeForImagePath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

function renderHtml(
  width: number,
  height: number,
  backgroundDataUrl: string,
  fields: ReturnType<typeof letterTextFields.parse>,
  variables: PlaceholderValues,
): string {
  const textBoxes = fields
    .map((field) => {
      const value = field.key === 'static' ? field.static_text : variables[field.key];
      return `<div class="text-field" style="left:${field.x}px;top:${field.y}px;width:${field.width}px;height:${field.height}px;font-family:${safeFontFamily(field.font_family)};font-size:${field.font_size}px;font-weight:${safeFontWeight(field.font_weight)};color:${field.color};text-align:${field.text_align}">${escapeHtml(value ?? '')}</div>`;
    })
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: ${width}px ${height}px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; margin: 0; padding: 0; overflow: hidden; }
  .canvas { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: url("${backgroundDataUrl}") center / 100% 100% no-repeat; }
  .text-field { position: absolute; white-space: pre-wrap; overflow: hidden; line-height: 1.2; }
</style>
</head>
<body><div class="canvas">${textBoxes}</div></body>
</html>`;
}

async function renderLetter(
  html: string,
  width: number,
  height: number,
  outputFormat: 'pdf' | 'image',
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    if (outputFormat === 'image') {
      const bytes = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width, height },
      });
      return Buffer.from(bytes);
    }

    const bytes = await page.pdf({
      width: `${width}px`,
      height: `${height}px`,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(bytes);
  } finally {
    await page.close();
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const metadata = await stat(filePath);
    return metadata.isFile();
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown letter generation error';
}

export interface LetterGenerationResult {
  generated_count: number;
  cached_count: number;
  failed_count: number;
  results: Array<Record<string, unknown>>;
}

class LetterGenerationRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.error === 'string' ? body.error : 'Letter generation request failed');
  }
}

export async function generateLettersForApplicants(params: {
  templateId: string;
  programId: string;
  applicantIds: string[];
  brandVariant: string;
  user: AuthenticatedPrincipal;
}): Promise<LetterGenerationResult> {
  const contextResult = await pool.query<GenerationContextRow>(
    `SELECT t.id AS template_id,
            t.brand_variant AS template_brand_variant,
            COALESCE(t.output_format, 'pdf') AS output_format,
            t.background_image_url,
            t.canvas_width,
            t.canvas_height,
            t.text_fields,
            p.id AS program_id,
            p.name AS program_name,
            p.business_unit,
            p.intake_data
     FROM letter_templates t
     CROSS JOIN programs p
     WHERE t.id = $1
       AND t.is_active = TRUE
       AND p.id = $2
       AND p.deleted_at IS NULL
       AND ($3::boolean OR p.business_unit = ANY($4::text[]))
     LIMIT 1`,
    [params.templateId, params.programId, params.user.role === 'admin', params.user.business_units],
  );
  const context = contextResult.rows[0];
  if (!context) {
    throw new LetterGenerationRequestError(404, { error: 'Template or program not found' });
  }

  if (
    context.template_brand_variant !== null &&
    context.template_brand_variant !== params.brandVariant
  ) {
    throw new LetterGenerationRequestError(400, {
      error: 'brand_variant does not match the selected template',
    });
  }

  if (!context.background_image_url || !context.canvas_width || !context.canvas_height) {
    throw new LetterGenerationRequestError(400, {
      error: 'Template background and canvas dimensions are required',
    });
  }
  if (context.canvas_width <= 0 || context.canvas_height <= 0) {
    throw new LetterGenerationRequestError(400, {
      error: 'Template canvas dimensions must be positive',
    });
  }

  const fieldsResult = letterTextFields.safeParse(context.text_fields);
  if (!fieldsResult.success) {
    throw new LetterGenerationRequestError(400, {
      error: 'Template text_fields are missing or invalid',
      issues: fieldsResult.error.issues,
    });
  }

  const backgroundPath = uploadUrlToFilePath(context.background_image_url);
  if (!backgroundPath) {
    throw new LetterGenerationRequestError(400, {
      error: 'Template background path is invalid',
    });
  }

  let backgroundBytes: Buffer;
  try {
    backgroundBytes = await readFile(backgroundPath);
  } catch {
    throw new LetterGenerationRequestError(400, {
      error: 'Template background file is unavailable',
    });
  }
  const backgroundHash = createHash('sha256').update(backgroundBytes).digest('hex');
  const backgroundDataUrl = `data:${mimeTypeForImagePath(backgroundPath)};base64,${backgroundBytes.toString('base64')}`;

  const coordinatorResult = await pool.query<CoordinatorRow>(
    'SELECT name, email FROM users WHERE id = $1 LIMIT 1',
    [params.user.user_id],
  );
  const coordinator = coordinatorResult.rows[0];
  const coordinatorName = coordinator?.name ?? params.user.email;
  const coordinatorContact = coordinator?.email ?? params.user.email;
  const results: Array<Record<string, unknown>> = [];
  let generatedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;

  await mkdir(join(uploadsRoot, 'generated-letters'), { recursive: true });

  for (const applicantId of params.applicantIds) {
    let uncommittedFilePath: string | null = null;
    try {
      const applicantResult = await pool.query<ApplicantRow>(
        `SELECT id, name, email, department
         FROM applicants
         WHERE id = $1 AND program_id = $2
         LIMIT 1`,
        [applicantId, context.program_id],
      );
      const applicant = applicantResult.rows[0];
      if (!applicant) {
        failedCount += 1;
        results.push({
          applicant_id: applicantId,
          status: 'failed',
          error: 'Applicant not found in this program',
        });
        continue;
      }

      const variables: PlaceholderValues = {
        applicant_name: applicant.name,
        applicant_email: applicant.email,
        department: applicant.department,
        program_name: context.program_name,
        program_date: intakeValue(context.intake_data, 'program_date', 'date'),
        program_location: intakeValue(context.intake_data, 'program_location', 'location'),
        program_time: intakeValue(context.intake_data, 'program_time', 'time'),
        // TODO(§7/§10): Resolve these after Sally and gift selection are implemented.
        survey_link: null,
        gift_amount: null,
        coordinator_name: coordinatorName,
        coordinator_contact: coordinatorContact,
      };
      const renderInputHash = createHash('sha256')
        .update(
          JSON.stringify({
            template_id: context.template_id,
            applicant_id: applicant.id,
            brand_variant: params.brandVariant,
            output_format: context.output_format,
            canvas_width: context.canvas_width,
            canvas_height: context.canvas_height,
            background_hash: backgroundHash,
            text_fields: fieldsResult.data,
            variables,
          }),
        )
        .digest('hex');

      const cachedResult = await pool.query<GeneratedLetterRow>(
        `SELECT id, applicant_id, file_path, file_size_bytes, content_hash, generated_at
         FROM generated_letters
         WHERE template_id = $1
           AND program_id = $2
           AND applicant_id = $3
           AND template_variables_snapshot ->> '_render_input_hash' = $4
         ORDER BY generated_at DESC
         LIMIT 1`,
        [context.template_id, context.program_id, applicant.id, renderInputHash],
      );
      const cached = cachedResult.rows[0];
      const cachedPath = cached?.file_path ? uploadUrlToFilePath(cached.file_path) : null;
      if (cached && cachedPath && (await fileExists(cachedPath))) {
        cachedCount += 1;
        results.push({ ...cached, status: 'cached' });
        continue;
      }

      const html = renderHtml(
        context.canvas_width,
        context.canvas_height,
        backgroundDataUrl,
        fieldsResult.data,
        variables,
      );
      const outputBytes = await renderLetter(
        html,
        context.canvas_width,
        context.canvas_height,
        context.output_format,
      );
      const contentHash = createHash('sha256').update(outputBytes).digest('hex');
      const letterId = randomUUID();
      const extension = context.output_format === 'image' ? 'png' : 'pdf';
      const filename = `${letterId}.${extension}`;
      const filePath = join(uploadsRoot, 'generated-letters', filename);
      const fileUrl = `/uploads/generated-letters/${filename}`;
      await writeFile(filePath, outputBytes, { flag: 'wx' });
      uncommittedFilePath = filePath;

      const snapshot = { ...variables, _render_input_hash: renderInputHash };
      const insertedResult = await pool.query<GeneratedLetterRow>(
        `INSERT INTO generated_letters
           (id, template_id, program_id, applicant_id, file_path, file_size_bytes,
            content_hash, generated_by, template_variables_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING id, applicant_id, file_path, file_size_bytes, content_hash, generated_at`,
        [
          letterId,
          context.template_id,
          context.program_id,
          applicant.id,
          fileUrl,
          outputBytes.byteLength,
          contentHash,
          params.user.user_id,
          JSON.stringify(snapshot),
        ],
      );

      uncommittedFilePath = null;
      generatedCount += 1;
      results.push({ ...insertedResult.rows[0], status: 'generated' });
    } catch (error) {
      if (uncommittedFilePath) {
        try {
          await unlink(uncommittedFilePath);
        } catch {
          // Best-effort cleanup; preserve the generation/database failure in the result.
        }
      }
      failedCount += 1;
      results.push({
        applicant_id: applicantId,
        status: 'failed',
        error: errorMessage(error),
      });
    }
  }

  return {
    generated_count: generatedCount,
    cached_count: cachedCount,
    failed_count: failedCount,
    results,
  };
}

export const lettersRouter = Router();

lettersRouter.post(
  '/letters/generate',
  requireRole('admin', 'coordinator'),
  validate({ body: letterGenerateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const user = currentUser(request);
      const body = letterGenerateBody.parse(request.body);
      const generationResult = await generateLettersForApplicants({
        templateId: body.template_id,
        programId: body.program_id,
        applicantIds: body.applicant_ids,
        brandVariant: body.brand_variant,
        user,
      });

      await pool.query(
        `INSERT INTO audit_logs
           (user_id, action, entity_type, entity_id, program_id, details, ip_address)
         VALUES ($1, 'letter_generation_batch', 'program', $2, $2, $3::jsonb, $4)`,
        [
          user.user_id,
          body.program_id,
          JSON.stringify({
            template_id: body.template_id,
            requested_count: body.applicant_ids.length,
            generated_count: generationResult.generated_count,
            cached_count: generationResult.cached_count,
            failed_count: generationResult.failed_count,
          }),
          request.ip || null,
        ],
      );

      response.json(generationResult);
    } catch (error) {
      if (error instanceof LetterGenerationRequestError) {
        response.status(error.status).json(error.body);
        return;
      }
      next(error);
    }
  },
);

lettersRouter.get(
  '/letters/:letter_id',
  validate({ params: letterParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const user = currentUser(request);
      const result = await pool.query<DownloadLetterRow>(
        `SELECT gl.file_path, gl.file_size_bytes,
                COALESCE(lt.output_format, 'pdf') AS output_format
         FROM generated_letters gl
         JOIN programs p ON p.id = gl.program_id
         JOIN letter_templates lt ON lt.id = gl.template_id
         WHERE gl.id = $1
           AND p.deleted_at IS NULL
           AND ($2::boolean OR p.business_unit = ANY($3::text[]))
         LIMIT 1`,
        [request.params.letter_id, user.role === 'admin', user.business_units],
      );
      const letter = result.rows[0];
      if (!letter?.file_path) {
        response.status(404).json({ error: 'Generated letter not found' });
        return;
      }

      const filePath = uploadUrlToFilePath(letter.file_path);
      if (!filePath || !(await fileExists(filePath))) {
        response.status(404).json({ error: 'Generated letter file not found' });
        return;
      }

      response.type(letter.output_format === 'image' ? 'png' : 'pdf');
      if (letter.file_size_bytes !== null) {
        response.setHeader('Content-Length', String(letter.file_size_bytes));
      }
      response.setHeader(
        'Content-Disposition',
        `inline; filename="${request.params.letter_id}.${letter.output_format === 'image' ? 'png' : 'pdf'}"`,
      );
      const stream = createReadStream(filePath);
      stream.on('error', next);
      stream.pipe(response);
    } catch (error) {
      next(error);
    }
  },
);
