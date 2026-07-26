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
} as const;
