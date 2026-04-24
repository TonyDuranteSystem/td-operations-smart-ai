import { describe, expect, it, vi } from 'vitest';
import {
  resolveSpec,
  SpecResolutionError,
  setAtPath,
  type SpecResolverClient,
} from '@/lib/solver';
import { smllcFormation } from '@/lib/specs/smllc-formation';

/**
 * Unit tests for resolveSpec. The client is mocked at the interface level —
 * same pattern used by seed.test.ts — so these tests never touch pg/Supabase.
 *
 * The fixture is the real SMLLC spec (exported from lib/specs). Using the
 * real spec rather than a toy makes sure override-at-path works on the
 * shape the solver will actually see in production.
 */

const SPEC_ROW_ID = '40fed2c9-02fe-442a-9c7d-800eef711a98'; // sandbox-seeded row

type QueryCall = { sql: string; params: unknown[] };

function makeClient(
  specRows: Array<{ id: string; spec_json: unknown; version: number }>,
  overrideRows: Array<{ rule_path: string; value: unknown; effective_from: string }>,
): { client: SpecResolverClient; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client: SpecResolverClient = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      if (sql.includes('FROM service_specs')) {
        return { rowCount: specRows.length, rows: specRows };
      }
      if (sql.includes('FROM rule_overrides')) {
        return { rowCount: overrideRows.length, rows: overrideRows };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
  return { client, calls };
}

describe('setAtPath', () => {
  it('writes a leaf value at a single-key path', () => {
    const t: Record<string, unknown> = {};
    setAtPath(t, 'a', 1);
    expect(t).toEqual({ a: 1 });
  });

  it('creates intermediate objects as needed', () => {
    const t: Record<string, unknown> = {};
    setAtPath(t, 'pricing_rules.base_price_usd', 1199);
    expect(t).toEqual({ pricing_rules: { base_price_usd: 1199 } });
  });

  it('overwrites an existing leaf at the same path', () => {
    const t: Record<string, unknown> = { a: { b: 1 } };
    setAtPath(t, 'a.b', 2);
    expect(t).toEqual({ a: { b: 2 } });
  });

  it('preserves sibling keys when overwriting', () => {
    const t: Record<string, unknown> = { a: { b: 1, c: 2 } };
    setAtPath(t, 'a.b', 99);
    expect(t).toEqual({ a: { b: 99, c: 2 } });
  });

  it('refuses to descend into a primitive intermediate', () => {
    const t: Record<string, unknown> = { a: 1 };
    expect(() => setAtPath(t, 'a.b', 2)).toThrow(SpecResolutionError);
  });

  it('refuses an empty path', () => {
    expect(() => setAtPath({}, '', 1)).toThrow(SpecResolutionError);
  });
});

describe('resolveSpec', () => {
  it('returns the raw spec untouched when no overrides match the pin date', async () => {
    const { client } = makeClient(
      [{ id: SPEC_ROW_ID, spec_json: smllcFormation, version: 1 }],
      [],
    );
    const effective = await resolveSpec(client, SPEC_ROW_ID, new Date('2026-04-24T00:00:00Z'));
    expect(effective.overrides_applied).toBe(0);
    expect(effective.spec_row_id).toBe(SPEC_ROW_ID);
    expect(effective.contract_type).toBe('smllc_formation');
    expect(effective.version).toBe(1);
    // Raw pricing unchanged.
    expect(
      (effective.pricing_rules as { base_price_usd: number }).base_price_usd,
    ).toBe(999);
  });

  it('applies a pricing override when effective_from predates the pin_date', async () => {
    const { client } = makeClient(
      [{ id: SPEC_ROW_ID, spec_json: smllcFormation, version: 1 }],
      [
        {
          rule_path: 'pricing_rules.base_price_usd',
          value: 1199,
          effective_from: '2026-04-01T00:00:00Z',
        },
      ],
    );
    const effective = await resolveSpec(client, SPEC_ROW_ID, new Date('2026-04-24T00:00:00Z'));
    expect(effective.overrides_applied).toBe(1);
    expect(
      (effective.pricing_rules as { base_price_usd: number }).base_price_usd,
    ).toBe(1199);
  });

  it('excludes overrides whose effective_from is after the pin_date (Fix A price protection)', async () => {
    // Engagement created last month; override applied today. The pre-existing
    // engagement's contracted price must NOT see the new price.
    const { client, calls } = makeClient(
      [{ id: SPEC_ROW_ID, spec_json: smllcFormation, version: 1 }],
      [], // DB would return [] because WHERE effective_from <= pinDate filters the row out
    );
    const engagementCreatedAt = new Date('2026-03-15T00:00:00Z');
    const effective = await resolveSpec(client, SPEC_ROW_ID, engagementCreatedAt);
    expect(effective.overrides_applied).toBe(0);
    expect(
      (effective.pricing_rules as { base_price_usd: number }).base_price_usd,
    ).toBe(999);
    // Verify the pinDate was passed to the rule_overrides query.
    const overrideCall = calls.find(c => c.sql.includes('FROM rule_overrides'))!;
    expect(overrideCall.params[0]).toBe('2026-03-15T00:00:00.000Z');
  });

  it('defaults to now() when pinDate is null (CRM what-if preview)', async () => {
    const { client, calls } = makeClient(
      [{ id: SPEC_ROW_ID, spec_json: smllcFormation, version: 1 }],
      [],
    );
    const before = Date.now();
    await resolveSpec(client, SPEC_ROW_ID, null);
    const after = Date.now();
    const overrideCall = calls.find(c => c.sql.includes('FROM rule_overrides'))!;
    const passed = Date.parse(overrideCall.params[0] as string);
    expect(passed).toBeGreaterThanOrEqual(before);
    expect(passed).toBeLessThanOrEqual(after);
  });

  it('applies multiple overrides in deterministic order; later rows win on same path', async () => {
    const { client } = makeClient(
      [{ id: SPEC_ROW_ID, spec_json: smllcFormation, version: 1 }],
      [
        {
          rule_path: 'pricing_rules.base_price_usd',
          value: 1099,
          effective_from: '2026-04-01T00:00:00Z',
        },
        {
          rule_path: 'pricing_rules.base_price_usd',
          value: 1199,
          effective_from: '2026-04-15T00:00:00Z',
        },
        {
          rule_path: 'pricing_rules.by_state.Wyoming.filing_fee',
          value: 120,
          effective_from: '2026-04-10T00:00:00Z',
        },
      ],
    );
    const effective = await resolveSpec(client, SPEC_ROW_ID, new Date('2026-04-24T00:00:00Z'));
    expect(effective.overrides_applied).toBe(3);
    expect(
      (effective.pricing_rules as { base_price_usd: number }).base_price_usd,
    ).toBe(1199); // later row wins
    expect(
      (
        effective.pricing_rules as {
          by_state: { Wyoming: { filing_fee: number } };
        }
      ).by_state.Wyoming.filing_fee,
    ).toBe(120);
    // Untouched siblings survive.
    expect(
      (
        effective.pricing_rules as {
          by_state: { Florida: { filing_fee: number } };
        }
      ).by_state.Florida.filing_fee,
    ).toBe(125);
  });

  it('does not mutate the spec_json returned by the DB (deep clone)', async () => {
    const specJson = JSON.parse(JSON.stringify(smllcFormation));
    const { client } = makeClient(
      [{ id: SPEC_ROW_ID, spec_json: specJson, version: 1 }],
      [
        {
          rule_path: 'pricing_rules.base_price_usd',
          value: 1199,
          effective_from: '2026-04-01T00:00:00Z',
        },
      ],
    );
    await resolveSpec(client, SPEC_ROW_ID, new Date('2026-04-24T00:00:00Z'));
    expect(
      (specJson.pricing_rules as { base_price_usd: number }).base_price_usd,
    ).toBe(999);
  });

  it('throws SpecResolutionError when the spec row does not exist', async () => {
    const { client } = makeClient([], []);
    await expect(
      resolveSpec(client, 'does-not-exist', new Date()),
    ).rejects.toBeInstanceOf(SpecResolutionError);
  });
});
