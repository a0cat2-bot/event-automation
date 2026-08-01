import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT ?? 3000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_db',
  sallyEmail: process.env.SALLY_EMAIL || undefined,
  sallyPassword: process.env.SALLY_PASSWORD || undefined,
  sallyAutomationAdminEmail: process.env.SALLY_AUTOMATION_ADMIN_EMAIL || undefined,
  // Sally collects a bare Knox ID; this turns it into the address letters are sent to.
  knoxEmailDomain: process.env.KNOX_EMAIL_DOMAIN || undefined,
  recruitmentRecipientSource: process.env.RECRUITMENT_RECIPIENT_SOURCE || 'manual',
  emailProvider: process.env.EMAIL_PROVIDER || 'gmail',
  gmailUser: process.env.GMAIL_USER || undefined,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || undefined,
  emailFromName: process.env.EMAIL_FROM_NAME || 'Program Team',
  knoxPortalApiUrl: process.env.KNOX_PORTAL_API_URL || undefined,
  knoxPortalApiToken: process.env.KNOX_PORTAL_API_TOKEN || undefined,
  knoxPortalAccount: process.env.KNOX_PORTAL_ACCOUNT || undefined,
  // Access control. `disabled` keeps the previous no-auth behaviour. See services/auth.
  authProvider: process.env.AUTH_PROVIDER || 'disabled',
  // Header names per the AI Pro guide's gateway contract (X-User-ID / X-User-Roles). Configurable
  // because this app may sit behind a different gateway.
  authSsoEmailHeader: process.env.AUTH_SSO_EMAIL_HEADER || 'X-User-Email',
  authSsoUserHeader: process.env.AUTH_SSO_USER_HEADER || 'X-User-ID',
  authSsoNameHeader: process.env.AUTH_SSO_NAME_HEADER || 'X-User-Name',
  // Comma-separated emails always granted admin, so a fresh deployment is never locked out.
  authBootstrapAdmins: process.env.AUTH_BOOTSTRAP_ADMINS || '',
  // AI features are off unless a deployment opts in. See services/llm.
  llmProvider: process.env.LLM_PROVIDER || 'disabled',
  llmModel: process.env.LLM_MODEL || undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  openAiApiKey: process.env.OPENAI_API_KEY || undefined,
  openAiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
  // AI Pro. The base URL defaults to the documented endpoint, so only the service key is required.
  aiProApiUrl: process.env.AI_PRO_API_URL || undefined,
  aiProApiKey: process.env.AI_PRO_API_KEY || undefined,
  aiProApiVersion: process.env.AI_PRO_API_VERSION || 'v1',
  // 'openai' (default) or 'anthropic' — selects which request/response shape AI Pro is asked for.
  aiProModelStyle: process.env.AI_PRO_MODEL_STYLE || 'openai',
  // Justification screening batches requests to stay inside the model's input window. Defaults
  // suit a 6,000-token model; raise them for one with a larger window (e.g. aipro-advanced).
  aiScreeningBatchChars: Number(process.env.AI_SCREENING_BATCH_CHARS ?? 3500),
  aiScreeningBatchSize: Number(process.env.AI_SCREENING_BATCH_SIZE ?? 10),
} as const;
