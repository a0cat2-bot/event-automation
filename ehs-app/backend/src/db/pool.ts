import pg from 'pg';

import { env } from '../config/env.js';

// Shared PostgreSQL pool used by implemented routes and future business workflows.
export const pool = new pg.Pool({ connectionString: env.databaseUrl });
