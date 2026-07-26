import { z } from 'zod';

export const idParams = z.object({ id: z.string().uuid() });
export const programParams = z.object({ program_id: z.string().uuid() });
export const letterParams = z.object({ letter_id: z.string().uuid() });
export const participantParams = z.object({
  program_id: z.string().uuid(),
  participant_id: z.string().uuid(),
});
export const uploadParams = z.object({
  program_id: z.string().uuid(),
  upload_id: z.string().uuid(),
});
export const reportParams = z.object({
  program_id: z.string().uuid(),
  report_id: z.string().uuid(),
});
