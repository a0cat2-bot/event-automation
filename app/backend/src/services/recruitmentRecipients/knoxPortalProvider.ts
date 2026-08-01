import type { RecruitmentRecipientProvider } from './types.js';

export class RecruitmentRecipientSourceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecruitmentRecipientSourceUnavailableError';
  }
}

export class KnoxPortalRecruitmentRecipientProvider implements RecruitmentRecipientProvider {
  private unavailable(): never {
    throw new RecruitmentRecipientSourceUnavailableError(
      'The Knox Portal recruitment recipient source is not available yet. Set RECRUITMENT_RECIPIENT_SOURCE=manual and enter employee email addresses manually until a Knox mail or contacts endpoint is approved.',
    );
  }

  async listRecipients(_programId: string): Promise<string[]> {
    return this.unavailable();
  }

  async replaceRecipients(_programId: string, _emails: string[]): Promise<string[]> {
    return this.unavailable();
  }
}
