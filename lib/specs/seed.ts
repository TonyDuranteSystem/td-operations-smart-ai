/**
 * Spec seeder — architecture §6.5.
 *
 * Idempotent UPSERT of every registered spec into `service_specs`. The
 * primary key constraint `UNIQUE (contract_type, version)` makes re-running
 * the seed a no-op for existing versions; a bumped version inserts a new
 * row (previous versions stay active=true for existing engagements
 * pinned to them).
 *
 * Architecture §6.5 also calls for a content-hash / `seeded_by` audit
 * column and a CI hash-check (Fix K). Those extra columns do not exist in
 * the shipped migration 004; deferring that hardening to a later migration
 * — the write-path here is kept minimal so the migration addition is a
 * clean change.
 *
 * This file does NOT import `@supabase/supabase-js` — it uses a minimal
 * `SpecSeederClient` interface satisfied by both the `pg` Client (used by
 * the CLI) and a test double. Keeping the coupling thin makes seed-unit
 * tests trivial and keeps the runtime choice of DB client at the edge.
 */

import type { Spec } from '@/lib/specs/types';
import { allSpecs } from '@/lib/specs';

export interface SpecSeederClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowCount: number | null; rows: T[] }>;
}

export type SeedOutcome = {
  inserted: string[];  // 'smllc_formation@1' etc. for specs newly written
  skipped: string[];   // specs whose (contract_type, version) already existed
};

/**
 * Seed each registered spec. Returns a per-spec outcome so the CLI can
 * print a clear summary.
 *
 * `is_active` is set true on insert. Version management (flipping old
 * versions to false) is deferred to S0.5+ — for Stage 0 the seeder only
 * appends; no spec has been versioned yet.
 */
export async function seedSpecs(
  client: SpecSeederClient,
  specs: readonly Spec[] = allSpecs,
): Promise<SeedOutcome> {
  const inserted: string[] = [];
  const skipped: string[] = [];

  for (const spec of specs) {
    const tag = `${spec.contract_type}@${spec.version}`;
    const res = await client.query<{ id: string }>(
      `INSERT INTO service_specs (contract_type, version, spec_json, is_active)
       VALUES ($1, $2, $3::jsonb, true)
       ON CONFLICT (contract_type, version) DO NOTHING
       RETURNING id`,
      [spec.contract_type, spec.version, JSON.stringify(spec)],
    );
    if ((res.rowCount ?? 0) > 0) inserted.push(tag);
    else skipped.push(tag);
  }

  return { inserted, skipped };
}
