import { env } from '../../config/env.js';
import { KnoxPortalRecruitmentRecipientProvider } from './knoxPortalProvider.js';
import { ManualRecruitmentRecipientProvider } from './manualProvider.js';
import type { RecruitmentRecipientProvider } from './types.js';

export type { RecruitmentRecipientProvider } from './types.js';
export { RecruitmentRecipientSourceUnavailableError } from './knoxPortalProvider.js';

export function getRecruitmentRecipientProvider(): RecruitmentRecipientProvider {
  if (env.recruitmentRecipientSource === 'manual') {
    return new ManualRecruitmentRecipientProvider();
  }
  if (env.recruitmentRecipientSource === 'knox_portal') {
    return new KnoxPortalRecruitmentRecipientProvider();
  }
  throw new Error(
    `Unsupported RECRUITMENT_RECIPIENT_SOURCE "${env.recruitmentRecipientSource}". Expected "manual" or "knox_portal".`,
  );
}
