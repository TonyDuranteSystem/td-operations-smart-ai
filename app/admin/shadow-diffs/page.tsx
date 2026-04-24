import Link from 'next/link';
import { getPgPool } from '@/lib/db/pg-pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DiffRow = {
  id: string;
  v1_account_id: string;
  engagement_id: string | null;
  diff_category: string;
  v1_status_report: Record<string, unknown> | null;
  smart_ai_status_report: Record<string, unknown> | null;
  diff_detail: Record<string, unknown> | null;
  triage_notes: string | null;
  triaged_at: string | null;
  created_at: string;
};

const CATEGORY_BADGE: Record<string, string> = {
  match_complete:        'bg-green-100 text-green-800',
  match_incomplete:      'bg-zinc-100 text-zinc-700',
  solver_under_satisfied: 'bg-red-100 text-red-800',
  solver_over_satisfied:  'bg-amber-100 text-amber-800',
  no_spec:               'bg-blue-100 text-blue-700',
  unknown:               'bg-purple-100 text-purple-800',
};

async function loadDiffs(): Promise<{ rows: DiffRow[]; error: string | null }> {
  try {
    const pool = getPgPool();
    const res = await pool.query<DiffRow>(
      `SELECT id, v1_account_id, engagement_id, diff_category,
              v1_status_report, smart_ai_status_report, diff_detail,
              triage_notes, triaged_at, created_at
       FROM shadow_diffs
       ORDER BY diff_category, created_at DESC
       LIMIT 200`
    );
    return { rows: res.rows, error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_BADGE[category] ?? 'bg-zinc-100 text-zinc-700';
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {category}
    </span>
  );
}

function progress(report: Record<string, unknown> | null): string {
  if (!report) return '—';
  const p = (report as { overall_progress?: number }).overall_progress;
  if (typeof p !== 'number') return '—';
  return `${Math.round(p * 100)}%`;
}

export default async function ShadowDiffsPage() {
  const { rows, error } = await loadDiffs();

  const byCategory = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.diff_category] = (acc[r.diff_category] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Shadow diffs — S0.8 panel</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Solver output vs v1 observable state for the 30-client exit-gate panel.
          Run <code className="font-mono text-xs bg-zinc-100 px-1 rounded">npx tsx scripts/s0.8-run-panel.ts</code> to populate.
        </p>
      </header>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(byCategory).map(([cat, n]) => (
          <span key={cat} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${CATEGORY_BADGE[cat] ?? 'bg-zinc-100 text-zinc-700'}`}>
            {cat} <span className="font-bold">{n}</span>
          </span>
        ))}
        {rows.length === 0 && !error && (
          <span className="text-sm text-zinc-500">No diffs yet — run the panel script first.</span>
        )}
      </div>

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
              <th className="px-4 py-2 font-semibold">Company (v1)</th>
              <th className="px-4 py-2 font-semibold">Entity</th>
              <th className="px-4 py-2 font-semibold">Category</th>
              <th className="px-4 py-2 font-semibold">Progress</th>
              <th className="px-4 py-2 font-semibold">Missing / Blocked</th>
              <th className="px-4 py-2 font-semibold">V1 status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  No rows — run <code className="font-mono text-xs">npx tsx scripts/s0.8-run-panel.ts</code>
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const v1 = row.v1_status_report ?? {};
              const detail = row.diff_detail ?? {};
              const missing = ((detail as { missing?: string[] }).missing ?? []).join(', ') || '—';
              const blocked = ((detail as { blocked?: string[] }).blocked ?? []).join(', ') || '—';
              return (
                <tr key={row.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-2">
                    <div className="font-medium text-zinc-900">
                      {String(v1['company_name'] ?? row.v1_account_id.slice(0, 8) + '…')}
                    </div>
                    <div className="font-mono text-xs text-zinc-400">{row.v1_account_id.slice(0, 8)}</div>
                  </td>
                  <td className="px-4 py-2 text-zinc-600 text-xs">
                    {String(v1['entity_type'] ?? '—')}
                  </td>
                  <td className="px-4 py-2">
                    <CategoryBadge category={row.diff_category} />
                  </td>
                  <td className="px-4 py-2 text-zinc-700 font-mono text-xs">
                    {progress(row.smart_ai_status_report)}
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-600">
                    <div className="text-red-700">M: {missing}</div>
                    <div className="text-amber-700">B: {blocked}</div>
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-600">
                    {String(v1['status'] ?? '—')}
                    {v1['has_paid_payment'] ? ' · paid' : ' · unpaid'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-zinc-400">
        {rows.length} rows · <Link href="/admin" className="hover:underline">← Admin</Link>
      </div>
    </div>
  );
}
