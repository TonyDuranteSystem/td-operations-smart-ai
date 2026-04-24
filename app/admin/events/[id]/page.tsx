import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEvent, getEventChain, type EventRow } from '@/lib/events/queries';
import { getPgPool } from '@/lib/db/pg-pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LoadResult =
  | { status: 'ok'; focal: EventRow; ancestors: EventRow[]; descendants: EventRow[] }
  | { status: 'error'; error: string };

async function load(id: string): Promise<LoadResult | null> {
  try {
    const pool = getPgPool();
    const focal = await getEvent(pool, id);
    if (!focal) return null;
    const chain = await getEventChain(pool, focal);
    return {
      status: 'ok',
      focal,
      ancestors: chain.ancestors,
      descendants: chain.descendants,
    };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

function formatPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, null, 2);
}

function EventSummary({ row, heading }: { row: EventRow; heading: string }) {
  return (
    <Link
      href={`/admin/events/${row.id}`}
      className="block rounded-md border border-zinc-200 bg-white p-3 hover:bg-zinc-50"
    >
      <div className="text-xs uppercase tracking-wide text-zinc-500">{heading}</div>
      <div className="mt-1 font-medium text-zinc-900">{row.event_type}</div>
      <div className="mt-1 font-mono text-xs text-zinc-500">{row.id}</div>
      <div className="mt-1 text-xs text-zinc-500">
        {row.created_at.replace('T', ' ').slice(0, 19)}
      </div>
    </Link>
  );
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await load(id);

  if (result === null) notFound();

  if (result.status === 'error') {
    return (
      <div className="space-y-6">
        <Link href="/admin/events" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← Back to events
        </Link>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">Query failed</div>
          <div className="mt-1 font-mono text-xs break-all">{result.error}</div>
        </div>
      </div>
    );
  }

  const { focal, ancestors, descendants } = result;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/events" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← Back to events
        </Link>
      </div>

      <header className="rounded-md border border-zinc-200 bg-white p-6">
        <div className="text-xs uppercase tracking-wide text-zinc-500">Event</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{focal.event_type}</h1>
        <div className="mt-2 font-mono text-xs text-zinc-500">{focal.id}</div>

        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Subject</dt>
            <dd className="mt-0.5 text-zinc-900">{focal.subject_type}</dd>
            <dd className="font-mono text-xs text-zinc-500">{focal.subject_id}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Actor</dt>
            <dd className="mt-0.5 text-zinc-900">{focal.actor_type}</dd>
            {focal.actor_id && (
              <dd className="font-mono text-xs text-zinc-500">{focal.actor_id}</dd>
            )}
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Account</dt>
            <dd className="mt-0.5 font-mono text-xs text-zinc-500">
              {focal.account_id ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Idempotency key</dt>
            <dd className="mt-0.5 font-mono text-xs text-zinc-500">
              {focal.idempotency_key ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Created</dt>
            <dd className="mt-0.5 text-zinc-900">
              {focal.created_at.replace('T', ' ').slice(0, 19)}
            </dd>
          </div>
        </dl>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Payload</h2>
        <pre className="overflow-auto rounded-md border border-zinc-200 bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100">
          {formatPayload(focal.payload)}
        </pre>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Causal chain</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-zinc-700">
              Ancestors ({ancestors.length})
              <span className="ml-1 font-normal text-zinc-400">— events that caused this one</span>
            </h3>
            {ancestors.length === 0 ? (
              <div className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-500">
                None — root event.
              </div>
            ) : (
              ancestors.map(row => (
                <EventSummary key={row.id} row={row} heading="Ancestor" />
              ))
            )}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-zinc-700">
              Descendants ({descendants.length})
              <span className="ml-1 font-normal text-zinc-400">— events this one caused</span>
            </h3>
            {descendants.length === 0 ? (
              <div className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-500">
                None — no downstream events yet.
              </div>
            ) : (
              descendants.map(row => (
                <EventSummary key={row.id} row={row} heading="Descendant" />
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
