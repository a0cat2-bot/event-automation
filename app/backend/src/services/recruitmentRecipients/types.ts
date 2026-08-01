export interface RecruitmentRecipientProvider {
  listRecipients(programId: string): Promise<string[]>;
  replaceRecipients(programId: string, emails: string[]): Promise<string[]>;
}
