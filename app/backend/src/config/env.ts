import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT ?? 3000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_db',
  sallyEmail: process.env.SALLY_EMAIL || undefined,
  sallyPassword: process.env.SALLY_PASSWORD || undefined,
  // Sally collects a bare Knox ID; this turns it into the address letters are sent to.
  knoxEmailDomain: process.env.KNOX_EMAIL_DOMAIN || undefined,
  emailProvider: process.env.EMAIL_PROVIDER || 'gmail',
  gmailUser: process.env.GMAIL_USER || undefined,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || undefined,
  emailFromName: process.env.EMAIL_FROM_NAME || 'Program Team',
  knoxPortalApiUrl: process.env.KNOX_PORTAL_API_URL || undefined,
  knoxPortalApiToken: process.env.KNOX_PORTAL_API_TOKEN || undefined,
  knoxPortalAccount: process.env.KNOX_PORTAL_ACCOUNT || undefined,
  // Access control. `disabled` keeps the previous no-auth behaviour. See services/auth.
  authProvider: process.env.AUTH_PROVIDER || 'disabled',
  authSsoEmailHeader: process.env.AUTH_SSO_EMAIL_HEADER || 'X-Forwarded-Email',
  authSsoUserHeader: process.env.AUTH_SSO_USER_HEADER || 'X-Forwarded-User',
  authSsoNameHeader: process.env.AUTH_SSO_NAME_HEADER || 'X-Forwarded-DisplayName',
  // Comma-separated emails always granted admin, so a fresh deployment is never locked out.
  authBootstrapAdmins: process.env.AUTH_BOOTSTRAP_ADMINS || '',
  // AI features are off unless a deployment opts in. See services/llm.
  llmProvider: process.env.LLM_PROVIDER || 'disabled',
  llmModel: process.env.LLM_MODEL || undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  openAiApiKey: process.env.OPENAI_API_KEY || undefined,
  openAiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
  aiProApiUrl: process.env.AI_PRO_API_URL || undefined,
  aiProApiToken: process.env.AI_PRO_API_TOKEN || undefined,
} as const;
