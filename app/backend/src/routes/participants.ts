import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Router, type NextFunction, type Request, type Response } from 'express';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { participantParams, programParams } from '../schemas/common.js';
import { participantNotifyBody, participantSurveyResultBody } from '../schemas/contracts.js';
import { getEmailProvider } from '../services/email/index.js';
import { getActorName } from '../utils/actor.js';
import { uploadUrlToFilePath } from '../utils/storage.js';
import { generateLettersForApplicants } from './letters.js';

interface ParticipantListRow {
  id: string;
  program_id: string;
  applicant_id: string;
  selection_rank: number | null;
  selection_reason: string | null;
  notification_status: 'pending' | 'sent' | 'bounced' | 'failed';
  notification_sent_at: Date | null;
  notification_letter_id: string | null;
  survey_id: string | null;
  survey_status: 'not_sent' | 'sent' | 'in_progress' | 'completed';
  is_gift_eligible: boolean;
  gift_status: 'not_selected' | 'selected' | 'delivered';
  gift_selected_at: Date | null;
  created_at: Date;
  updated_at: Date;
  name: string | null;
  email: string | null;
  department: string | null;
}

interface ParticipantNotificationRow {
  id: string;
  program_id: string;
  applicant_id: string;
  applicant_email: string | null;
  program_name: string;
}

interface NotificationTemplateRow {
  id: string;
  brand_variant: string | null;
  output_format: 'pdf' | 'image';
}

interface UpdatedNotificationRow {
  id: string;
  program_id: string;
  applicant_id: string;
  notification_status: 'sent' | 'failed';
  notification_sent_at: Date | null;
  notification_letter_id: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function writeNotificationAudit(params: {
  participantId: string;
  programId: string;
  templateId: string;
  emailProvider: string;
  status: 'sent' | 'failed';
  actorName: string | null;
  ipAddress: string | null;
}) {
  await pool.query(
    `INSERT INTO audit_logs
       (actor_name, action, entity_type, entity_id, program_id, details, ip_address)
     VALUES ($1, 'participant_notified', 'participant', $2, $3, $4::jsonb, $5)`,
    [
      params.actorName,
      params.participantId,
      params.programId,
      JSON.stringify({
        template_id: params.templateId,
        email_provider: params.emailProvider,
        status: params.status,
      }),
      params.ipAddress,
    ],
  );
}

export const participantsRouter = Router();

participantsRouter.get(
  '/programs/:program_id/participants',
  validate({ params: programParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const programResult = await pool.query<{ id: string }>(
        `SELECT id
         FROM programs
         WHERE id = $1
           AND deleted_at IS NULL
         LIMIT 1`,
        [programId],
      );
      if (!programResult.rows[0]) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }

      const result = await pool.query<ParticipantListRow>(
        `SELECT pt.id, pt.program_id, pt.applicant_id, pt.selection_rank,
                pt.selection_reason, pt.notification_status, pt.notification_sent_at,
                pt.notification_letter_id, pt.survey_id, pt.survey_status,
                pt.is_gift_eligible, pt.gift_status, pt.gift_selected_at,
                pt.created_at, pt.updated_at,
                a.name, a.email, a.department
         FROM participants pt
         JOIN applicants a ON a.id = pt.applicant_id AND a.program_id = pt.program_id
         WHERE pt.program_id = $1
           AND pt.deselected_at IS NULL
         ORDER BY pt.selection_rank ASC NULLS LAST, pt.id ASC`,
        [programId],
      );

      response.json({ participants: result.rows });
    } catch (error) {
      next(error);
    }
  },
);

participantsRouter.get(
  '/programs/:program_id/notification-history',
  validate({ params: programParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const programResult = await pool.query<{ id: string }>(
        `SELECT id FROM programs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [programId],
      );
      if (!programResult.rows[0]) {
        response.status(404).json({ error: 'Program not found' });
        return;
      }

      // One row per (participant, template) pair — the most recent send attempt for that
      // specific letter, so a coordinator can track each letter type's delivery separately
      // instead of a single last-sent status per participant.
      const result = await pool.query<{
        participant_id: string;
        template_id: string;
        status: 'sent' | 'failed';
        sent_at: Date;
      }>(
        `SELECT DISTINCT ON (entity_id, (details ->> 'template_id'))
                entity_id AS participant_id,
                details ->> 'template_id' AS template_id,
                details ->> 'status' AS status,
                timestamp AS sent_at
         FROM audit_logs
         WHERE program_id = $1
           AND action = 'participant_notified'
           AND details ->> 'template_id' IS NOT NULL
         ORDER BY entity_id, (details ->> 'template_id'), timestamp DESC`,
        [programId],
      );

      response.json({ history: result.rows });
    } catch (error) {
      next(error);
    }
  },
);

participantsRouter.post(
  '/programs/:program_id/participants/:participant_id/notify',
  validate({ params: participantParams, body: participantNotifyBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const participantId = request.params.participant_id as string;
      const { template_id: templateId } = participantNotifyBody.parse(request.body);
      const emailProviderName = process.env.EMAIL_PROVIDER || 'gmail';
      const auditParams = {
        participantId,
        programId,
        templateId,
        emailProvider: emailProviderName,
        actorName: getActorName(request),
        ipAddress: request.ip || null,
      };

      const participantResult = await pool.query<ParticipantNotificationRow>(
        `SELECT pt.id, pt.program_id, pt.applicant_id,
                a.email AS applicant_email, p.name AS program_name
         FROM participants pt
         JOIN applicants a ON a.id = pt.applicant_id AND a.program_id = pt.program_id
         JOIN programs p ON p.id = pt.program_id
         WHERE pt.id = $1
           AND pt.program_id = $2
           AND pt.deselected_at IS NULL
           AND p.deleted_at IS NULL
         LIMIT 1`,
        [participantId, programId],
      );
      const participant = participantResult.rows[0];
      if (!participant) {
        response.status(404).json({ error: 'Participant not found' });
        return;
      }
      const applicantEmail = participant.applicant_email?.trim();
      if (!applicantEmail) {
        await writeNotificationAudit({ ...auditParams, status: 'failed' });
        response.status(422).json({ error: 'Applicant has no email on file' });
        return;
      }

      const templateResult = await pool.query<NotificationTemplateRow>(
        `SELECT id, brand_variant, COALESCE(output_format, 'pdf') AS output_format
         FROM letter_templates
         WHERE id = $1 AND is_active = TRUE
         LIMIT 1`,
        [templateId],
      );
      const template = templateResult.rows[0];
      if (!template) {
        await writeNotificationAudit({ ...auditParams, status: 'failed' });
        response.status(404).json({ error: 'Letter template not found' });
        return;
      }

      let generationResult: Awaited<ReturnType<typeof generateLettersForApplicants>>;
      try {
        generationResult = await generateLettersForApplicants({
          templateId,
          programId: participant.program_id,
          applicantIds: [participant.applicant_id],
          brandVariant: template.brand_variant ?? '',
        });
      } catch (error) {
        await writeNotificationAudit({ ...auditParams, status: 'failed' });
        response.status(502).json({
          error: 'Letter generation failed',
          details: errorMessage(error),
        });
        return;
      }

      const generatedLetter = generationResult.results[0];
      if (generatedLetter?.status === 'failed') {
        await writeNotificationAudit({ ...auditParams, status: 'failed' });
        response.status(502).json({
          error: 'Letter generation failed',
          details:
            typeof generatedLetter.error === 'string'
              ? generatedLetter.error
              : 'Unknown letter generation error',
        });
        return;
      }

      const letterId = typeof generatedLetter?.id === 'string' ? generatedLetter.id : null;
      const letterUrl =
        typeof generatedLetter?.file_path === 'string' ? generatedLetter.file_path : null;
      const letterFilePath = letterUrl ? uploadUrlToFilePath(letterUrl) : null;
      if (!letterId || !letterFilePath) {
        await writeNotificationAudit({ ...auditParams, status: 'failed' });
        response.status(502).json({
          error: 'Letter generation failed',
          details: 'Generated letter metadata is missing or invalid',
        });
        return;
      }

      let attachmentContent: Buffer;
      try {
        attachmentContent = await readFile(letterFilePath);
      } catch (error) {
        await writeNotificationAudit({ ...auditParams, status: 'failed' });
        response.status(502).json({
          error: 'Letter generation failed',
          details: `Generated letter file is unavailable: ${errorMessage(error)}`,
        });
        return;
      }

      const isImage = template.output_format === 'image';
      const extension = isImage ? 'png' : 'pdf';
      const contentType = isImage ? 'image/png' : 'application/pdf';
      const subject = `[${participant.program_name}] 참여 안내`;
      // Image-format letters (the common case for these single-page branded notices) are
      // embedded directly in the body via a cid-referenced inline attachment, so the
      // recipient sees the letter immediately without opening anything. PDFs can't be
      // inlined in an email body, so they stay a regular (clickable) attachment.
      const inlineCid = isImage ? 'letter-image' : undefined;
      const html = isImage
        ? `<p>안녕하세요.</p><p>${htmlEscape(participant.program_name)} 참여 안내입니다.</p><p><img src="cid:${inlineCid}" alt="${htmlEscape(participant.program_name)} 참여 안내" style="max-width:100%;width:480px;border-radius:8px;display:block;" /></p><p>감사합니다.</p>`
        : `<p>안녕하세요.</p><p>${htmlEscape(participant.program_name)} 참여 안내문을 첨부드립니다.</p><p>감사합니다.</p>`;
      const text = `안녕하세요.\n\n${participant.program_name} 참여 안내문을 첨부드립니다.\n\n감사합니다.`;

      try {
        await getEmailProvider().sendEmail({
          to: applicantEmail,
          subject,
          html,
          text,
          attachments: [
            {
              filename: `${participant.program_name}-안내.${extension}`,
              content: attachmentContent,
              contentType,
              ...(inlineCid ? { cid: inlineCid, contentDisposition: 'inline' as const } : {}),
            },
          ],
        });
      } catch (error) {
        await pool.query(
          `UPDATE participants
           SET notification_status = 'failed', updated_at = NOW()
           WHERE id = $1`,
          [participantId],
        );
        await writeNotificationAudit({ ...auditParams, status: 'failed' });
        response.status(502).json({
          error: 'Email send failed',
          details: errorMessage(error),
        });
        return;
      }

      const updatedResult = await pool.query<UpdatedNotificationRow>(
        `UPDATE participants
         SET notification_status = 'sent',
             notification_sent_at = NOW(),
             notification_letter_id = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, program_id, applicant_id, notification_status,
                   notification_sent_at, notification_letter_id`,
        [participantId, letterId],
      );
      await writeNotificationAudit({ ...auditParams, status: 'sent' });

      response.json({ participant: updatedResult.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

participantsRouter.post(
  '/programs/:program_id/participants/:participant_id/survey-result',
  validate({ params: participantParams, body: participantSurveyResultBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const participantId = request.params.participant_id as string;
      const { satisfaction_score: satisfactionScore, feedback_text: feedbackText, sally_survey_id: sallySurveyId } =
        participantSurveyResultBody.parse(request.body);

      const participantResult = await pool.query<{ id: string }>(
        `SELECT pt.id
         FROM participants pt
         JOIN programs p ON p.id = pt.program_id
         WHERE pt.id = $1
           AND pt.program_id = $2
           AND p.deleted_at IS NULL
         LIMIT 1`,
        [participantId, programId],
      );
      if (!participantResult.rows[0]) {
        response.status(404).json({ error: 'Participant not found' });
        return;
      }

      await pool.query(
        `INSERT INTO survey_results
           (id, participant_id, program_id, sally_survey_id, completion_date, satisfaction_score,
            feedback_text)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
        [
          randomUUID(),
          participantId,
          programId,
          sallySurveyId ?? `manual-${randomUUID()}`,
          satisfactionScore,
          feedbackText ?? null,
        ],
      );

      const updatedResult = await pool.query<{
        id: string;
        program_id: string;
        applicant_id: string;
        survey_status: 'not_sent' | 'sent' | 'in_progress' | 'completed';
      }>(
        `UPDATE participants
         SET survey_status = 'completed', updated_at = NOW()
         WHERE id = $1
         RETURNING id, program_id, applicant_id, survey_status`,
        [participantId],
      );

      response.status(201).json({ participant: updatedResult.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);
