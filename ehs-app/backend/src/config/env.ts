import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';

// Local development gets an explicit throwaway secret so a fresh checkout starts easily.
// Production must always provide JWT_SECRET; there is deliberately no production fallback.
const jwtSecret = process.env.JWT_SECRET ?? (isProduction ? undefined : 'local-dev-only-change-me');

if (!jwtSecret) {
  throw new Error('JWT_SECRET is required when NODE_ENV=production');
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://ehs:ehs@localhost:5432/ehs_app',
  jwtCookieName: process.env.JWT_COOKIE_NAME ?? 'ehs_session',
  jwtSecret,
  sallyEmail: process.env.SALLY_EMAIL || undefined,
  sallyPassword: process.env.SALLY_PASSWORD || undefined,
  emailProvider: process.env.EMAIL_PROVIDER || 'gmail',
  gmailUser: process.env.GMAIL_USER || undefined,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || undefined,
  emailFromName: process.env.EMAIL_FROM_NAME || 'AX센터 EHS그룹',
  isProduction,
} as const;
