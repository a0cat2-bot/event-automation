import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recruitmentEmailContent,
  runRecruitmentNotice,
  type RecruitmentNoticeMessage,
  type RecruitmentNoticeOutcome,
} from './recruitmentNotice.js';

const message: RecruitmentNoticeMessage = {
  programName: '2026 리더십 워크숍',
  subject: '리더십 워크숍 참여자 모집',
  letterHtml: '<main>모집 안내문</main>',
  outputFormat: 'image',
  surveyUrl: 'https://survey.example.com/recruitment?id=42',
  ctaText: '신청하기',
  attachment: Buffer.from('letter-image'),
};

test('a dry run returns the preview without sending email or recording a send', async () => {
  const preview = await runRecruitmentNotice({
    dryRun: true,
    recipients: ['first@example.com', 'second@example.com'],
    message,
    emailProvider: {
      sendEmail: async () => assert.fail('dry run must not call the email provider'),
    },
    recordSend: async () => assert.fail('dry run must not record a send'),
  });

  const email = recruitmentEmailContent(message);
  assert.deepEqual(preview, {
    dry_run: true,
    recipients: ['first@example.com', 'second@example.com'],
    subject: message.subject,
    email_html: email.html,
    email_text: email.text,
    letter_html: message.letterHtml,
    output_format: message.outputFormat,
    survey_url: message.surveyUrl,
    cta_text: message.ctaText,
  });
});

test('a confirmed send isolates one recipient failure and continues with the others', async () => {
  const attempted: string[] = [];
  let recorded: RecruitmentNoticeOutcome[] | undefined;

  const result = await runRecruitmentNotice({
    dryRun: false,
    recipients: ['first@example.com', 'middle@example.com', 'last@example.com'],
    message,
    emailProvider: {
      sendEmail: async ({ to }) => {
        attempted.push(to);
        if (to === 'middle@example.com') throw new Error('mailbox unavailable');
        return { messageId: `message-for-${to}` };
      },
    },
    recordSend: async (outcomes) => {
      recorded = outcomes;
    },
  });

  assert.deepEqual(attempted, ['first@example.com', 'middle@example.com', 'last@example.com']);
  assert.deepEqual(result, {
    dry_run: false,
    outcomes: [
      {
        email: 'first@example.com',
        status: 'sent',
        message_id: 'message-for-first@example.com',
      },
      { email: 'middle@example.com', status: 'failed', error: 'mailbox unavailable' },
      {
        email: 'last@example.com',
        status: 'sent',
        message_id: 'message-for-last@example.com',
      },
    ],
  });
  assert.deepEqual(recorded, result.outcomes);
});

test('a confirmed send refuses to run without either required dependency', async () => {
  const emailProvider = {
    sendEmail: async () => ({ messageId: 'must-not-send' }),
  };
  const recordSend = async (_outcomes: RecruitmentNoticeOutcome[]) => undefined;

  await assert.rejects(
    () => runRecruitmentNotice({ dryRun: false, recipients: [], message, recordSend }),
    /Confirmed recruitment notice send dependencies are missing/,
  );
  await assert.rejects(
    () => runRecruitmentNotice({ dryRun: false, recipients: [], message, emailProvider }),
    /Confirmed recruitment notice send dependencies are missing/,
  );
});

test('the recruitment survey URL is carried into the letter CTA', () => {
  const content = recruitmentEmailContent(message);

  assert.match(content.html, /href="https:\/\/survey\.example\.com\/recruitment\?id=42"/);
  assert.match(content.text, /신청하기: https:\/\/survey\.example\.com\/recruitment\?id=42/);
});
