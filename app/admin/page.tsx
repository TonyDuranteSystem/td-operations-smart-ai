import Link from 'next/link';

export const runtime = 'nodejs';

export default function AdminHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Internal tooling for Stage 0. Expand as new surfaces land.
        </p>
      </div>
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-md border border-zinc-200 bg-white">
        <li>
          <Link
            href="/admin/events"
            className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50"
          >
            <div>
              <div className="font-medium">Event inspector</div>
              <div className="text-sm text-zinc-500">
                Browse the append-only event log; follow the caused_by chain.
              </div>
            </div>
            <span className="text-zinc-400">→</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
