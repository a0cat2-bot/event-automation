import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Router, type NextFunction, type Request, type Response } from 'express';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { programParams, reportParams } from '../schemas/common.js';
import { reportGenerateBody } from '../schemas/contracts.js';
import { getBrowser } from '../utils/browser.js';
import { uploadsRoot } from '../utils/storage.js';

interface ReportProgramRow {
  id: string;
  name: string;
  business_unit: string;
  selection_mode: 'first_come_first_served' | 'score' | 'written_justification' | null;
}

interface SummaryCountsRow {
  applicant_count: number;
  participant_count: number;
  completed_survey_count: number;
  average_satisfaction_score: number | null;
  gift_recipient_count: number;
}

interface ReportSummary {
  applicant_count: number;
  participant_count: number;
  selection_rate: number;
  survey_completion_rate: number;
  average_satisfaction_score: number | null;
  gift_recipient_count: number;
}

interface ParticipantReportRow {
  rank: number | null;
  name: string | null;
  email: string | null;
  department: string | null;
  notification_status: 'pending' | 'sent' | 'bounced' | 'failed';
  survey_status: 'not_sent' | 'sent' | 'in_progress' | 'completed';
}

interface SurveyResultReportRow {
  name: string | null;
  satisfaction_score: number | null;
  feedback_text: string | null;
}

interface GiftReportRow {
  name: string | null;
  email: string | null;
  gift_status: 'selected' | 'delivered' | 'failed';
}

interface ResultsReportRow {
  id: string;
  program_id: string;
  format: 'markdown' | 'html' | 'pdf';
  content: string | null;
  file_path: string | null;
  summary: ReportSummary;
  created_at: Date;
}

interface ReportSections {
  summary: boolean;
  participants: boolean;
  surveyResults: boolean;
  gifts: boolean;
}

interface ReportContent {
  program: ReportProgramRow;
  summary: ReportSummary;
  participants: ParticipantReportRow[];
  surveyResults: SurveyResultReportRow[];
  gifts: GiftReportRow[];
  sections: ReportSections;
}

function displayValue(value: string | number | null): string {
  return value === null || value === '' ? '—' : String(value);
}

function percentage(rate: number): string {
  return `${(rate * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

function satisfaction(value: number | null): string {
  return value === null ? '—' : value.toFixed(2).replace(/\.00$/, '');
}

function escapeMarkdownCell(value: string | number | null): string {
  return displayValue(value).replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
}

function escapeHtml(value: string | number | null): string {
  return displayValue(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildMarkdownReport(content: ReportContent): string {
  const sections: string[] = [`# ${content.program.name} — Program Results`];

  if (content.sections.summary) {
    sections.push(`## Executive Summary

- **Business Unit:** ${content.program.business_unit}
- **Selection Mode:** ${displayValue(content.program.selection_mode)}
- **Total Applicants:** ${content.summary.applicant_count}
- **Selected Participants:** ${content.summary.participant_count}
- **Selection Rate:** ${percentage(content.summary.selection_rate)}
- **Survey Completion Rate:** ${percentage(content.summary.survey_completion_rate)}
- **Average Satisfaction Score:** ${satisfaction(content.summary.average_satisfaction_score)}
- **Gift Recipients:** ${content.summary.gift_recipient_count}`);
  }

  if (content.sections.participants) {
    const rows = content.participants.map(
      (participant) =>
        `| ${escapeMarkdownCell(participant.rank)} | ${escapeMarkdownCell(participant.name)} | ${escapeMarkdownCell(participant.email)} | ${escapeMarkdownCell(participant.department)} | ${escapeMarkdownCell(participant.notification_status)} | ${escapeMarkdownCell(participant.survey_status)} |`,
    );
    sections.push(`## Participant List

| Rank | Name | Email | Department | Notification | Survey |
|---:|---|---|---|---|---|
${rows.length > 0 ? rows.join('\n') : '| — | No participants | — | — | — | — |'}`);
  }

  if (content.sections.surveyResults) {
    const rows = content.surveyResults.map(
      (result) =>
        `| ${escapeMarkdownCell(result.name)} | ${escapeMarkdownCell(satisfaction(result.satisfaction_score))} | ${escapeMarkdownCell(result.feedback_text)} |`,
    );
    sections.push(`## Survey Results

- **Average Satisfaction Score:** ${satisfaction(content.summary.average_satisfaction_score)}
- **Completion Rate:** ${percentage(content.summary.survey_completion_rate)}

| Name | Satisfaction Score | Feedback |
|---|---:|---|
${rows.length > 0 ? rows.join('\n') : '| No completed surveys | — | — |'}`);
  }

  if (content.sections.gifts) {
    const rows = content.gifts.map(
      (gift) =>
        `| ${escapeMarkdownCell(gift.name)} | ${escapeMarkdownCell(gift.email)} | ${escapeMarkdownCell(gift.gift_status)} |`,
    );
    sections.push(`## Gift Recipients

| Name | Email | Gift Status |
|---|---|---|
${rows.length > 0 ? rows.join('\n') : '| No gift recipients | — | — |'}`);
  }

  return `${sections.join('\n\n')}\n`;
}

function buildHtmlReport(content: ReportContent): string {
  const sections: string[] = [];

  if (content.sections.summary) {
    sections.push(`<section>
      <h2>Executive Summary</h2>
      <dl class="summary">
        <div><dt>Business Unit</dt><dd>${escapeHtml(content.program.business_unit)}</dd></div>
        <div><dt>Selection Mode</dt><dd>${escapeHtml(content.program.selection_mode)}</dd></div>
        <div><dt>Total Applicants</dt><dd>${content.summary.applicant_count}</dd></div>
        <div><dt>Selected Participants</dt><dd>${content.summary.participant_count}</dd></div>
        <div><dt>Selection Rate</dt><dd>${percentage(content.summary.selection_rate)}</dd></div>
        <div><dt>Survey Completion Rate</dt><dd>${percentage(content.summary.survey_completion_rate)}</dd></div>
        <div><dt>Average Satisfaction</dt><dd>${satisfaction(content.summary.average_satisfaction_score)}</dd></div>
        <div><dt>Gift Recipients</dt><dd>${content.summary.gift_recipient_count}</dd></div>
      </dl>
    </section>`);
  }

  if (content.sections.participants) {
    const rows = content.participants
      .map(
        (participant) => `<tr>
          <td>${escapeHtml(participant.rank)}</td>
          <td>${escapeHtml(participant.name)}</td>
          <td>${escapeHtml(participant.email)}</td>
          <td>${escapeHtml(participant.department)}</td>
          <td>${escapeHtml(participant.notification_status)}</td>
          <td>${escapeHtml(participant.survey_status)}</td>
        </tr>`,
      )
      .join('');
    sections.push(`<section>
      <h2>Participant List</h2>
      <table>
        <thead><tr><th>Rank</th><th>Name</th><th>Email</th><th>Department</th><th>Notification</th><th>Survey</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">No participants</td></tr>'}</tbody>
      </table>
    </section>`);
  }

  if (content.sections.surveyResults) {
    const rows = content.surveyResults
      .map(
        (result) => `<tr>
          <td>${escapeHtml(result.name)}</td>
          <td>${escapeHtml(satisfaction(result.satisfaction_score))}</td>
          <td>${escapeHtml(result.feedback_text)}</td>
        </tr>`,
      )
      .join('');
    sections.push(`<section>
      <h2>Survey Results</h2>
      <p><strong>Average satisfaction:</strong> ${satisfaction(content.summary.average_satisfaction_score)} &nbsp; <strong>Completion rate:</strong> ${percentage(content.summary.survey_completion_rate)}</p>
      <table>
        <thead><tr><th>Name</th><th>Satisfaction Score</th><th>Feedback</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3">No completed surveys</td></tr>'}</tbody>
      </table>
    </section>`);
  }

  if (content.sections.gifts) {
    const rows = content.gifts
      .map(
        (gift) => `<tr>
          <td>${escapeHtml(gift.name)}</td>
          <td>${escapeHtml(gift.email)}</td>
          <td>${escapeHtml(gift.gift_status)}</td>
        </tr>`,
      )
      .join('');
    sections.push(`<section>
      <h2>Gift Recipients</h2>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Gift Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3">No gift recipients</td></tr>'}</tbody>
      </table>
    </section>`);
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(content.program.name)} — Program Results</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17202a; font: 14px/1.5 Arial, sans-serif; }
    h1 { margin: 0 0 24px; color: #145a4a; font-size: 28px; }
    h2 { margin: 28px 0 12px; color: #1e6f5c; font-size: 20px; }
    section { break-inside: avoid-page; }
    .summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; }
    .summary div { padding: 10px 12px; border: 1px solid #d8e5e1; border-radius: 6px; }
    dt { color: #56706a; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    dd { margin: 3px 0 0; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 7px 8px; border: 1px solid #cedbd7; text-align: left; vertical-align: top; }
    th { background: #eaf3f0; color: #234b40; }
    tr { break-inside: avoid; }
  </style>
</head>
<body>
  <h1>${escapeHtml(content.program.name)} — Program Results</h1>
  ${sections.join('\n  ')}
</body>
</html>`;
}

async function renderPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    const bytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    return Buffer.from(bytes);
  } finally {
    await page.close();
  }
}

export const reportsRouter = Router();

reportsRouter.post(
  '/programs/:program_id/reports/generate',
  validate({ params: programParams, body: reportGenerateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    let pdfAbsolutePath: string | null = null;
    try {
      const programId = request.params.program_id as string;
      const { format, include_sections: includeSections } = reportGenerateBody.parse(request.body);

      const programResult = await pool.query<ReportProgramRow>(
        `SELECT id, name, business_unit, selection_mode
         FROM programs
         WHERE id = $1
           AND deleted_at IS NULL
         LIMIT 1`,
        [programId],
      );
      const program = programResult.rows[0];
      if (!program) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }

      // Unlike the "active roster" counts elsewhere (programs.ts, participants.ts, gifts.ts),
      // this deliberately does not filter out deselected participants — a results report is a
      // historical record of what happened in the program, including people later excluded
      // after their survey/gift data was already recorded.
      const summaryResult = await pool.query<SummaryCountsRow>(
        `SELECT
           (SELECT COUNT(*)::int FROM applicants WHERE program_id = $1) AS applicant_count,
           (SELECT COUNT(*)::int FROM participants WHERE program_id = $1) AS participant_count,
           (SELECT COUNT(*)::int FROM participants
              WHERE program_id = $1 AND survey_status = 'completed') AS completed_survey_count,
           (SELECT AVG(satisfaction_score)::double precision FROM survey_results
              WHERE program_id = $1) AS average_satisfaction_score,
           (SELECT COUNT(*)::int FROM gift_recipients
              WHERE program_id = $1) AS gift_recipient_count`,
        [programId],
      );
      const counts = summaryResult.rows[0];
      if (!counts) throw new Error('Report summary query returned no row');
      const summary: ReportSummary = {
        applicant_count: counts.applicant_count,
        participant_count: counts.participant_count,
        selection_rate:
          counts.applicant_count === 0 ? 0 : counts.participant_count / counts.applicant_count,
        survey_completion_rate:
          counts.participant_count === 0
            ? 0
            : counts.completed_survey_count / counts.participant_count,
        average_satisfaction_score: counts.average_satisfaction_score,
        gift_recipient_count: counts.gift_recipient_count,
      };

      const requestedSections = new Set(includeSections);
      const sections: ReportSections = {
        summary: requestedSections.has('summary'),
        participants: requestedSections.has('participants'),
        surveyResults: requestedSections.has('survey_results'),
        gifts: requestedSections.has('gifts'),
      };

      const participants = sections.participants
        ? (
            await pool.query<ParticipantReportRow>(
              `SELECT pt.selection_rank AS rank, a.name, a.email, a.department,
                      pt.notification_status, pt.survey_status
               FROM participants pt
               JOIN applicants a ON a.id = pt.applicant_id AND a.program_id = pt.program_id
               WHERE pt.program_id = $1
               ORDER BY pt.selection_rank ASC NULLS LAST, pt.id ASC`,
              [programId],
            )
          ).rows
        : [];
      const surveyResults = sections.surveyResults
        ? (
            await pool.query<SurveyResultReportRow>(
              `SELECT a.name, latest_survey.satisfaction_score, latest_survey.feedback_text
               FROM participants pt
               JOIN applicants a ON a.id = pt.applicant_id AND a.program_id = pt.program_id
               JOIN LATERAL (
                 SELECT sr.satisfaction_score, sr.feedback_text
                 FROM survey_results sr
                 WHERE sr.participant_id = pt.id
                   AND sr.program_id = pt.program_id
                 ORDER BY sr.completion_date DESC NULLS LAST,
                          sr.updated_at DESC,
                          sr.created_at DESC
                 LIMIT 1
               ) latest_survey ON TRUE
               WHERE pt.program_id = $1
                 AND pt.survey_status = 'completed'
               ORDER BY pt.selection_rank ASC NULLS LAST, pt.id ASC`,
              [programId],
            )
          ).rows
        : [];
      const gifts = sections.gifts
        ? (
            await pool.query<GiftReportRow>(
              `SELECT a.name, a.email, gr.gift_status
               FROM gift_recipients gr
               JOIN participants pt
                 ON pt.id = gr.participant_id AND pt.program_id = gr.program_id
               JOIN applicants a ON a.id = pt.applicant_id AND a.program_id = pt.program_id
               WHERE gr.program_id = $1
               ORDER BY gr.selected_at DESC, gr.id ASC`,
              [programId],
            )
          ).rows
        : [];

      const reportContent: ReportContent = {
        program,
        summary,
        participants,
        surveyResults,
        gifts,
        sections,
      };
      const reportId = randomUUID();
      let content: string | null = null;
      let filePath: string | null = null;

      if (format === 'markdown') {
        content = buildMarkdownReport(reportContent);
      } else {
        const html = buildHtmlReport(reportContent);
        if (format === 'html') {
          content = html;
        } else {
          const directory = join(uploadsRoot, 'reports');
          await mkdir(directory, { recursive: true });
          pdfAbsolutePath = join(directory, `${reportId}.pdf`);
          await writeFile(pdfAbsolutePath, await renderPdf(html), { flag: 'wx' });
          filePath = `/uploads/reports/${reportId}.pdf`;
        }
      }

      const result = await pool.query<ResultsReportRow>(
        `INSERT INTO results_reports
           (id, program_id, format, content, file_path, summary)
         VALUES ($1, $2, $3::report_format, $4, $5, $6::jsonb)
         RETURNING id, program_id, format, content, file_path, summary, created_at`,
        [reportId, programId, format, content, filePath, JSON.stringify(summary)],
      );
      pdfAbsolutePath = null;
      response.status(201).json({ report: result.rows[0] });
    } catch (error) {
      if (pdfAbsolutePath) {
        try {
          await unlink(pdfAbsolutePath);
        } catch {
          // Preserve the generation or persistence error for the central error handler.
        }
      }
      next(error);
    }
  },
);

reportsRouter.get(
  '/programs/:program_id/reports/:report_id',
  validate({ params: reportParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const result = await pool.query<ResultsReportRow>(
        `SELECT id, program_id, format, content, file_path, summary, created_at
         FROM results_reports
         WHERE id = $1
           AND program_id = $2
         LIMIT 1`,
        [request.params.report_id, request.params.program_id],
      );
      const report = result.rows[0];
      if (!report) {
        response.status(404).json({ error: 'Results report not found' });
        return;
      }

      response.json({ report });
    } catch (error) {
      next(error);
    }
  },
);
