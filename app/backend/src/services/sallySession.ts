import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { BrowserContextOptions } from 'playwright';

import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

export type SallyStorageState = Exclude<BrowserContextOptions['storageState'], string | undefined>;

interface EncryptedSession {
  version: 1;
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface SallySessionRow {
  encrypted_storage_state: string;
  stored_at: Date;
  last_used_at: Date;
}

type SessionQuery = typeof pool.query;

interface SessionOptions {
  encryptionKey?: string;
  query?: SessionQuery;
}

export interface StoredSallySession {
  storageState: SallyStorageState;
  storedAt: Date;
  lastUsedAt: Date;
}

export class SallySessionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SallySessionConfigurationError';
  }
}

export class SallyConnectionRequiredError extends Error {
  constructor(
    message = 'This coordinator needs to connect their Sally account.',
    public readonly expired = false,
    public readonly storedAt?: Date,
    public readonly lastUsedAt?: Date,
  ) {
    super(message);
    this.name = 'SallyConnectionRequiredError';
  }
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function encryptionKey(value: string | undefined): Buffer {
  if (!value) {
    throw new SallySessionConfigurationError(
      'SALLY_SESSION_ENCRYPTION_KEY is required to store Sally sessions.',
    );
  }

  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new SallySessionConfigurationError(
      'SALLY_SESSION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.',
    );
  }
  return key;
}

function configuredKey(options: SessionOptions): string | undefined {
  return Object.prototype.hasOwnProperty.call(options, 'encryptionKey')
    ? options.encryptionKey
    : env.sallySessionEncryptionKey;
}

export function encryptSallyStorageState(
  email: string,
  storageState: SallyStorageState,
  keyValue: string | undefined,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(keyValue), iv);
  cipher.setAAD(Buffer.from(normalizedEmail(email), 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(storageState), 'utf8'),
    cipher.final(),
  ]);
  const encrypted: EncryptedSession = {
    version: 1,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return JSON.stringify(encrypted);
}

export function decryptSallyStorageState(
  email: string,
  value: string,
  keyValue: string | undefined,
): SallyStorageState {
  const encrypted = JSON.parse(value) as EncryptedSession;
  if (encrypted.version !== 1) throw new Error('Unsupported Sally session encryption version.');

  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(keyValue),
    Buffer.from(encrypted.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(normalizedEmail(email), 'utf8'));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as SallyStorageState;
}

export async function storeSallySession(
  email: string,
  storageState: SallyStorageState,
  options: SessionOptions = {},
): Promise<void> {
  const encrypted = encryptSallyStorageState(email, storageState, configuredKey(options));
  const query = options.query ?? pool.query.bind(pool);
  await query(
    `INSERT INTO sally_sessions
       (user_email, encrypted_storage_state, stored_at, last_used_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (user_email) DO UPDATE
       SET encrypted_storage_state = EXCLUDED.encrypted_storage_state,
           stored_at = NOW(),
           last_used_at = NOW()`,
    [normalizedEmail(email), encrypted],
  );
}

export async function resolveSallySession(
  email: string,
  options: SessionOptions = {},
): Promise<StoredSallySession> {
  const query = options.query ?? pool.query.bind(pool);
  const result = await query<SallySessionRow>(
    `SELECT encrypted_storage_state, stored_at, last_used_at
     FROM sally_sessions
     WHERE user_email = $1`,
    [normalizedEmail(email)],
  );
  const row = result.rows[0];
  if (!row) throw new SallyConnectionRequiredError();

  try {
    return {
      storageState: decryptSallyStorageState(
        email,
        row.encrypted_storage_state,
        configuredKey(options),
      ),
      storedAt: row.stored_at,
      lastUsedAt: row.last_used_at,
    };
  } catch (error) {
    if (error instanceof SallySessionConfigurationError) throw error;
    throw new SallyConnectionRequiredError(
      'The stored Sally session is no longer usable. Reconnect the Sally account.',
      true,
      row.stored_at,
      row.last_used_at,
    );
  }
}

export async function refreshSallySession(
  email: string,
  storageState: SallyStorageState,
  options: SessionOptions = {},
): Promise<void> {
  const encrypted = encryptSallyStorageState(email, storageState, configuredKey(options));
  const query = options.query ?? pool.query.bind(pool);
  await query(
    `UPDATE sally_sessions
     SET encrypted_storage_state = $2, last_used_at = NOW()
     WHERE user_email = $1`,
    [normalizedEmail(email), encrypted],
  );
}

export async function deleteSallySession(
  email: string,
  options: Pick<SessionOptions, 'query'> = {},
): Promise<void> {
  const query = options.query ?? pool.query.bind(pool);
  await query('DELETE FROM sally_sessions WHERE user_email = $1', [normalizedEmail(email)]);
}

export async function getSallySessionStatus(
  email: string,
  options: SessionOptions = {},
): Promise<{ connected: boolean; storedAt: Date | null; lastUsedAt: Date | null }> {
  try {
    const session = await resolveSallySession(email, options);
    return { connected: true, storedAt: session.storedAt, lastUsedAt: session.lastUsedAt };
  } catch (error) {
    if (error instanceof SallyConnectionRequiredError) {
      return {
        connected: false,
        storedAt: error.storedAt ?? null,
        lastUsedAt: error.lastUsedAt ?? null,
      };
    }
    throw error;
  }
}
