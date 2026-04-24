/**
 * Spec seeder CLI — Stage 0 S0.4.
 *
 * Mirrors the shape of `scripts/apply-migrations.ts`: required `--target`
 * flag, three concentric guards on the connection string, pg Client.
 *
 * Usage:
 *   SUPABASE_DB_URL="postgresql://postgres.<ref>:<PASSWORD>@..." \
 *     npx tsx scripts/seed-specs.ts --target=sandbox
 *
 * Sandbox seeding is done at Stage 0 S0.4. Production seeding is deferred
 * per D-Sandbox-vs-Prod until the S0.5 solver runs cleanly against the
 * sandbox spec.
 */

import { Client } from 'pg';
import {
  FORBIDDEN_SUPABASE_REFS,
  PROD_SUPABASE_REF,
  SANDBOX_SUPABASE_REF,
} from '../lib/config';
import { seedSpecs } from '../lib/specs/seed';
import { allSpecs } from '../lib/specs';

type Target = 'sandbox' | 'production';

function parseTarget(argv: string[]): Target {
  const flag = argv.find(a => a.startsWith('--target='));
  if (!flag) {
    throw new Error(
      'Missing --target flag. Usage: npx tsx scripts/seed-specs.ts --target=sandbox|--target=production',
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
  // Guard 1 — reject any v1 ref.
  for (const forbidden of FORBIDDEN_SUPABASE_REFS) {
    if (url.includes(forbidden)) {
      throw new Error(
        `FATAL: connection string contains v1 ref "${forbidden}". Refusing to seed.`,
      );
    }
  }
  // Guard 2 — require the selected target's Smart AI ref.
  const required = expectedRef(target);
  if (!url.includes(required)) {
    throw new Error(
      `FATAL: --target=${target} but connection string does not contain ref "${required}". Refusing.`,
    );
  }
  // Guard 3 — refuse if the OTHER Smart AI ref appears.
  const other = target === 'sandbox' ? PROD_SUPABASE_REF : SANDBOX_SUPABASE_REF;
  if (url.includes(other)) {
    throw new Error(
      `FATAL: --target=${target} but connection string contains the other Smart AI ref "${other}". Refusing.`,
    );
  }
}

async function main(): Promise<void> {
  const target = parseTarget(process.argv);
  // eslint-disable-next-line no-console
  console.log(`[seed-specs] target: ${target} (expected ref: ${expectedRef(target)})`);
  // eslint-disable-next-line no-console
  console.log(
    `[seed-specs] registered specs: ${allSpecs.map(s => `${s.contract_type}@${s.version}`).join(', ')}`,
  );

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('SUPABASE_DB_URL is not set. Get it from the Supabase dashboard →');
    // eslint-disable-next-line no-console
    console.error('Project Settings → Database → Connection string → Session pooler.');
    process.exit(1);
  }

  assertSmartAiConnectionString(url, target);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const outcome = await seedSpecs(client);
    // eslint-disable-next-line no-console
    console.log(`[seed-specs] inserted: ${outcome.inserted.length > 0 ? outcome.inserted.join(', ') : '(none)'}`);
    // eslint-disable-next-line no-console
    console.log(`[seed-specs] skipped (already present): ${outcome.skipped.length > 0 ? outcome.skipped.join(', ') : '(none)'}`);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[seed-specs] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
