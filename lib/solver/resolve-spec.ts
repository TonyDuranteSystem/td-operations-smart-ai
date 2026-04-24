/**
 * resolveSpec — architecture §6.3 Fix A (pin_date + rule_overrides).
 *
 * Returns an `EffectiveSpec`: the raw spec with all applicable
 * `rule_overrides` applied at the caller-supplied `pin_date`. Engagements
 * MUST pass their own `created_at` as pin_date so a later override cannot
 * retroactively mutate contracted pricing (Fix A's price-protection
 * invariant, also enforced in-DB via the `effective_from >= created_at`
 * CHECK constraint).
 *
 * This is a pure data-transform. DB access is abstracted behind
 * `SpecResolverClient` — the same minimal-client pattern used by the
 * seeder — so unit tests drive it without `pg` or Supabase wiring.
 *
 * Shipped-table reality (see migration 004):
 *   rule_overrides(id, rule_path, value, effective_from, allow_backdate,
 *                  created_by, created_at)
 * Architecture §6.3 also shows `spec_id`, `effective_to`, `active`, and
 * `reason` columns. Those are NOT in the shipped migration and will arrive
 * in a later one. Implications for this skeleton:
 *   - Without `spec_id`, every override row is considered applicable to the
 *     one requested spec. That is safe at S0.5 because only one spec
 *     (smllc_formation v1) has been seeded. A later migration will add
 *     `spec_id NOT NULL REFERENCES service_specs(id)` and this function
 *     will gain a `WHERE spec_id = $1` filter — the logic here is written
 *     to make that addition a one-line change.
 *   - Without `effective_to` / `active`, once an override's `effective_from`
 *     has passed it applies forever. Acceptable for skeleton; revisit when
 *     CRM override-editing UI lands.
 */
import type { Spec } from '@/lib/specs/types';
import type { EffectiveSpec } from '@/lib/solver/types';

export interface SpecResolverClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowCount: number | null; rows: T[] }>;
}

type OverrideRow = {
  rule_path: string;
  value: unknown;
  effective_from: string;
};

type SpecRow = {
  id: string;
  spec_json: Spec;
  version: number;
};

export class SpecResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecResolutionError';
  }
}

/**
 * Write the given value into `target` at the dotted path. Intermediate
 * objects are created when missing; existing non-object intermediates throw,
 * because silently overwriting a primitive would hide a malformed rule_path
 * (e.g. `pricing_rules.base_price_usd.extra` against a number leaf).
 */
export function setAtPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  if (path.length === 0) {
    throw new SpecResolutionError('setAtPath: empty path');
  }
  const parts = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cursor[key];
    if (next === undefined || next === null) {
      const child: Record<string, unknown> = {};
      cursor[key] = child;
      cursor = child;
      continue;
    }
    if (typeof next !== 'object' || Array.isArray(next)) {
      throw new SpecResolutionError(
        `setAtPath: cannot descend into non-object at "${parts.slice(0, i + 1).join('.')}"`,
      );
    }
    cursor = next as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

/**
 * Deep-clone via JSON round-trip. Specs are pure JSON by contract
 * (Zod-validated), so this is correct and allocation-stable. Using
 * structuredClone would work too but pulls in browser-polyfill concerns
 * for older Node test runners.
 */
function cloneSpec(spec: Spec): Spec {
  return JSON.parse(JSON.stringify(spec)) as Spec;
}

/**
 * Resolve the effective spec for `specId` as of `pinDate`.
 *
 * `pinDate` semantics:
 *   - `Date` → use that moment (engagement created_at; price-protected).
 *   - `null` / `undefined` → use "now" (CRM what-if preview).
 *
 * Overrides applied in deterministic order: oldest `effective_from` first,
 * ties broken by `rule_path` ascending. If two rows target the same path,
 * the later one wins (consistent with "most recent edit takes effect").
 */
export async function resolveSpec(
  client: SpecResolverClient,
  specId: string,
  pinDate?: Date | null,
): Promise<EffectiveSpec> {
  const effectiveAt = (pinDate ?? new Date()).toISOString();

  const specRes = await client.query<SpecRow>(
    'SELECT id, spec_json, version FROM service_specs WHERE id = $1',
    [specId],
  );
  if (specRes.rows.length === 0) {
    throw new SpecResolutionError(`service_specs row ${specId} not found`);
  }
  const specRow = specRes.rows[0]!;

  const overridesRes = await client.query<OverrideRow>(
    // No spec_id filter yet (column not shipped). Once migration adds it,
    // append: `AND spec_id = $2` and pass specId as a second param.
    `SELECT rule_path, value, effective_from
       FROM rule_overrides
      WHERE effective_from <= $1
      ORDER BY effective_from ASC, rule_path ASC`,
    [effectiveAt],
  );

  const merged = cloneSpec(specRow.spec_json);
  for (const ov of overridesRes.rows) {
    setAtPath(merged as unknown as Record<string, unknown>, ov.rule_path, ov.value);
  }

  return {
    ...merged,
    spec_row_id: specRow.id,
    pin_date: effectiveAt,
    overrides_applied: overridesRes.rows.length,
  };
}
