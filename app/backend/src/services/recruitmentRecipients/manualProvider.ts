import { z } from 'zod';

import { pool } from '../../db/pool.js';
import type { RecruitmentRecipientProvider } from './types.js';

const recipientEmail = z.string().trim().min(1).max(255).email();

export function normalizeRecipientEmails(emails: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of emails) {
    const email = recipientEmail.parse(value);
    const key = email.toLocaleLowerCase('en-US');
    if (!unique.has(key)) unique.set(key, email);
  }
  return [...unique.values()];
}

export class ManualRecruitmentRecipientProvider implements RecruitmentRecipientProvider {
  async listRecipients(programId: string): Promise<string[]> {
    const result = await pool.query<{ email: string }>(
      `SELECT email
       FROM recruitment_recipients
       WHERE program_id = $1
       ORDER BY LOWER(email), email`,
      [programId],
    );
    return result.rows.map((row) => row.email);
  }

  async replaceRecipients(programId: string, emails: string[]): Promise<string[]> {
    const normalized = normalizeRecipientEmails(emails);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM recruitment_recipients WHERE program_id = $1', [programId]);
      if (normalized.length > 0) {
        await client.query(
          `INSERT INTO recruitment_recipients (program_id, email)
           SELECT $1, email
           FROM UNNEST($2::varchar[]) AS email`,
          [programId, normalized],
        );
      }
      await client.query('COMMIT');
      return normalized;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
