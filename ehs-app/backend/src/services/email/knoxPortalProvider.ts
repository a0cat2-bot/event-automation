import type { EmailProvider, SendEmailOptions } from './types.js';

export class KnoxPortalProvider implements EmailProvider {
  async sendEmail(_options: SendEmailOptions): Promise<{ messageId: string }> {
    // Future integration point: call the internal Knox Portal API once it becomes available.
    throw new Error(
      'Knox Portal email provider is not implemented yet — the internal Knox Portal MCP/API is still in development. Set EMAIL_PROVIDER=gmail until it ships.',
    );
  }
}
