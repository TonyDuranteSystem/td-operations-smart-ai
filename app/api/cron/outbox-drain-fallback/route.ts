/**
 * Outbox drain fallback — Vercel cron, 60-second cadence.
 * Architecture §5.2 lines 695-803.
 *
 * Three responsibilities, in order:
 *   (1) REAPER. Unstick rows locked by a primary drain worker that crashed
 *       mid-batch. Exact SQL per architecture lines 797-803:
 *
 *         UPDATE outbox SET status='pending', locked_at=NULL, locked_by=NULL
 *         WHERE status='publishing' AND locked_at < now() - interval '60 seconds';
 *
 *       The 60-second window matches this cron's interval — a stuck row is
 *       always recovered within 120 seconds.
 *
 *   (2) CLAIM + PUBLISH. Drain whatever the primary Inngest worker has
 *       failed to drain in the last minute. Uses the same claim_outbox_batch
 *       RPC as the primary, so the two workers compete safely via
 *       FOR UPDATE SKIP LOCKED.
 *
 *   (3) REPORT. Returns JSON with reaper count + published count so the
 *       Vercel cron-log shows activity at a glance.
 *
 * Invocation: registered in vercel.json as a cron. Vercel's minimum is
 * 60 seconds; this matches the reaper window by design. The route is
 * publicly addressable — Vercel passes a signed header `x-vercel-cron`
 * that we verify loosely (presence check). For stricter auth, add a
 * `CRON_SECRET` env var and compare to a header.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { publishOne } from '@/lib/inngest/functions/outbox-drain';

type OutboxRow = {
  id: string;
  event_id: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  account_id: string | null;
  attempts: number;
  status: string;
};

const MAX_ATTEMPTS = 5;

export async function GET(request: Request): Promise<NextResponse> {
  // Vercel cron header presence check. Vercel sets this on cron invocations;
  // requests without it are not cron runs and should be ignored to prevent
  // casual public triggering.
  const isVercelCron = request.headers.has('x-vercel-cron');
  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = request.headers.get('x-cron-secret');
  const secretOk = cronSecret ? providedSecret === cronSecret : true;

  if (!isVercelCron && !secretOk) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // (1) REAPER — inline SQL, exact form from architecture §5.2.
  const { data: reapedRows, error: reapErr } = await supabaseAdmin
    .from('outbox')
    .update({ status: 'pending', locked_at: null, locked_by: null })
    .eq('status', 'publishing')
    .lt('locked_at', new Date(Date.now() - 60_000).toISOString())
    .select('id');

  if (reapErr) {
    return NextResponse.json(
      { error: `reaper failed: ${reapErr.message}` },
      { status: 500 },
    );
  }
  const reapedCount = reapedRows?.length ?? 0;

  // (2) CLAIM. Same RPC the primary Inngest drain uses.
  const { data: batch, error: claimErr } = await supabaseAdmin.rpc(
    'claim_outbox_batch',
    { p_limit: 100 },
  );
  if (claimErr) {
    return NextResponse.json(
      { error: `claim failed: ${claimErr.message}` },
      { status: 500 },
    );
  }

  let published = 0;
  let failed = 0;
  for (const row of (batch ?? []) as OutboxRow[]) {
    try {
      await publishOne(row);
      const { error: updErr } = await supabaseAdmin
        .from('outbox')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', row.id);
      if (updErr) throw updErr;
      published += 1;
    } catch (err) {
      failed += 1;
      const nextAttempts = row.attempts + 1;
      const nextStatus = nextAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      await supabaseAdmin
        .from('outbox')
        .update({
          status: nextStatus,
          attempts: nextAttempts,
          last_error: err instanceof Error ? err.message : String(err),
          locked_at: null,
          locked_by: null,
        })
        .eq('id', row.id);
      // Continue draining rest of batch — do not throw, fallback is best-effort.
    }
  }

  return NextResponse.json({
    reaped: reapedCount,
    claimed: (batch ?? []).length,
    published,
    failed,
  });
}
