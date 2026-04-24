import { describe, expect, it, vi } from 'vitest';
import {
  getEvent,
  getEventChain,
  listEvents,
  type EventQueryClient,
  type EventRow,
} from '@/lib/events/queries';

/**
 * Unit tests for the event read queries. Uses a hand-rolled client double
 * (same pattern as seed.test.ts / resolve-spec.test.ts) so no DB or
 * Supabase wiring is needed.
 */

type Call = { sql: string; params: unknown[] };

function makeClient(
  rowsByPredicate: (sql: string, params: unknown[]) => EventRow[] | null,
): { client: EventQueryClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: EventQueryClient = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const p = params ?? [];
      calls.push({ sql, params: p });
      const rows = rowsByPredicate(sql, p) ?? [];
      return { rowCount: rows.length, rows };
    }),
  };
  return { client, calls };
}

function mkRow(overrides: Partial<EventRow> & Pick<EventRow, 'id'>): EventRow {
  return {
    event_type: 'payment.confirmed',
    subject_type: 'engagement',
    subject_id: '00000000-0000-4000-8000-000000000001',
    account_id: null,
    actor_type: 'webhook',
    actor_id: null,
    payload: {},
    caused_by: [],
    idempotency_key: null,
    created_at: '2026-04-24T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('listEvents', () => {
  it('issues a bare SELECT with no WHERE when no filters are provided', async () => {
    const { client, calls } = makeClient(() => [mkRow({ id: 'a' })]);
    const rows = await listEvents(client);
    expect(rows).toHaveLength(1);
    const { sql, params } = calls[0]!;
    expect(sql).toMatch(/FROM events/);
    expect(sql).not.toMatch(/WHERE/);
    // limit, offset appended — default 50/0.
    expect(params[params.length - 2]).toBe(50);
    expect(params[params.length - 1]).toBe(0);
  });

  it('appends filter clauses and positional params for each provided filter', async () => {
    const { client, calls } = makeClient(() => []);
    await listEvents(client, {
      event_type: 'payment.confirmed',
      subject_type: 'engagement',
      subject_id: 'abc',
      limit: 10,
      offset: 20,
    });
    const { sql, params } = calls[0]!;
    expect(sql).toMatch(/WHERE event_type = \$1 AND subject_type = \$2 AND subject_id = \$3::uuid/);
    expect(params).toEqual(['payment.confirmed', 'engagement', 'abc', 10, 20]);
  });

  it('clamps limit to [1, 500] and offset to >= 0', async () => {
    const { client, calls } = makeClient(() => []);
    await listEvents(client, { limit: 99999, offset: -10 });
    const { params } = calls[0]!;
    expect(params[params.length - 2]).toBe(500);
    expect(params[params.length - 1]).toBe(0);

    await listEvents(client, { limit: 0 });
    const { params: p2 } = calls[1]!;
    expect(p2[p2.length - 2]).toBe(1);
  });

  it('orders newest first (created_at DESC, id DESC)', async () => {
    const { client, calls } = makeClient(() => []);
    await listEvents(client);
    expect(calls[0]!.sql).toMatch(/ORDER BY created_at DESC, id DESC/);
  });
});

describe('getEvent', () => {
  it('returns the matching row', async () => {
    const { client } = makeClient(() => [mkRow({ id: 'x' })]);
    const row = await getEvent(client, 'x');
    expect(row?.id).toBe('x');
  });

  it('returns null when no row matches', async () => {
    const { client } = makeClient(() => []);
    const row = await getEvent(client, 'nope');
    expect(row).toBeNull();
  });

  it('passes the id as a uuid-cast param', async () => {
    const { client, calls } = makeClient(() => []);
    await getEvent(client, 'some-id');
    expect(calls[0]!.sql).toMatch(/WHERE id = \$1::uuid/);
    expect(calls[0]!.params).toEqual(['some-id']);
  });
});

describe('getEventChain', () => {
  it('fetches only descendants when focal has an empty caused_by', async () => {
    const focal = mkRow({ id: 'focal', caused_by: [] });
    const { client, calls } = makeClient((sql: string) =>
      sql.includes('caused_by @>') ? [mkRow({ id: 'desc-1' })] : [],
    );
    const chain = await getEventChain(client, focal);
    expect(chain.focal.id).toBe('focal');
    expect(chain.ancestors).toEqual([]);
    expect(chain.descendants.map(r => r.id)).toEqual(['desc-1']);
    // Exactly one query issued (descendants only).
    expect(calls).toHaveLength(1);
  });

  it('fetches ancestors from caused_by when non-empty', async () => {
    const focal = mkRow({ id: 'focal', caused_by: ['anc-1', 'anc-2'] });
    const { client, calls } = makeClient((sql: string, params: unknown[]) => {
      if (sql.includes('= ANY')) {
        return (params[0] as string[]).map(id => mkRow({ id }));
      }
      return [];
    });
    const chain = await getEventChain(client, focal);
    expect(chain.ancestors.map(r => r.id).sort()).toEqual(['anc-1', 'anc-2']);
    expect(chain.descendants).toEqual([]);
    expect(calls).toHaveLength(2); // ancestors + descendants
  });

  it('queries descendants via array-containment on caused_by', async () => {
    const focal = mkRow({ id: 'focal' });
    const { client, calls } = makeClient(() => []);
    await getEventChain(client, focal);
    const descCall = calls.find(c => c.sql.includes('caused_by @>'))!;
    expect(descCall.sql).toMatch(/caused_by @> ARRAY\[\$1\]::uuid\[\]/);
    expect(descCall.params).toEqual(['focal']);
  });
});
