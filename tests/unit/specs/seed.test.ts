import { describe, expect, it, vi } from 'vitest';
import { seedSpecs, type SpecSeederClient } from '@/lib/specs/seed';
import { defineSpec, ReqGate, ReqData, type Spec } from '@/lib/specs/types';

/**
 * Seed-mechanism unit tests. Uses a hand-rolled client double matching the
 * `SpecSeederClient` interface. Tracking calls + returning tuned rowCount
 * values lets us assert exactly how `seedSpecs` maps RETURNING results to
 * the inserted / skipped buckets.
 */

function makeSpec(contractType: string, version: number): Spec {
  return defineSpec({
    contract_type: contractType,
    display_name: `${contractType} v${version}`,
    version,
    requirements: [
      ReqGate({
        key: 'payment_gate',
        blocks: ['*'],
        condition: { event_type: 'payment.confirmed' },
      }),
      ReqData({
        key: 'name',
        condition: { field: 'account.company_name', not_null: true },
      }),
    ],
  });
}

function createMockClient(rowCountSequence: number[]): {
  client: SpecSeederClient;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const client: SpecSeederClient = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      const rowCount = rowCountSequence[i] ?? 0;
      i++;
      return {
        rowCount,
        rows: rowCount > 0 ? [{ id: `row-${i}` }] : [],
      };
    }),
  };
  return { client, calls };
}

describe('seedSpecs', () => {
  it('inserts a new spec on first call', async () => {
    const spec = makeSpec('test_a', 1);
    const { client, calls } = createMockClient([1]);
    const out = await seedSpecs(client, [spec]);
    expect(out.inserted).toEqual(['test_a@1']);
    expect(out.skipped).toEqual([]);
    expect(calls).toHaveLength(1);
    // Must be parameterised insert; no interpolation of user data into SQL.
    expect(calls[0]!.sql).toMatch(/INSERT INTO service_specs/);
    expect(calls[0]!.sql).toMatch(/ON CONFLICT \(contract_type, version\) DO NOTHING/);
    expect(calls[0]!.params[0]).toBe('test_a');
    expect(calls[0]!.params[1]).toBe(1);
  });

  it('skips when the row already exists (rowCount=0 from ON CONFLICT DO NOTHING)', async () => {
    const spec = makeSpec('test_a', 1);
    const { client } = createMockClient([0]);
    const out = await seedSpecs(client, [spec]);
    expect(out.inserted).toEqual([]);
    expect(out.skipped).toEqual(['test_a@1']);
  });

  it('inserts a bumped version alongside an existing version', async () => {
    const v1 = makeSpec('test_a', 1);
    const v2 = makeSpec('test_a', 2);
    // v1 already seeded earlier → skipped; v2 new → inserted.
    const { client } = createMockClient([0, 1]);
    const out = await seedSpecs(client, [v1, v2]);
    expect(out.skipped).toEqual(['test_a@1']);
    expect(out.inserted).toEqual(['test_a@2']);
  });

  it('serializes the whole spec into the third parameter (spec_json)', async () => {
    const spec = makeSpec('test_b', 1);
    const { client, calls } = createMockClient([1]);
    await seedSpecs(client, [spec]);
    const serialized = calls[0]!.params[2] as string;
    const parsed = JSON.parse(serialized) as Spec;
    expect(parsed.contract_type).toBe('test_b');
    expect(parsed.requirements).toHaveLength(2);
    expect(parsed.requirements[0]!.key).toBe('payment_gate');
  });

  it('processes specs in the order given', async () => {
    const a = makeSpec('a', 1);
    const b = makeSpec('b', 1);
    const c = makeSpec('c', 1);
    const { client, calls } = createMockClient([1, 1, 1]);
    const out = await seedSpecs(client, [a, b, c]);
    expect(out.inserted).toEqual(['a@1', 'b@1', 'c@1']);
    expect(calls.map(c => c.params[0])).toEqual(['a', 'b', 'c']);
  });
});
