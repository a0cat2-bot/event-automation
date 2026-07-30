import { pool } from '../../db/pool.js';
import { getLlmProvider, isLlmConfigured } from './index.js';
import type { LlmProvider } from './types.js';

export const AI_FEATURES = [
  'justification_screening',
  'letter_copy',
  'survey_summary',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export type AiFeatureFlags = Record<AiFeature, boolean>;

interface AiSettingsRow {
  justification_screening_enabled: boolean;
  letter_copy_enabled: boolean;
  survey_summary_enabled: boolean;
  updated_at: Date;
  updated_by: string | null;
}

const ALL_OFF: AiFeatureFlags = {
  justification_screening: false,
  letter_copy: false,
  survey_summary: false,
};

function toFlags(row: AiSettingsRow): AiFeatureFlags {
  return {
    justification_screening: row.justification_screening_enabled,
    letter_copy: row.letter_copy_enabled,
    survey_summary: row.survey_summary_enabled,
  };
}

export async function readAiSettings(): Promise<{
  flags: AiFeatureFlags;
  updatedAt: string | null;
  updatedBy: string | null;
}> {
  const { rows } = await pool.query<AiSettingsRow>(
    `SELECT justification_screening_enabled, letter_copy_enabled, survey_summary_enabled,
            updated_at, updated_by
       FROM ai_settings
      WHERE id = TRUE`,
  );
  const row = rows[0];
  if (!row) return { flags: { ...ALL_OFF }, updatedAt: null, updatedBy: null };

  return {
    flags: toFlags(row),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}

export async function writeAiSettings(
  updates: Partial<AiFeatureFlags>,
  actorName: string | null,
): Promise<AiFeatureFlags> {
  const { rows } = await pool.query<AiSettingsRow>(
    `UPDATE ai_settings
        SET justification_screening_enabled = COALESCE($1, justification_screening_enabled),
            letter_copy_enabled = COALESCE($2, letter_copy_enabled),
            survey_summary_enabled = COALESCE($3, survey_summary_enabled),
            updated_at = NOW(),
            updated_by = $4
      WHERE id = TRUE
  RETURNING justification_screening_enabled, letter_copy_enabled, survey_summary_enabled,
            updated_at, updated_by`,
    [
      updates.justification_screening ?? null,
      updates.letter_copy ?? null,
      updates.survey_summary ?? null,
      actorName,
    ],
  );
  return toFlags(rows[0]!);
}

/**
 * Returns a provider only when BOTH gates allow this feature: the deployment has a usable provider
 * configured, and an admin has switched this specific feature on. Returns null otherwise.
 *
 * Callers treat null as "run the non-AI path" rather than as an error, which is what keeps the app
 * fully usable in environments where AI is unavailable.
 */
export async function getProviderForFeature(feature: AiFeature): Promise<LlmProvider | null> {
  if (!isLlmConfigured()) return null;

  const { flags } = await readAiSettings();
  if (!flags[feature]) return null;

  return getLlmProvider();
}
