import { GmailProvider } from './gmailProvider.js';
import { KnoxPortalProvider } from './knoxPortalProvider.js';
import type { EmailProvider } from './types.js';

export type { EmailAttachment, EmailProvider, SendEmailOptions } from './types.js';

export function getEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER || 'gmail';

  if (provider === 'gmail') return new GmailProvider();
  if (provider === 'knox_portal') return new KnoxPortalProvider();

  throw new Error(`Unsupported EMAIL_PROVIDER "${provider}". Expected "gmail" or "knox_portal".`);
}
