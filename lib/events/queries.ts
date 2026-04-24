/**
 * Read-side queries for the `events` table — Stage 0 S0.6.
 *
 * The admin event inspector lives at `/admin/events`. It needs three
 * capabilities:
 *
 *   1. List events with filters (event_type, subject_type, subject_id)
 *      and cursor-style pagination (limit + offset ordered by created_at
 *      descending).
 *   2. Fetch a single event by id, for the detail view.
 *   3. Reconstruct the `caused_by` chain for a focal event — i.e. walk
 *      upstream (events that caused it) and downstream (events it caused).
 *
 * Architecture §5 invariant: `events.caused_by` is `uuid[]` — a row "was
 * caused by" the listed event ids. Upstream lookup = direct ANY() scan on
 * the focal event's caused_by array. Downstream lookup = `WHERE caused_by @>
 * ARRAY[focal_id]::uuid[]` (array-containment predicate, GIN-indexable).
 *
 * This module is a thin read layer over a minimal client interface — same
 * pattern as `SpecSeederClient` / `SpecResolverClient`. Tests use a hand
 * rolled double; the runtime pg Client satisfies the interface natively.
 */

export interface EventQueryClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowCount: number | null; rows: T[] }>;
}

export type EventRow = {
  id: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  account_id: string | null;
  actor_type: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
  caused_by: string[];
  idempotency_key: string | null;
  created_at: string;
};

export type ListEventsFilters = {
  event_type?: string;
  subject_type?: string;
  subject_id?: string;
  limit?: number;
  offset?: number;
};

/**
 * List events newest-first with optional filters. Pagination is offset
 * based; acceptable at S0 scale (events table is small). Switch to keyset
 * (WHERE created_at < $cursor) when row count exceeds ~10k.
 */
export async function listEvents(
  client: EventQueryClient,
  filters: ListEventsFilters = {},
): Promise<EventRow[]> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.event_type) {
    params.push(filters.event_type);
    clauses.push(`event_type = $${params.length}`);
  }
  if (filters.subject_type) {
    params.push(filters.subject_type);
    clauses.push(`subject_type = $${params.length}`);
  }
  if (filters.subject_id) {
    params.push(filters.subject_id);
    clauses.push(`subject_id = $${params.length}::uuid`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const sql =
    `SELECT id, event_type, subject_type, subject_id, account_id,
            actor_type, actor_id, payload, caused_by, idempotency_key,
            created_at
       FROM events
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

  const res = await client.query<EventRow>(sql, params);
  return res.rows;
}

/**
 * Fetch a single event by id. Returns null when no row matches; the caller
 * converts null to a 404 on the page.
 */
export async function getEvent(
  client: EventQueryClient,
  id: string,
): Promise<EventRow | null> {
  const res = await client.query<EventRow>(
    `SELECT id, event_type, subject_type, subject_id, account_id,
            actor_type, actor_id, payload, caused_by, idempotency_key,
            created_at
       FROM events
       WHERE id = $1::uuid
       LIMIT 1`,
    [id],
  );
  return res.rows[0] ?? null;
}

export type EventChain = {
  focal: EventRow;
  /** Events in focal.caused_by — the direct causes of the focal event. */
  ancestors: EventRow[];
  /** Events whose caused_by contains focal.id — the direct effects. */
  descendants: EventRow[];
};

/**
 * Fetch the direct one-hop causal neighbourhood of `focal`:
 *   - ancestors: events listed in focal.caused_by
 *   - descendants: events whose caused_by contains focal.id
 *
 * Multi-hop traversal is explicitly deferred. The UI walks hops by calling
 * this function with each neighbour as the new focal — one request per hop.
 * Keeps the query bounded and the indexing story simple (single GIN scan
 * per call). `caused_by` should have a GIN index for the descendants path
 * to stay fast at scale; unindexed is acceptable at S0 event volumes.
 */
export async function getEventChain(
  client: EventQueryClient,
  focal: EventRow,
): Promise<EventChain> {
  let ancestors: EventRow[] = [];
  if (focal.caused_by.length > 0) {
    const res = await client.query<EventRow>(
      `SELECT id, event_type, subject_type, subject_id, account_id,
              actor_type, actor_id, payload, caused_by, idempotency_key,
              created_at
         FROM events
         WHERE id = ANY($1::uuid[])
         ORDER BY created_at ASC`,
      [focal.caused_by],
    );
    ancestors = res.rows;
  }

  const descRes = await client.query<EventRow>(
    `SELECT id, event_type, subject_type, subject_id, account_id,
            actor_type, actor_id, payload, caused_by, idempotency_key,
            created_at
       FROM events
       WHERE caused_by @> ARRAY[$1]::uuid[]
       ORDER BY created_at ASC`,
    [focal.id],
  );

  return { focal, ancestors, descendants: descRes.rows };
}
