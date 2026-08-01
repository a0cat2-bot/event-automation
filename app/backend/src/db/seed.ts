import { readFile } from 'node:fs/promises';

import { pool } from './pool.js';

const seedFile = new URL('../../db/seed/minimal.sql', import.meta.url);

async function seed(): Promise<void> {
  await pool.query(await readFile(seedFile, 'utf8'));
  console.log('Minimal seed data is ready.');
}

seed()
  .catch((error: unknown) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
