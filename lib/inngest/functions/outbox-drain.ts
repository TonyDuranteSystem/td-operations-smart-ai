/**
 * Outbox drain — architecture §5.2, lines 703-762.
 *
 * Primary drain. Runs on Inngest with the architecture-specified schedule
 * (every 10 seconds). Fallback drain is in
 * `app/api/cron/outbox-drain-fallback/route.ts` (Vercel cron, 60s, with
 * reaper). Tertiary monitor (Cloudflare Worker polling
 * `/api/health/outbox-depth`) lives outside this repo — deferred.
 *
 * Invariants:
 *   - Fix 3/Round 4: inject `engagement_id` into the Inngest data envelope
 *     whenever `subject_type === 'engagement'`. Consumers'
 *     `step.waitForEvent(match: 'data.engagement_id')` depends on it;
 *     without, the match never resolves (or resolves against an unrelated
 *     engagement if the consumer was laxer).
 *   - Fix 3/Round 4 (cont.): inject `account_id` too. Account-scoped
 *     correlation (CRM account 360 view) needs it.
 *   - Fix 5/Round 4: publish to the PER-ENGAGEMENT Realtime channel and
 *     PER-ACCOUNT channel where applicable, plus a minimal admin
 *     broadcast. A global 'events' channel would leak cross-tenant data.
 *   - `concurrency: 1` on the function: two drains running simultaneously
 *     with `FOR UPDATE SKIP LOCKED` already prevents double-publish, but
 *     sequential execution keeps outbox processing in strict arrival order
 *     per worker instance — cheaper to reason about than interleaved.
 *
 * `workflows.client` is the underlying Inngest SDK client, which we use
 * directly here because `workflows.trigger()` does not surface the `id`
 * field cleanly when we need per-event idempotency. Architecture §17.4
 * accepts this exception for the drain specifically.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { workflows } from '@/lib/workflows/engine';

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

export const outboxDrain = workflows.createFunction(
  {
    id: 'outbox-drain',
    concurrency: { limit: 1 },
  },
  // Architecture §5.2 target cadence was 10s (`'*/10 * * * * *'`), but
  // Inngest Cloud only accepts 5-field cron (1-minute minimum) and rejected
  // the 6-field form at app-sync time (2026-04-24). Dropped to 1-minute
  // here; the low-latency path is the Realtime-triggered drain per §5.2.
  // Correctness comes from the outbox itself (append-only + idempotent
  // publish), not from the tick rate.
  { cron: '* * * * *' },
  async ({ step }) => {
    const batch = await step.run('claim-batch', async () => {
      const { data, error } = await supabaseAdmin.rpc('claim_outbox_batch', {
        p_limit: 100,
      });
      if (error) throw error;
      return (data ?? []) as OutboxRow[];
    });

    for (const row of batch) {
      // One Inngest step per row — each step is its own atomic unit and
      // Inngest checkpoints between them. If publish fails, only this row
      // retries; previously-published rows stay published.
      await step.run(`publish-${row.id}`, async () => {
        try {
          await publishOne(row);
          const { error: updErr } = await supabaseAdmin
            .from('outbox')
            .update({ status: 'published', published_at: new Date().toISOString() })
            .eq('id', row.id);
          if (updErr) throw updErr;
        } catch (err) {
          const nextAttempts = row.attempts + 1;
          const nextStatus = nextAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
          const errMessage = err instanceof Error ? err.message : String(err);
          await supabaseAdmin
            .from('outbox')
            .update({
              status: nextStatus,
              attempts: nextAttempts,
              last_error: errMessage,
              locked_at: null,
              locked_by: null,
            })
            .eq('id', row.id);
          // Rethrow so Inngest records the step as failed and retries
          // per its own policy. The row status above governs eligibility
          // for the next claim.
          throw err;
        }
      });
    }
  },
);

/**
 * Exported for the Vercel fallback cron — same logic, no Inngest `step`.
 */
export async function publishOne(row: OutboxRow): Promise<void> {
  // Fix 3/Round 4: inject engagement_id + account_id into the data envelope
  // so downstream Inngest functions can match on them.
  const payload = await fetchEventPayload(row.event_id);
  const inngestData: Record<string, unknown> = {
    ...payload,
    ...(row.subject_type === 'engagement' ? { engagement_id: row.subject_id } : {}),
    account_id: row.account_id,
  };

  // Idempotency on Inngest side: id = event_id, so a retried drain step
  // sending the same event dedupes on Inngest's side too.
  await workflows.client.send({
    id: row.event_id,
    name: row.event_type,
    data: inngestData,
  });

  // Fix 5/Round 4: scoped Realtime channels. Per-engagement, per-account,
  // admin broadcast (minimal, no PII).
  if (row.subject_type === 'engagement') {
    await supabaseAdmin
      .channel(`engagement:${row.subject_id}`)
      .send({
        type: 'broadcast',
        event: row.event_type,
        payload: { event_id: row.event_id, event_type: row.event_type, subject_id: row.subject_id },
      });
  }
  if (row.account_id) {
    await supabaseAdmin
      .channel(`account:${row.account_id}`)
      .send({
        type: 'broadcast',
        event: row.event_type,
        payload: { event_id: row.event_id, event_type: row.event_type, account_id: row.account_id },
      });
  }
  await supabaseAdmin
    .channel('admin:broadcast')
    .send({
      type: 'broadcast',
      event: row.event_type,
      payload: {
        event_id: row.event_id,
        event_type: row.event_type,
        account_id: row.account_id,
      },
    });
}

/**
 * Drain needs the payload to embed in the Inngest data envelope. We could
 * denormalize payload onto outbox, but that doubles storage and invites
 * skew between events.payload and outbox.payload. One extra SELECT per
 * drained row is acceptable for Stage 0 throughput.
 */
async function fetchEventPayload(eventId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('payload')
    .eq('id', eventId)
    .single();
  if (error) throw error;
  return (data?.payload ?? {}) as Record<string, unknown>;
}
