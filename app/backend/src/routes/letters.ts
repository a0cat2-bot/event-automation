import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { Router, type NextFunction, type Request, type Response } from 'express';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { letterParams } from '../schemas/common.js';
import {
  letterGenerateBody,
  letterPlaceholderKey,
  letterStandardContentBody,
  letterTextFields,
  type LetterPlaceholderKey,
} from '../schemas/contracts.js';
import { getActorName } from '../utils/actor.js';
import { getBrowser } from '../utils/browser.js';
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
  program_business_unit: string;
  intake_data: unknown;
}

interface TemplateModeRow {
  layout_mode: 'freeform' | 'standard';
  category_id: string | null;
  standard_content: unknown;
  category_slug: string | null;
  has_datetime: boolean | null;
  has_location: boolean | null;
  has_gift_info: boolean | null;
  has_precautions: boolean | null;
  has_cta_link: boolean | null;
  default_title_text: string | null;
}

interface OrgSettingsRow {
  business_unit: string;
  character_image_url: string | null;
  org_display_name: string;
  default_coordinator_name: string | null;
  default_coordinator_contact: string | null;
  updated_at: Date;
}

interface ApplicantRow {
  id: string;
  name: string | null;
  email: string | null;
  department: string | null;
}

interface CoordinatorSettingsRow {
  default_coordinator_name: string | null;
  default_coordinator_contact: string | null;
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

const standardCanvasWidth = 800;
const standardCanvasHeight = 1000;
const mergePlaceholderKeys = letterPlaceholderKey.options.filter(
  (key): key is PlaceholderKey => key !== 'static',
);

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

function programDateValue(intakeData: unknown): string | null {
  if (isRecord(intakeData)) {
    const startDate =
      typeof intakeData.program_start_date === 'string'
        ? intakeData.program_start_date.trim()
        : '';
    if (startDate) {
      const endDate =
        typeof intakeData.program_end_date === 'string' ? intakeData.program_end_date.trim() : '';
      return endDate && endDate !== startDate ? `${startDate} ~ ${endDate}` : startDate;
    }
  }
  return intakeValue(intakeData, 'program_date', 'date');
}

function buildPlaceholderValues(
  context: GenerationContextRow,
  applicant: ApplicantRow,
  coordinatorName: string | null,
  coordinatorContact: string | null,
): PlaceholderValues {
  return {
    applicant_name: applicant.name,
    applicant_email: applicant.email,
    department: applicant.department,
    program_name: context.program_name,
    program_date: programDateValue(context.intake_data),
    program_location: intakeValue(context.intake_data, 'program_location', 'location'),
    program_time: intakeValue(context.intake_data, 'program_time', 'time'),
    // TODO(§7/§10): Resolve these after Sally and gift selection are implemented.
    survey_link: null,
    gift_amount: null,
    coordinator_name: coordinatorName,
    coordinator_contact: coordinatorContact,
  };
}

export function escapeHtml(value: string): string {
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

export function mimeTypeForImagePath(path: string): string {
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

function escapedTextWithLineBreaks(value: string): string {
  return escapeHtml(value).replaceAll('\n', '<br>');
}

function substituteBodyMergeFields(bodyText: string, variables: PlaceholderValues): string {
  let renderedBody = escapeHtml(bodyText);
  for (const key of mergePlaceholderKeys) {
    renderedBody = renderedBody.replaceAll(`{{${key}}}`, escapeHtml(variables[key] ?? ''));
  }
  return renderedBody.replaceAll('\n', '<br>');
}

interface GiftItemForRender {
  name: string;
  description: string | null;
  imageDataUrl: string | null;
}

function renderStandardHtml(params: {
  content: ReturnType<typeof letterStandardContentBody.parse>;
  category: TemplateModeRow;
  programName: string;
  orgDisplayName: string;
  characterDataUrl: string | null;
  giftItems: GiftItemForRender[];
  variables: PlaceholderValues;
}): string {
  const { content, category, variables, giftItems } = params;
  const title = content.title_override || category.default_title_text || '';
  const character = params.characterDataUrl
    ? `<img src="${escapeHtml(params.characterDataUrl)}" alt="">`
    : '';
  const scheduleLines = [
    category.has_datetime && content.datetime_text
      ? `<div class="schedule-row"><span class="schedule-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg></span><span class="schedule-label">일시</span><span class="schedule-value">${escapeHtml(content.datetime_text)}</span></div>`
      : '',
    category.has_location && content.location_text
      ? `<div class="schedule-row"><span class="schedule-icon schedule-icon--location" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></span><span class="schedule-label">장소</span><span class="schedule-value">${escapeHtml(content.location_text)}</span></div>`
      : '',
  ].join('');
  // Prefer the program's registered gift catalog (name + optional image, one card per item) —
  // it can list several distinct prizes. Only fall back to the template's free-text
  // gift_info_text when the program has no catalog entries yet (older/simpler programs).
  const giftCards = giftItems
    .map(
      (item) => `<div class="gift-card">
        ${item.imageDataUrl ? `<img class="gift-card-image" src="${escapeHtml(item.imageDataUrl)}" alt="">` : ''}
        <div class="gift-card-body">
          <div class="gift-card-name">${escapeHtml(item.name)}</div>
          ${item.description ? `<div class="gift-card-description">${escapedTextWithLineBreaks(item.description)}</div>` : ''}
        </div>
      </div>`,
    )
    .join('');
  const giftBlock =
    category.has_gift_info && giftItems.length > 0
      ? `<section class="gift"><h2>상품 안내</h2><div class="gift-card-list">${giftCards}</div></section>`
      : category.has_gift_info && content.gift_info_text
        ? `<section class="gift"><h2>상품 안내</h2><div>${escapedTextWithLineBreaks(content.gift_info_text)}</div></section>`
        : '';
  const precautionsBlock =
    category.has_precautions && content.precautions.length > 0
      ? `<section class="precautions"><h2>유의사항</h2><ul>${content.precautions
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('')}</ul></section>`
      : '';
  const ctaBlock =
    category.has_cta_link && content.cta_text && content.cta_link
      ? `<div class="cta-wrap"><a class="cta" href="${escapeHtml(content.cta_link)}">${escapeHtml(content.cta_text)}</a></div>`
      : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: ${standardCanvasWidth}px ${standardCanvasHeight}px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: ${standardCanvasWidth}px; height: ${standardCanvasHeight}px; margin: 0; padding: 0; overflow: hidden; }
  body { font-family: Arial, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; color: #243238; }
  .canvas { position: relative; width: 100%; height: 100%; padding: 56px 64px 70px; overflow: hidden; background: linear-gradient(145deg, #fbfdfb 0%, #f2f7f4 52%, #e8f0ed 100%); }
  .canvas::before { content: ""; position: absolute; inset: 22px; border: 2px solid rgba(40, 115, 93, .13); border-radius: 30px; pointer-events: none; }
  .canvas::after { content: ""; position: absolute; top: -78px; right: -54px; width: 284px; height: 284px; border-radius: 50%; background: rgba(132, 184, 165, .16); }
  .character-slot { position: absolute; z-index: 3; top: 50px; right: 58px; width: 136px; height: 136px; display: flex; align-items: center; justify-content: center; padding: 7px; overflow: hidden; border: 5px solid #fff; border-radius: 50%; background: #e8f0ed; box-shadow: 0 12px 26px rgba(28, 89, 72, .18); }
  .character-slot:empty { display: none; }
  .character-slot img { display: block; width: 100%; height: 100%; border-radius: 50%; object-fit: contain; }
  header { position: relative; z-index: 2; min-height: 174px; padding: 4px 166px 22px 0; text-align: left; }
  .program-name { display: inline-flex; align-items: center; max-width: 100%; padding: 8px 15px; border-radius: 999px; color: #fff; background: #1c5948; box-shadow: 0 5px 14px rgba(28, 89, 72, .16); font-size: 15px; font-weight: 700; line-height: 1.35; letter-spacing: -.15px; }
  .program-name .divider { margin: 0 7px; color: #a8d0c2; }
  h1 { max-width: 540px; margin: 17px 0 0; color: #1c5948; font-size: 40px; line-height: 1.2; letter-spacing: -1px; }
  main { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 14px; }
  .schedule { overflow: hidden; border: 1px solid rgba(40, 115, 93, .12); border-radius: 18px; background: rgba(255, 255, 255, .94); box-shadow: 0 8px 24px rgba(39, 79, 67, .07); }
  .schedule:empty { display: none; }
  .schedule-row { display: grid; grid-template-columns: 38px 62px minmax(0, 1fr); gap: 12px; align-items: center; min-height: 58px; padding: 11px 20px; }
  .schedule-row + .schedule-row { border-top: 1px solid #e4ece8; }
  .schedule-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; color: #1c5948; background: #dceee8; }
  .schedule-icon--location { color: #28735d; background: #e8f0ed; }
  .schedule-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
  .schedule-label { color: #28735d; font-size: 16px; font-weight: 800; }
  .schedule-value { color: #354a44; font-size: 17px; font-weight: 600; line-height: 1.45; }
  .body { min-height: 210px; padding: 25px 26px; overflow: hidden; border: 1px solid rgba(40, 115, 93, .1); border-top: 4px solid #89b9a9; border-radius: 18px; background: #fff; box-shadow: 0 10px 28px rgba(39, 79, 67, .08); font-size: 18px; line-height: 1.68; }
  section { padding: 15px 20px; border: 1px solid rgba(40, 115, 93, .1); border-radius: 16px; background: rgba(255, 255, 255, .86); font-size: 16px; line-height: 1.5; }
  section h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 7px; color: #1c5948; font-size: 17px; }
  section h2::before { content: ""; width: 7px; height: 18px; border-radius: 999px; background: #65a38f; }
  .gift-card-list { display: flex; flex-direction: column; gap: 10px; }
  .gift-card { display: flex; align-items: center; gap: 14px; }
  .gift-card-image { width: 52px; height: 52px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
  .gift-card-name { font-weight: 700; color: #1c2b22; }
  .gift-card-description { color: #52645f; font-size: 14px; margin-top: 2px; }
  ul { margin: 5px 0 0; padding-left: 22px; }
  li + li { margin-top: 5px; }
  .cta-wrap { width: 100%; }
  .cta { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 58px; padding: 14px 28px; border: 1px solid rgba(173, 126, 18, .14); border-radius: 15px; color: #5b4511; background: linear-gradient(135deg, #fbe9a8 0%, #f4cf68 100%); box-shadow: 0 8px 20px rgba(148, 105, 13, .15); font-size: 18px; font-weight: 800; text-align: center; text-decoration: none; }
  .cta::after { content: "→"; margin-left: 12px; font-size: 21px; line-height: 1; }
  footer { position: absolute; z-index: 2; right: 64px; bottom: 40px; left: 64px; color: #52645f; font-size: 15px; font-weight: 700; letter-spacing: .25px; text-align: center; }
</style>
</head>
<body>
  <div class="canvas">
    <div class="character-slot">${character}</div>
    <header>
      <div class="program-name">${escapeHtml(params.orgDisplayName)}<span class="divider">·</span>${escapeHtml(params.programName)}</div>
      <h1>${escapeHtml(title)}</h1>
    </header>
    <main>
      <div class="schedule">${scheduleLines}</div>
      <div class="body">${substituteBodyMergeFields(content.body_text, variables)}</div>
      ${giftBlock}
      ${precautionsBlock}
      ${ctaBlock}
    </main>
    <footer>${escapeHtml(params.orgDisplayName)}</footer>
  </div>
</body>
</html>`;
}

export async function renderLetter(
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

async function generateStandardLettersForApplicants(params: {
  request: {
    templateId: string;
    programId: string;
    applicantIds: string[];
    brandVariant: string;
  };
  context: GenerationContextRow;
  template: TemplateModeRow;
}): Promise<LetterGenerationResult> {
  const { request, context, template } = params;
  if (!template.category_id || !template.default_title_text) {
    throw new LetterGenerationRequestError(400, {
      error: 'Standard template category is missing or invalid',
    });
  }

  const contentResult = letterStandardContentBody.safeParse(template.standard_content);
  if (!contentResult.success) {
    throw new LetterGenerationRequestError(400, {
      error: 'Template standard_content is missing or invalid',
      issues: contentResult.error.issues,
    });
  }
  // A program's own date/time/location (entered once at program setup) takes precedence over
  // whatever static text is saved on the template, so the same reusable standard-layout template
  // renders correctly for whichever program it's used with instead of requiring the coordinator
  // to re-type per-program details into the template editor every time.
  const programDate = programDateValue(context.intake_data);
  const programTime = intakeValue(context.intake_data, 'program_time', 'time');
  const programLocation = intakeValue(context.intake_data, 'program_location', 'location');
  const programDatetimeText = [programDate, programTime].filter(Boolean).join(' ') || null;
  const content = {
    ...contentResult.data,
    datetime_text: programDatetimeText ?? contentResult.data.datetime_text,
    location_text: programLocation ?? contentResult.data.location_text,
  };

  const orgSettingsResult = await pool.query<OrgSettingsRow>(
    `SELECT business_unit, character_image_url, org_display_name, default_coordinator_name,
            default_coordinator_contact, updated_at
     FROM org_settings
     WHERE business_unit IN ($1, '')
     ORDER BY CASE WHEN business_unit = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [context.program_business_unit],
  );
  const orgSettings = orgSettingsResult.rows[0];
  if (!orgSettings) {
    throw new LetterGenerationRequestError(500, {
      error: 'Organization settings are unavailable',
    });
  }

  let characterDataUrl: string | null = null;
  let characterImageHash: string | null = null;
  if (orgSettings.character_image_url) {
    const characterPath = uploadUrlToFilePath(orgSettings.character_image_url);
    if (characterPath) {
      try {
        const characterBytes = await readFile(characterPath);
        characterImageHash = createHash('sha256').update(characterBytes).digest('hex');
        characterDataUrl = `data:${mimeTypeForImagePath(characterPath)};base64,${characterBytes.toString('base64')}`;
      } catch {
        // Keep the fixed character slot empty when the configured file is unavailable.
      }
    }
  }

  const giftItemRows = await pool.query<{
    id: string;
    name: string;
    description: string | null;
    image_url: string | null;
  }>(
    `SELECT id, name, description, image_url
     FROM gift_items
     WHERE program_id = $1
     ORDER BY created_at ASC`,
    [context.program_id],
  );
  const giftItems: GiftItemForRender[] = [];
  for (const item of giftItemRows.rows) {
    let imageDataUrl: string | null = null;
    if (item.image_url) {
      const imagePath = uploadUrlToFilePath(item.image_url);
      if (imagePath) {
        try {
          const imageBytes = await readFile(imagePath);
          imageDataUrl = `data:${mimeTypeForImagePath(imagePath)};base64,${imageBytes.toString('base64')}`;
        } catch {
          // Render this gift item without an image if the configured file is unavailable.
        }
      }
    }
    giftItems.push({ name: item.name, description: item.description, imageDataUrl });
  }
  const giftItemsSnapshot = giftItemRows.rows.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    image_url: item.image_url,
  }));

  const coordinatorName = orgSettings.default_coordinator_name;
  const coordinatorContact = orgSettings.default_coordinator_contact;
  const orgSettingsSnapshot = {
    business_unit: orgSettings.business_unit,
    character_image_url: orgSettings.character_image_url,
    character_image_hash: characterImageHash,
    org_display_name: orgSettings.org_display_name,
    default_coordinator_name: coordinatorName,
    default_coordinator_contact: coordinatorContact,
    updated_at: orgSettings.updated_at,
  };
  const categorySnapshot = {
    id: template.category_id,
    slug: template.category_slug,
    has_datetime: template.has_datetime,
    has_location: template.has_location,
    has_gift_info: template.has_gift_info,
    has_precautions: template.has_precautions,
    has_cta_link: template.has_cta_link,
    default_title_text: template.default_title_text,
  };
  const results: Array<Record<string, unknown>> = [];
  let generatedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;

  await mkdir(join(uploadsRoot, 'generated-letters'), { recursive: true });

  for (const applicantId of request.applicantIds) {
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

      const variables = buildPlaceholderValues(
        context,
        applicant,
        coordinatorName,
        coordinatorContact,
      );
      const renderInputHash = createHash('sha256')
        .update(
          JSON.stringify({
            template_id: context.template_id,
            applicant_id: applicant.id,
            brand_variant: request.brandVariant,
            output_format: context.output_format,
            layout_mode: 'standard',
            canvas_width: standardCanvasWidth,
            canvas_height: standardCanvasHeight,
            category_id: template.category_id,
            category: categorySnapshot,
            standard_content: content,
            org_settings: orgSettingsSnapshot,
            gift_items: giftItemsSnapshot,
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

      const html = renderStandardHtml({
        content,
        category: template,
        programName: context.program_name,
        orgDisplayName: orgSettings.org_display_name,
        characterDataUrl,
        giftItems,
        variables,
      });
      const outputBytes = await renderLetter(
        html,
        standardCanvasWidth,
        standardCanvasHeight,
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
            content_hash, template_variables_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id, applicant_id, file_path, file_size_bytes, content_hash, generated_at`,
        [
          letterId,
          context.template_id,
          context.program_id,
          applicant.id,
          fileUrl,
          outputBytes.byteLength,
          contentHash,
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

export async function generateLettersForApplicants(params: {
  templateId: string;
  programId: string;
  applicantIds: string[];
  brandVariant: string;
}): Promise<LetterGenerationResult> {
  const contextResult = await pool.query<GenerationContextRow>(
    `SELECT t.id AS template_id,
            t.brand_variant AS template_brand_variant,
            COALESCE(t.output_format, 'pdf') AS output_format,
            COALESCE(plc.background_image_url, t.background_image_url) AS background_image_url,
            COALESCE(plc.canvas_width, t.canvas_width) AS canvas_width,
            COALESCE(plc.canvas_height, t.canvas_height) AS canvas_height,
            COALESCE(plc.text_fields, t.text_fields) AS text_fields,
            p.id AS program_id,
            p.name AS program_name,
            bu.name AS program_business_unit,
            p.intake_data
     FROM letter_templates t
     CROSS JOIN programs p
     JOIN business_units bu ON bu.id = p.business_unit_id
     LEFT JOIN program_letter_customizations plc
       ON plc.template_id = t.id AND plc.program_id = p.id
     WHERE t.id = $1
       AND t.is_active = TRUE
       AND p.id = $2
       AND p.deleted_at IS NULL
     LIMIT 1`,
    [params.templateId, params.programId],
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

  const templateModeResult = await pool.query<TemplateModeRow>(
    `SELECT t.layout_mode,
            t.category_id,
            COALESCE(plc.standard_content, t.standard_content) AS standard_content,
            c.slug AS category_slug,
            c.has_datetime,
            c.has_location,
            c.has_gift_info,
            c.has_precautions,
            c.has_cta_link,
            c.default_title_text
     FROM letter_templates t
     LEFT JOIN letter_categories c ON c.id = t.category_id
     LEFT JOIN program_letter_customizations plc
       ON plc.template_id = t.id AND plc.program_id = $2
     WHERE t.id = $1 AND t.is_active = TRUE
     LIMIT 1`,
    [params.templateId, params.programId],
  );
  const templateMode = templateModeResult.rows[0];
  if (!templateMode) {
    throw new LetterGenerationRequestError(404, { error: 'Template or program not found' });
  }
  if (templateMode.layout_mode === 'standard') {
    return generateStandardLettersForApplicants({
      request: params,
      context,
      template: templateMode,
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

  const coordinatorResult = await pool.query<CoordinatorSettingsRow>(
    `SELECT default_coordinator_name, default_coordinator_contact
     FROM org_settings
     WHERE business_unit IN ($1, '')
     ORDER BY CASE WHEN business_unit = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [context.program_business_unit],
  );
  const coordinator = coordinatorResult.rows[0];
  const coordinatorName = coordinator?.default_coordinator_name ?? null;
  const coordinatorContact = coordinator?.default_coordinator_contact ?? null;
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

      const variables = buildPlaceholderValues(
        context,
        applicant,
        coordinatorName,
        coordinatorContact,
      );
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
            content_hash, template_variables_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id, applicant_id, file_path, file_size_bytes, content_hash, generated_at`,
        [
          letterId,
          context.template_id,
          context.program_id,
          applicant.id,
          fileUrl,
          outputBytes.byteLength,
          contentHash,
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
  validate({ body: letterGenerateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const body = letterGenerateBody.parse(request.body);
      const generationResult = await generateLettersForApplicants({
        templateId: body.template_id,
        programId: body.program_id,
        applicantIds: body.applicant_ids,
        brandVariant: body.brand_variant,
      });

      await pool.query(
        `INSERT INTO audit_logs
           (actor_name, action, entity_type, entity_id, program_id, details, ip_address)
         VALUES ($1, 'letter_generation_batch', 'program', $2, $2, $3::jsonb, $4)`,
        [
          getActorName(request),
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
      const result = await pool.query<DownloadLetterRow>(
        `SELECT gl.file_path, gl.file_size_bytes,
                COALESCE(lt.output_format, 'pdf') AS output_format
         FROM generated_letters gl
         JOIN programs p ON p.id = gl.program_id
         JOIN letter_templates lt ON lt.id = gl.template_id
         WHERE gl.id = $1
           AND p.deleted_at IS NULL
         LIMIT 1`,
        [request.params.letter_id],
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
