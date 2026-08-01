import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PoolClient } from 'pg';

import { pool } from './pool.js';

interface Migration {
  filename: string;
  checksum: string;
  sql: string;
}

interface AppliedMigration {
  filename: string;
  checksum: string;
}

const migrationsDirectory = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
const migrationFilename = /^\d+_[a-z0-9_]+\.sql$/;
const legacyV20LastMigration = '020_recruitment_notice.sql';

function errorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map(errorMessage).filter(Boolean).join('; ') || error.name;
  }
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

async function loadMigrations(): Promise<Migration[]> {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => migrationFilename.test(filename))
    .sort();

  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(
        new URL(filename, new URL('../../db/migrations/', import.meta.url)),
        'utf8',
      );
      return {
        filename,
        checksum: createHash('sha256').update(sql).digest('hex'),
        sql,
      };
    }),
  );
}

function withoutTransactionWrapper(sql: string): string {
  return sql.replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
}

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${table}`],
  );
  return result.rows[0]?.exists ?? false;
}

async function isEmptyDatabase(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM pg_tables
     WHERE schemaname = 'public'`,
  );
  return result.rows[0]?.count === 0;
}

async function isLegacyV20Database(client: PoolClient): Promise<boolean> {
  const requiredTables = [
    'ai_settings',
    'applicants',
    'audit_logs',
    'business_units',
    'gift_items',
    'letter_categories',
    'letter_templates',
    'org_settings',
    'participants',
    'program_letter_customizations',
    'programs',
    'recruitment_recipients',
    'results_reports',
    'users',
  ];
  const requiredColumns = [
    'ai_settings.character_image_enabled',
    'applicants.email',
    'audit_logs.actor_name',
    'letter_templates.background_image_url',
    'letter_templates.category_id',
    'letter_templates.layout_mode',
    'org_settings.business_unit',
    'participants.deselected_at',
    'programs.business_unit_id',
    'programs.recruitment_survey_url',
    'programs.requires_approval',
    'users.business_unit_ids',
  ];

  const tablesResult = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const tables = new Set(tablesResult.rows.map((row) => row.tablename));
  if (requiredTables.some((table) => !tables.has(table))) return false;

  const columnsResult = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'`,
  );
  const columns = new Set(columnsResult.rows.map((row) => `${row.table_name}.${row.column_name}`));
  if (requiredColumns.some((column) => !columns.has(column))) return false;
  if (columns.has('applicants.external_id') || columns.has('programs.business_unit')) return false;

  const seedResult = await client.query<{ complete: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM org_settings WHERE business_unit = '')
       AND NOT EXISTS (
         SELECT 1
         FROM (VALUES
           ('recruitment_with_gift', '참여모집안내 (상품 있음)'),
           ('recruitment_participation_win', '참여모집안내'),
           ('selection_notice', '당첨 안내'),
           ('gift_pickup_notice', '상품수령안내'),
           ('participation_detail_notice', '참여 안내'),
           ('non_selection_notice', '미당첨 안내'),
           ('satisfaction_survey', '만족도 설문')
         ) AS expected(slug, display_name)
         LEFT JOIN letter_categories actual
           ON actual.slug = expected.slug AND actual.display_name = expected.display_name
         WHERE actual.slug IS NULL
       ) AS complete`,
  );
  return seedResult.rows[0]?.complete ?? false;
}

async function createLedger(client: PoolClient): Promise<void> {
  await client.query(
    `CREATE TABLE schema_migrations (
       filename TEXT PRIMARY KEY,
       checksum CHAR(64) NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
}

async function initializeLedger(client: PoolClient, migrations: Migration[]): Promise<void> {
  if (await tableExists(client, 'schema_migrations')) return;

  const empty = await isEmptyDatabase(client);
  const legacyV20 = !empty && (await isLegacyV20Database(client));
  if (!empty && !legacyV20) {
    throw new Error(
      'Database has an untracked or partially migrated schema; refusing to guess its migration state.',
    );
  }

  await client.query('BEGIN');
  try {
    await createLedger(client);
    if (legacyV20) {
      const lastLegacyIndex = migrations.findIndex(
        (migration) => migration.filename === legacyV20LastMigration,
      );
      if (lastLegacyIndex === -1) {
        throw new Error(`Legacy baseline migration ${legacyV20LastMigration} is missing.`);
      }
      for (const migration of migrations.slice(0, lastLegacyIndex + 1)) {
        await client.query(`INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`, [
          migration.filename,
          migration.checksum,
        ]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  if (legacyV20) {
    console.log(
      `Recorded existing migrations through ${legacyV20LastMigration} without replaying them.`,
    );
  }
}

function pendingMigrations(migrations: Migration[], appliedRows: AppliedMigration[]): Migration[] {
  const files = new Map(migrations.map((migration) => [migration.filename, migration]));
  const applied = new Map(appliedRows.map((migration) => [migration.filename, migration]));

  for (const row of appliedRows) {
    const migration = files.get(row.filename);
    if (!migration) {
      throw new Error(
        `Applied migration ${row.filename} is missing from ${basename(migrationsDirectory)}.`,
      );
    }
    if (migration.checksum !== row.checksum.trim()) {
      throw new Error(`Applied migration ${row.filename} has changed; refusing to continue.`);
    }
  }

  let foundPending = false;
  for (const migration of migrations) {
    if (!applied.has(migration.filename)) {
      foundPending = true;
    } else if (foundPending) {
      throw new Error(
        `Migration ${migration.filename} is recorded after a missing earlier migration; refusing to continue.`,
      );
    }
  }

  return migrations.filter((migration) => !applied.has(migration.filename));
}

async function applyMigration(client: PoolClient, migration: Migration): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(withoutTransactionWrapper(migration.sql));
    await client.query(`INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`, [
      migration.filename,
      migration.checksum,
    ]);
    await client.query('COMMIT');
    console.log(`Applied ${migration.filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function migrate(): Promise<void> {
  const migrations = await loadMigrations();
  if (migrations.length === 0) throw new Error('No migration files found.');

  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext('event-automation-migrations'))`);
    await initializeLedger(client, migrations);
    const result = await client.query<AppliedMigration>(
      `SELECT filename, checksum FROM schema_migrations ORDER BY filename`,
    );
    const pending = pendingMigrations(migrations, result.rows);
    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }
    for (const migration of pending) await applyMigration(client, migration);
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('event-automation-migrations'))`);
    client.release();
  }
}

migrate()
  .catch((error: unknown) => {
    console.error('Migration failed:', errorMessage(error));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
