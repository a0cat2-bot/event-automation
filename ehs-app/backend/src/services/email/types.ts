export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  /** Set to embed inline (referenced from the HTML body via `cid:<value>`) instead of showing as a downloadable attachment. */
  cid?: string;
  contentDisposition?: 'inline' | 'attachment';
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<{ messageId: string }>;
}
