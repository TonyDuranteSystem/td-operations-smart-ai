/**
 * Workflow engine abstraction — architecture §17.4 Fix O.
 *
 * Every non-client file uses this module, never the Inngest SDK directly.
 * The abstraction exists so the workflow engine is swappable without
 * touching feature code: if Inngest is ever replaced (Temporal, homegrown,
 * anything), the surface area of change is this file plus
 * `lib/workflows/inngest-client.ts`.
 *
 * What is exported:
 *   - `workflows.trigger(name, data, opts?)` — fire-and-forget event send.
 *     Callers in `lib/events/emit.ts` and `lib/inngest/functions/outbox-drain.ts`
 *     use this after an event is durably recorded (outbox-backed). Callers
 *     MUST NOT use it for speculative sends — Inngest events are not atomic
 *     with DB state; use `withEmit()` for that.
 *   - `workflows.createFunction(...)` — thin pass-through to
 *     `inngest.createFunction(...)`. Re-exported so feature files never
 *     import `inngest` directly.
 *   - `workflows.client` — the underlying Inngest client, for
 *     advanced use cases (realtime subscriptions, raw `send`, etc.).
 *     Prefer `trigger()` when possible.
 */

import { inngest } from '@/lib/workflows/inngest-client';

type TriggerPayload = {
  id?: string;
  name: string;
  data: Record<string, unknown>;
};

export const workflows = {
  /**
   * Trigger a workflow event. The `id` field (optional) is the idempotency
   * key Inngest uses to deduplicate: the same id sent twice fires once.
   * Pass the event_id from `events` for per-event idempotency.
   */
  async trigger(payload: TriggerPayload): Promise<void> {
    await inngest.send({
      id: payload.id,
      name: payload.name,
      data: payload.data,
    });
  },

  /**
   * Create a workflow function. Thin re-export of `inngest.createFunction`.
   * Callers should accept the return value and add it to the registry in
   * `lib/inngest/index.ts`.
   */
  createFunction: inngest.createFunction.bind(inngest),

  /**
   * The underlying Inngest client. Use sparingly — prefer `trigger()`.
   * Exposed for advanced integration (e.g. publishing batches from the
   * outbox drain, which needs the `id` field for idempotency).
   */
  client: inngest,
};
