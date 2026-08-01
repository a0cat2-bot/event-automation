import type { EmailProvider, SendEmailOptions } from './email/index.js';

export interface RecruitmentNoticeMessage {
  programName: string;
  subject: string;
  letterHtml: string;
  outputFormat: 'pdf' | 'image';
  surveyUrl: string;
  ctaText: string;
  attachment?: Buffer;
}

export interface RecruitmentNoticeOutcome {
  email: string;
  status: 'sent' | 'failed';
  message_id?: string;
  error?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function recruitmentEmailContent(message: RecruitmentNoticeMessage): {
  html: string;
  text: string;
} {
  const programName = escapeHtml(message.programName);
  const surveyUrl = escapeHtml(message.surveyUrl);
  const letter =
    message.outputFormat === 'image'
      ? `<p><a href="${surveyUrl}"><img src="cid:recruitment-letter" alt="${programName} 모집 안내" style="max-width:100%;width:480px;border-radius:8px;display:block;" /></a></p>`
      : '<p>모집 안내문을 첨부드립니다.</p>';
  return {
    html: `<p>안녕하세요.</p><p>${programName} 참여자 모집 안내입니다.</p>${letter}<p>감사합니다.</p>`,
    text: `안녕하세요.\n\n${message.programName} 참여자 모집 안내입니다.\n${message.ctaText}: ${message.surveyUrl}\n\n감사합니다.`,
  };
}

function emailOptions(
  recipient: string,
  message: RecruitmentNoticeMessage,
): SendEmailOptions {
  if (!message.attachment) throw new Error('Recruitment letter attachment is required to send');
  const isImage = message.outputFormat === 'image';
  const email = recruitmentEmailContent(message);
  return {
    to: recipient,
    subject: message.subject,
    html: email.html,
    text: email.text,
    attachments: [
      {
        filename: `${message.programName}-모집-안내.${isImage ? 'png' : 'pdf'}`,
        content: message.attachment,
        contentType: isImage ? 'image/png' : 'application/pdf',
        ...(isImage
          ? { cid: 'recruitment-letter', contentDisposition: 'inline' as const }
          : {}),
      },
    ],
  };
}

export async function runRecruitmentNotice(params: {
  dryRun: boolean;
  recipients: string[];
  message: RecruitmentNoticeMessage;
  emailProvider?: EmailProvider;
  recordSend?: (outcomes: RecruitmentNoticeOutcome[]) => Promise<void>;
}) {
  const email = recruitmentEmailContent(params.message);
  if (params.dryRun) {
    return {
      dry_run: true as const,
      recipients: params.recipients,
      subject: params.message.subject,
      email_html: email.html,
      email_text: email.text,
      letter_html: params.message.letterHtml,
      output_format: params.message.outputFormat,
      survey_url: params.message.surveyUrl,
      cta_text: params.message.ctaText,
    };
  }

  if (!params.emailProvider || !params.recordSend) {
    throw new Error('Confirmed recruitment notice send dependencies are missing');
  }

  const outcomes = await Promise.all(
    params.recipients.map(async (recipient): Promise<RecruitmentNoticeOutcome> => {
      try {
        const sent = await params.emailProvider?.sendEmail(
          emailOptions(recipient, params.message),
        );
        return { email: recipient, status: 'sent', message_id: sent?.messageId };
      } catch (error) {
        return {
          email: recipient,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown email error',
        };
      }
    }),
  );
  await params.recordSend(outcomes);
  return { dry_run: false as const, outcomes };
}
