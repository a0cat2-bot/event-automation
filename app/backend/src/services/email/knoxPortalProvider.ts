import { randomUUID } from 'node:crypto';

import { env } from '../../config/env.js';
import type { EmailProvider, SendEmailOptions } from './types.js';

interface KnoxPortalSendResponse {
  message_id?: string;
}

/**
 * Sends email through the internal Knox Portal API using token + account based auth.
 *
 * KNOX_PORTAL_API_URL is intentionally left blank until the office network's real endpoint is
 * available — until then, selecting EMAIL_PROVIDER=knox_portal fails fast with a clear config
 * error, and EMAIL_PROVIDER=gmail keeps working for testing. The request/response shape below
 * (Authorization/X-Knox-Account headers, `{ to, subject, html, text, attachments }` JSON body,
 * `{ message_id }` JSON response) is a best-guess placeholder, not a confirmed Knox Portal
 * contract — adjust it once real API docs are available.
 */
export class KnoxPortalProvider implements EmailProvider {
  async sendEmail(options: SendEmailOptions): Promise<{ messageId: string }> {
    if (!env.knoxPortalApiUrl) {
      throw new Error(
        'KNOX_PORTAL_API_URL is required to send email with the Knox Portal provider — set it once the internal API endpoint is available. Use EMAIL_PROVIDER=gmail until then.',
      );
    }
    if (!env.knoxPortalApiToken) {
      throw new Error('KNOX_PORTAL_API_TOKEN is required to send email with the Knox Portal provider');
    }
    if (!env.knoxPortalAccount) {
      throw new Error('KNOX_PORTAL_ACCOUNT is required to send email with the Knox Portal provider');
    }

    const response = await fetch(env.knoxPortalApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.knoxPortalApiToken}`,
        'X-Knox-Account': env.knoxPortalAccount,
      },
      body: JSON.stringify({
        from_name: env.emailFromName,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: options.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content_base64: attachment.content.toString('base64'),
          content_type: attachment.contentType,
          cid: attachment.cid,
          disposition: attachment.contentDisposition,
        })),
      }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Knox Portal API request failed (HTTP ${response.status}): ${bodyText || 'no response body'}`,
      );
    }

    let parsedBody: KnoxPortalSendResponse | null = null;
    if (bodyText) {
      try {
        parsedBody = JSON.parse(bodyText) as KnoxPortalSendResponse;
      } catch {
        throw new Error(`Knox Portal API returned a non-JSON response: ${bodyText.slice(0, 500)}`);
      }
    }

    return { messageId: parsedBody?.message_id ?? randomUUID() };
  }
}
