/**
 * Apply SQL migrations to a Smart AI Supabase project.
 *
 * Smart AI has two projects: sandbox (Stage 0 dev) and production (created
 * 2026-04-23, cutover target 2026-10-21). Every migration lands in BOTH.
 * Apply order: sandbox first, verify, then production. This rehearses the
 * cutover promotion workflow continuously through Stage 0–1.
 *
 * Three concentric guards make v1 contamination impossible:
 *   (1) Required --target flag (no default — you must say which you mean).
 *   (2) Connection string MUST contain the target's Smart AI ref.
 *   (3) Connection string MUST NOT contain any v1 ref (prod or sandbox).
 * The pg client uses a connection-string password scoped to the target
 * project. v1 DB passwords are not available to this script; even maximal
 * misconfiguration cannot reach v1.
 *
 * Usage:
 *   SUPABASE_DB_URL="postgresql://postgres.<ref>:<PASSWORD>@..." \
 *     npx tsx scripts/apply-migrations.ts --target=sandbox
 *   SUPABASE_DB_URL="postgresql://postgres.<ref>:<PASSWORD>@..." \
 *     npx tsx scripts/apply-migrations.ts --target=production
 *
 * Tracks applied migrations in schema_migrations table. Idempotent:
 *   - Identical content (by sha256) = SKIP.
 *   - Changed content for an already-applied filename = ABORT (migrations
 *     are immutable once applied; write a new migration to change behaviour).
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import {
  FORBIDDEN_SUPABASE_REFS,
  PROD_SUPABASE_REF,
  SANDBOX_SUPABASE_REF,
} from '../lib/config';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'supabase', 'migrations');

type Target = 'sandbox' | 'production';

function parseTarget(argv: string[]): Target {
  const flag = argv.find(a => a.startsWith('--target='));
  if (!flag) {
    throw new Error(
      'Missing --target flag. Usage: npx tsx scripts/apply-migrations.ts --target=sandbox|--target=production'
    );
  }
  const value = flag.slice('--target='.length);
  if (value !== 'sandbox' && value !== 'production') {
    throw new Error(`Invalid --target value "${value}". Must be "sandbox" or "production".`);
  }
  return value;
}

function expectedRef(target: Target): string {
  return target === 'sandbox' ? SANDBOX_SUPABASE_REF : PROD_SUPABASE_REF;
}

function assertSmartAiConnectionString(url: string, target: Target): void {
  // Guard 1: reject any v1 ref.
  for (const forbidden of FORBIDDEN_SUPABASE_REFS) {
    if (url.includes(forbidden)) {
      throw new Error(
        `FATAL: connection string contains v1 ref "${forbidden}". Refusing to run migrations.`
      );
    }
  }
  // Guard 2: require the selected target's Smart AI ref.
  const required = expectedRef(target);
  if (!url.includes(required)) {
    throw new Error(
      `FATAL: --target=${target} but connection string does not contain ref "${required}". Refusing.`
    );
  }
  // Guard 3: refuse if the OTHER Smart AI ref appears (catches a sandbox URL
  // passed with --target=production or vice versa).
  const other = target === 'sandbox' ? PROD_SUPABASE_REF : SANDBOX_SUPABASE_REF;
  if (url.includes(other)) {
    throw new Error(
      `FATAL: --target=${target} but connection string contains the other Smart AI ref "${other}". Refusing.`
    );
  }
}

async function main(): Promise<void> {
  const target = parseTarget(process.argv);
  console.log(`[apply-migrations] target: ${target} (expected ref: ${expectedRef(target)})`);

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('SUPABASE_DB_URL is not set. Get it from Supabase dashboard →');
    console.error('Project Settings → Database → Connection string → Session pooler tab.');
    process.exit(1);
  }

  assertSmartAiConnectionString(dbUrl, target);

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
