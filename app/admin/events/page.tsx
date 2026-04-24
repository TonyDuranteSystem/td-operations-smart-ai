import Link from 'next/link';
import { listEvents, type EventRow, type ListEventsFilters } from '@/lib/events/queries';
import { getPgPool } from '@/lib/db/pg-pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RawSearchParams = Record<string, string | string[] | undefined>;

function parseFilters(sp: RawSearchParams): ListEventsFilters {
  const take = (k: string) => {
    const v = sp[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const limit = Number.parseInt((sp.limit as string) ?? '50', 10);
  const offset = Number.parseInt((sp.offset as string) ?? '0', 10);
  return {
    event_type: take('event_type'),
    subject_type: take('subject_type'),
    subject_id: take('subject_id'),
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
  };
}

async function loadEvents(filters: ListEventsFilters): Promise<{ rows: EventRow[]; error: string | null }> {
  try {
    const pool = getPgPool();
    const rows = await listEvents(pool, filters);
    return { rows, error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function buildQueryString(filters: ListEventsFilters, overrides: Partial<ListEventsFilters>): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.event_type) params.set('event_type', merged.event_type);
  if (merged.subject_type) params.set('subject_type', merged.subject_type);
  if (merged.subject_id) params.set('subject_id', merged.subject_id);
  if (merged.limit !== undefined) params.set('limit', String(merged.limit));
  if (merged.offset !== undefined) params.set('offset', String(merged.offset));
  return params.toString();
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const { rows, error } = await loadEvents(filters);

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const nextOffset = offset + limit;
  const prevOffset = Math.max(offset - limit, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Event inspector</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Append-only event log. Filters are applied server-side. Click a row to open the
          detail view with its causal chain.
        </p>
      </header>

      <form
        method="get"
        action="/admin/events"
        className="grid grid-cols-1 gap-3 rounded-md border border-zinc-200 bg-white p-4 md:grid-cols-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700">Event type</span>
          <input
            type="text"
            name="event_type"
            defaultValue={filters.event_type ?? ''}
            placeholder="payment.confirmed"
            className="rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700">Subject type</span>
          <input
            type="text"
            name="subject_type"
            defaultValue={filters.subject_type ?? ''}
            placeholder="engagement"
            className="rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700">Subject id</span>
          <input
            type="text"
            name="subject_id"
            defaultValue={filters.subject_id ?? ''}
            placeholder="uuid"
            className="rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700">Limit</span>
          <input
            type="number"
            name="limit"
            min={1}
            max={500}
            defaultValue={limit}
            className="rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <div className="md:col-span-4 flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Apply
          </button>
          <Link
            href="/admin/events"
            className="text-sm text-zinc-500 hover:text-zinc-700"
          >
            Reset
          </Link>
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">Query failed</div>
          <div className="mt-1 font-mono text-xs break-all">{error}</div>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Created</th>
              <th className="px-4 py-2 font-semibold">Event type</th>
              <th className="px-4 py-2 font-semibold">Subject</th>
              <th className="px-4 py-2 font-semibold">Actor</th>
              <th className="px-4 py-2 font-semibold">Caused by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                  No events match these filters.
                </td>
              </tr>
            )}
            {rows.map(row => (
              <tr key={row.id} className="hover:bg-zinc-50">
                <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                  {row.created_at.replace('T', ' ').slice(0, 19)}
                </td>
                <td className="px-4 py-2">
                  <Link
                    href={`/admin/events/${row.id}`}
                    className="font-medium text-zinc-900 hover:underline"
                  >
                    {row.event_type}
                  </Link>
                </td>
                <td className="px-4 py-2 text-zinc-700">
                  <div>{row.subject_type}</div>
                  <div className="font-mono text-xs text-zinc-500">{row.subject_id}</div>
                </td>
                <td className="px-4 py-2 text-zinc-700">
                  <div>{row.actor_type}</div>
                  {row.actor_id && (
                    <div className="font-mono text-xs text-zinc-500">{row.actor_id}</div>
                  )}
                </td>
                <td className="px-4 py-2 text-zinc-500">
                  {row.caused_by.length === 0 ? '—' : `${row.caused_by.length} event(s)`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <div>
          Showing rows {offset + 1}–{offset + rows.length} · page size {limit}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/admin/events?${buildQueryString(filters, { offset: prevOffset })}`}
            aria-disabled={offset === 0}
            className={
              'rounded border border-zinc-300 px-3 py-1 ' +
              (offset === 0
                ? 'pointer-events-none text-zinc-300'
                : 'hover:bg-zinc-50')
            }
          >
            ← Previous
          </Link>
          <Link
            href={`/admin/events?${buildQueryString(filters, { offset: nextOffset })}`}
            aria-disabled={rows.length < limit}
            className={
              'rounded border border-zinc-300 px-3 py-1 ' +
              (rows.length < limit
                ? 'pointer-events-none text-zinc-300'
                : 'hover:bg-zinc-50')
            }
          >
            Next →
          </Link>
        </div>
      </div>
    </div>
  );
}
