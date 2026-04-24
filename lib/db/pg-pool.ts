/**
 * Lazy `pg.Pool` for server-side read queries.
 *
 * Why `pg` (not `@supabase/supabase-js`): the event-read queries
 * (`lib/events/queries.ts`) expose a generic `query(sql, params)` surface so
 * they are trivially test-mockable. `pg.Pool` implements that surface
 * natively; Supabase JS would require translating parameterised SQL through
 * `.rpc()` or the PostgREST query builder for every call shape.
 *
 * The pool is created on first call and reused across server-component
 * renders (Node.js runtime only). Connection string is sourced from
 * `SUPABASE_DB_URL`, identical to the seeder CLI. The boot-time tripwire in
 * `lib/config.ts::assertSmartAiRef` is called once at pool creation to
 * refuse v1 refs even if the env var is misconfigured.
 *
 * Routes that depend on this module must declare `runtime = 'nodejs'`;
 * Edge runtime cannot load `pg`.
 */
import { Pool } from 'pg';
import { FORBIDDEN_SUPABASE_REFS, SANDBOX_SUPABASE_REF, PROD_SUPABASE_REF } from '@/lib/config';

let pool: Pool | null = null;

function assertSmartAiConnectionString(url: string): void {
  for (const forbidden of FORBIDDEN_SUPABASE_REFS) {
    if (url.includes(forbidden)) {
      throw new Error(
        `FATAL: SUPABASE_DB_URL contains v1 ref "${forbidden}". Refusing to connect.`,
      );
    }
  }
  if (!url.includes(SANDBOX_SUPABASE_REF) && !url.includes(PROD_SUPABASE_REF)) {
    throw new Error(
      'FATAL: SUPABASE_DB_URL does not contain a known Smart AI ref. Refusing to connect.',
    );
  }
}

export function getPgPool(): Pool {
  if (pool) return pool;
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      'SUPABASE_DB_URL is not set. Admin read routes require the Session Pooler URL.',
    );
  }
  assertSmartAiConnectionString(url);
  pool = new Pool({ connectionString: url, max: 4 });
  return pool;
}
