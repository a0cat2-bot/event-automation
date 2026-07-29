import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT ?? 3000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_db',
  sallyEmail: process.env.SALLY_EMAIL || undefined,
  sallyPassword: process.env.SALLY_PASSWORD || undefined,
  emailProvider: process.env.EMAIL_PROVIDER || 'gmail',
  gmailUser: process.env.GMAIL_USER || undefined,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || undefined,
  emailFromName: process.env.EMAIL_FROM_NAME || 'Program Team',
  knoxPortalApiUrl: process.env.KNOX_PORTAL_API_URL || undefined,
  knoxPortalApiToken: process.env.KNOX_PORTAL_API_TOKEN || undefined,
  knoxPortalAccount: process.env.KNOX_PORTAL_ACCOUNT || undefined,
  // AI features are off unless a deployment opts in. See services/llm.
  llmProvider: process.env.LLM_PROVIDER || 'disabled',
  llmModel: process.env.LLM_MODEL || undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  aiProApiUrl: process.env.AI_PRO_API_URL || undefined,
  aiProApiToken: process.env.AI_PRO_API_TOKEN || undefined,
} as const;
