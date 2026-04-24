/**
 * Outbox-depth health endpoint — architecture §5.2 line 699.
 *
 * Used by the external monitoring path (Cloudflare Worker cron, separate
 * infrastructure from Supabase / Vercel / Inngest). The Worker polls this
 * endpoint every 30 seconds; if `pending_stale_count > 100`, it fires an
 * SMS alert.
 *
 * "Stale" = pending for > 2 minutes. Fresh pending rows are normal
 * (drain cadence is 10s primary + 60s fallback = always under 2 min in
 * steady state). A rising stale count indicates both drain paths are
 * blocked.
 *
 * Protection: the endpoint is public in the sense that its URL is known
 * to the external Worker, but the response requires a shared-secret
 * header `x-monitor-secret`. The Worker sets it; unauthorized calls get
 * 401 and no data. The secret is `MONITOR_SECRET` in env.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: Request): Promise<NextResponse> {
  const provided = request.headers.get('x-monitor-secret');
  const expected = process.env.MONITOR_SECRET;

  if (!expected) {
    return NextResponse.json(
      { error: 'MONITOR_SECRET not configured on server' },
      { status: 503 },
    );
  }
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();

  const { count, error } = await supabaseAdmin
    .from('outbox')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lt('created_at', twoMinutesAgo);

  if (error) {
    return NextResponse.json(
      { error: `outbox query failed: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    pending_stale_count: count ?? 0,
    threshold_seconds: 120,
  });
}
