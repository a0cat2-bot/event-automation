import nodemailer from 'nodemailer';

import { env } from '../../config/env.js';
import type { EmailProvider, SendEmailOptions } from './types.js';

export class GmailProvider implements EmailProvider {
  async sendEmail(options: SendEmailOptions): Promise<{ messageId: string }> {
    if (!env.gmailUser) {
      throw new Error('GMAIL_USER is required to send email with the Gmail provider');
    }
    if (!env.gmailAppPassword) {
      throw new Error('GMAIL_APP_PASSWORD is required to send email with the Gmail provider');
    }

    // This must be a Gmail App Password: enable 2FA, then generate one at
    // https://myaccount.google.com/apppasswords. Do not use the account password.
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.gmailUser, pass: env.gmailAppPassword },
    });
    const result = await transporter.sendMail({
      from: { name: env.emailFromName, address: env.gmailUser },
      ...options,
    });

    return { messageId: result.messageId };
  }
}
