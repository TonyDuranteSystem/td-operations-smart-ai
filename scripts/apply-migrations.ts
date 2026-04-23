/**
 * Apply SQL migrations to the Smart AI Supabase project.
 *
 * Per R096 (sandbox-first DDL): this runs against the Smart AI sandbox
 * `tapbgvbglqacamhayfel`. The `EXPECTED_SUPABASE_REF` guard refuses to
 * proceed if the connection string's host doesn't match.
 *
 * Usage:
 *   SUPABASE_DB_URL="postgresql://postgres.tapbgvbglqacamhayfel:PASSWORD@..." \
 *     npx tsx scripts/apply-migrations.ts
 *
 * Tracks applied migrations in schema_migrations table. Idempotent.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { EXPECTED_SUPABASE_REF, FORBIDDEN_SUPABASE_REFS } from '../lib/config';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'supabase', 'migrations');

function assertSmartAiConnectionString(url: string): void {
  // Supabase pooled or direct URLs both contain the project ref. The strictest
  // check: reject any string that contains a forbidden v1 ref, AND require the
  // expected ref to appear somewhere.
  for (const forbidden of FORBIDDEN_SUPABASE_REFS) {
    if (url.includes(forbidden)) {
      throw new Error(
        `FATAL: connection string contains v1 ref "${forbidden}". Refusing to run migrations.`
      );
    }
  }
  if (!url.includes(EXPECTED_SUPABASE_REF)) {
    throw new Error(
      `FATAL: connection string does not contain expected Smart AI ref "${EXPECTED_SUPABASE_REF}". Refusing to run migrations.`
    );
  }
}

async function main(): Promise<void> {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('SUPABASE_DB_URL is not set. Get it from Supabase dashboard →');
    console.error('Project Settings → Database → Connection string (URI, session pooler).');
    process.exit(1);
  }

  assertSmartAiConnectionString(dbUrl);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration files.`);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename     TEXT PRIMARY KEY,
        applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        checksum     TEXT NOT NULL
      )
    `);

    const { rows: applied } = await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations'
    );
    const appliedMap = new Map(applied.map(r => [r.filename, r.checksum]));

    for (const file of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = await hashString(sql);
      const prior = appliedMap.get(file);

      if (prior === checksum) {
        console.log(`  SKIP  ${file} (already applied)`);
        continue;
      }
      if (prior && prior !== checksum) {
        throw new Error(
          `Migration ${file} was already applied with a different checksum. ` +
            `Prior: ${prior}. Current: ${checksum}. ` +
            `Migrations are immutable once applied — write a new migration to change behaviour.`
        );
      }

      console.log(`  APPLY ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [file, checksum]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('All migrations applied.');
  } finally {
    await client.end();
  }
}

async function hashString(s: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(s).digest('hex');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
