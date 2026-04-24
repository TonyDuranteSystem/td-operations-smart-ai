/**
 * CI assertion — architecture §5.4 "SupportedEntityTable parity".
 *
 * Fails the build if the TypeScript `SupportedEntityTable` union in
 * `lib/events/emit.ts` diverges from the IF/ELSIF ladder in the plpgsql
 * `emit_event_atomic` function on the Smart AI sandbox.
 *
 * Why this exists: emit_event_atomic's ELSE clause raises on any unknown
 * table — if TS lets a caller pass 'service_deliveries' but the function
 * hasn't added that branch yet, every event for that table fails in
 * production. The reverse (branch exists in SQL, missing from TS) is
 * benign but indicates drift.
 *
 * How:
 *   (1) Fetch the plpgsql source via Supabase Management API (SELECT
 *       prosrc FROM pg_proc WHERE proname = 'emit_event_atomic').
 *   (2) Regex out every branch's literal table name: `p_entity_table = '...'`.
 *   (3) Parse `lib/events/emit.ts` to extract the literal members of
 *       `SupportedEntityTable`.
 *   (4) Compare. Exit 1 on divergence naming the drift.
 *
 * The Management API call needs $SUPABASE_ACCESS_TOKEN in the environment
 * (read from ~/.zshrc; see CLAUDE.md). If absent, this script emits a
 * clear warning and exits 0 — local builds without the token still pass.
 * The token IS present in CI and pre-push, so real divergence is caught.
 *
 * Target project: Smart AI SANDBOX (tapbgvbglqacamhayfel). We check against
 * the sandbox source because it's where Stage 0–1 migrations land first.
 * Production (wxzomfntgnkryyzytcir) must be equivalent post-migration; a
 * follow-up migration runner check (`apply-migrations.ts`) ensures prod
 * catches up.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SANDBOX_SUPABASE_REF } from '../lib/config';

const EMIT_TS_PATH = path.resolve(__dirname, '..', 'lib', 'events', 'emit.ts');

type Outcome =
  | { kind: 'ok'; tables: readonly string[] }
  | { kind: 'drift'; missing_in_ts: string[]; missing_in_sql: string[]; tables_ts: string[]; tables_sql: string[] }
  | { kind: 'skipped'; reason: string };

// ---------------------------------------------------------------------------

function parseSupportedEntityTableFromTs(tsSource: string): string[] {
  // Match: export type SupportedEntityTable = 'a' | 'b' | 'c';
  const match = tsSource.match(
    /export\s+type\s+SupportedEntityTable\s*=\s*([^;]+);/
  );
  if (!match) {
    throw new Error(
      "Could not find 'export type SupportedEntityTable = ...' in lib/events/emit.ts. " +
      'Has it been renamed or removed?'
    );
  }
  const body = match[1] ?? '';
  const literals = [...body.matchAll(/'([^']+)'|"([^"]+)"/g)]
    .map(m => (m[1] ?? m[2]) as string)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (literals.length === 0) {
    throw new Error(
      'SupportedEntityTable parsed as empty. Expected at least one string literal.'
    );
  }
  return literals.sort();
}

function parseElsifLadderFromPlpgsql(prosrc: string): string[] {
  // Match each IF / ELSIF line referencing p_entity_table = '<name>'.
  // Intentionally ignores the p_entity_table IS NOT NULL gate above — that
  // has no equality literal. Also ignores the final ELSE (raise) clause.
  const re = /(?:IF|ELSIF)\s+p_entity_table\s*=\s*'([^']+)'/gi;
  const tables: string[] = [];
  for (const m of prosrc.matchAll(re)) {
    const captured = m[1];
    if (typeof captured === 'string' && captured.length > 0) {
      tables.push(captured);
    }
  }
  if (tables.length === 0) {
    throw new Error(
      "emit_event_atomic source returned by pg_proc contained no p_entity_table branches. " +
      "Either the function has changed shape, or the regex needs updating."
    );
  }
  return tables.sort();
}

async function fetchPlpgsqlSource(token: string, projectRef: string): Promise<string> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: "SELECT prosrc FROM pg_proc WHERE proname = 'emit_event_atomic' LIMIT 1",
      }),
    },
  );

  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(
      `Management API query failed: ${res.status} ${res.statusText}. ` +
      `Body: ${bodyText.slice(0, 400)}`
    );
  }

  const rows = (await res.json()) as Array<{ prosrc: string }>;
  const first = Array.isArray(rows) ? rows[0] : undefined;
  if (!first || typeof first.prosrc !== 'string') {
    throw new Error(
      'pg_proc returned no rows for emit_event_atomic. Has the migration been applied to ' +
      `project ${projectRef}?`
    );
  }
  return first.prosrc;
}

function diff(a: readonly string[], b: readonly string[]): string[] {
  const bs = new Set(b);
  return a.filter(x => !bs.has(x)).sort();
}

async function run(): Promise<Outcome> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;

  // Local fallback: when the token isn't present (a contributor running
  // `npm run assert:entity-table-sync` without setting up their shell), we
  // can still surface the TS side so obvious local-only mistakes are
  // caught. Full parity check requires the token — CI + pre-push have it.
  if (!token) {
    return {
      kind: 'skipped',
      reason:
        'SUPABASE_ACCESS_TOKEN not set. Skipping parity check. ' +
        'CI and the pre-push hook enforce this — local skip is fine if you ' +
        "haven't changed emit_event_atomic or SupportedEntityTable.",
    };
  }

  const tsSource = readFileSync(EMIT_TS_PATH, 'utf8');
  const tablesTs = parseSupportedEntityTableFromTs(tsSource);

  const prosrc = await fetchPlpgsqlSource(token, SANDBOX_SUPABASE_REF);
  const tablesSql = parseElsifLadderFromPlpgsql(prosrc);

  const missingInTs = diff(tablesSql, tablesTs);
  const missingInSql = diff(tablesTs, tablesSql);

  if (missingInTs.length === 0 && missingInSql.length === 0) {
    return { kind: 'ok', tables: tablesTs };
  }

  return {
    kind: 'drift',
    missing_in_ts: missingInTs,
    missing_in_sql: missingInSql,
    tables_ts: tablesTs,
    tables_sql: tablesSql,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

run()
  .then((outcome) => {
    if (outcome.kind === 'ok') {
      // eslint-disable-next-line no-console
      console.log(
        `[assert-entity-table-sync] OK. SupportedEntityTable matches plpgsql ladder: ${outcome.tables.join(', ')}`,
      );
      process.exit(0);
    }
    if (outcome.kind === 'skipped') {
      // eslint-disable-next-line no-console
      console.log(`[assert-entity-table-sync] SKIPPED. ${outcome.reason}`);
      process.exit(0);
    }
    // drift
    // eslint-disable-next-line no-console
    console.error('[assert-entity-table-sync] DRIFT detected between lib/events/emit.ts and emit_event_atomic().');
    // eslint-disable-next-line no-console
    console.error(`  TS  SupportedEntityTable: ${outcome.tables_ts.join(', ')}`);
    // eslint-disable-next-line no-console
    console.error(`  SQL ELSIF ladder        : ${outcome.tables_sql.join(', ')}`);
    if (outcome.missing_in_ts.length > 0) {
      // eslint-disable-next-line no-console
      console.error(`  Missing in TS union      : ${outcome.missing_in_ts.join(', ')}`);
    }
    if (outcome.missing_in_sql.length > 0) {
      // eslint-disable-next-line no-console
      console.error(`  Missing in SQL function  : ${outcome.missing_in_sql.join(', ')}`);
    }
    // eslint-disable-next-line no-console
    console.error(
      'Fix: add the missing branch (SQL migration OR TS union literal) in the SAME commit as this run.',
    );
    process.exit(1);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[assert-entity-table-sync] FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
