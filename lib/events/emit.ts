/**
 * withEmit() — the single event-log write path. Architecture §5.4 v1.5.
 *
 * This module is the ONLY place in the Smart AI codebase allowed to invoke
 * `supabaseAdmin.rpc('emit_event_atomic', ...)`, and the ONLY place that
 * writes to the `events` or `outbox` tables. Direct writes elsewhere are
 * blocked by the ESLint `no-restricted-syntax` rule in `.eslintrc.json`.
 *
 * Why single-surface:
 *  - PII scrubbing (scrub-pii.ts) runs inside this function. A second write
 *    path would skip the scrubber and leak free-form PII into events.
 *  - Zod validation runs here before any RPC. A malformed payload never
 *    reaches the DB.
 *  - Idempotency-key enforcement for non-human actors runs here. Bypassing
 *    this function would let a retried webhook double-emit.
 *  - The CI assertion `scripts/assert-entity-table-sync.ts` compares the
 *    SupportedEntityTable union (below) against the plpgsql ELSIF ladder
 *    in `emit_event_atomic`. Adding a branch in one place without the other
 *    fails the build.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { eventSchemas, isKnownEventType } from '@/lib/events/schemas';
import { scrubPayloadForPII } from '@/lib/events/scrub-pii';
import { requiresIdempotencyKey, type ActorType } from '@/lib/events/types';

// ---------------------------------------------------------------------------
// SupportedEntityTable — MUST match the IF/ELSIF ladder in
// emit_event_atomic() exactly. See supabase/migrations/003_event_subsystem.sql
// (lines 147-175). `scripts/assert-entity-table-sync.ts` enforces parity; the
// build fails on divergence.
//
// Adding a new table requires:
//   (1) ELSIF branch + field whitelist in the plpgsql function,
//   (2) this union extended to include the new table literal,
//   (3) `npm run assert:entity-table-sync` passes.
// All three in the SAME commit — otherwise either the function RAISES on
// valid TS input, or the TS types permit a string the function rejects.
// ---------------------------------------------------------------------------

export type SupportedEntityTable = 'engagements' | 'exceptions';

export type EntityWrite = {
  table: SupportedEntityTable;
  pk: string;
  update: Record<string, unknown>;
};

export type EmitInput = {
  entityWrite?: EntityWrite;
  event_type: string;
  actor_type: ActorType;
  actor_id?: string;
  subject_type: string;
  subject_id: string;
  account_id?: string;
  payload: unknown;
  /**
   * REQUIRED when `actor_type` is one of {'webhook','cron','agent','migration'}.
   * Enforced at runtime below; the typed factories in
   * `lib/events/idempotency-keys.ts` make correct usage ergonomic.
   */
  idempotency_key?: string;
  caused_by?: string[];
};

export class EmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmitError';
  }
}

/**
 * The ONLY way to emit an event in Smart AI.
 *
 * Execution path:
 *  (1) Validate shape + unknown-event-type rejection (Zod lookup).
 *  (2) Enforce idempotency-key requirement for non-human actors.
 *  (3) Zod `.parse()` on the payload against the event-type schema.
 *  (4) PII scrub (writes any detections to `sensitive_data`).
 *  (5) ONE rpc('emit_event_atomic', ...) — server-side transaction:
 *      idempotency check → entity UPDATE (whitelisted) → events INSERT
 *      (ON CONFLICT DO NOTHING) → outbox INSERT (ON CONFLICT DO NOTHING).
 *  (6) Return the event_id.
 *
 * Returns the event_id. Duplicate emits with the same idempotency_key
 * return the FIRST event's id — never a new one.
 */
export async function withEmit(input: EmitInput): Promise<string> {
  // (1) Unknown event type → reject before any DB contact.
  if (!isKnownEventType(input.event_type)) {
    throw new EmitError(
      `unknown event_type "${input.event_type}". ` +
      `Register it in lib/events/schemas.ts::eventSchemas before emitting.`,
    );
  }

  // (2) Idempotency-key enforcement. Non-human actors retry by design;
  //     omitting a key turns retries into duplicate events.
  if (requiresIdempotencyKey(input.actor_type) && !input.idempotency_key) {
    throw new EmitError(
      `idempotency_key required for actor_type="${input.actor_type}". ` +
      `Use a factory from lib/events/idempotency-keys.ts.`,
    );
  }

  // (3) Zod-validate the payload. Fails here = never written to DB.
  const schema = eventSchemas[input.event_type];
  const validated = schema.parse(input.payload);

  // (4) PII scrub. Any detections replaced with sensitive_data tokens.
  const scrubbed = await scrubPayloadForPII(input.event_type, validated);

  // (5) Single server-side transaction. emit_event_atomic handles:
  //     idempotency check → entity UPDATE (with field whitelist +
  //     ELSE-RAISE) → events INSERT → outbox INSERT. All atomic.
  const { data: eventId, error } = await supabaseAdmin.rpc('emit_event_atomic', {
    p_entity_table:    input.entityWrite?.table ?? null,
    p_entity_pk:       input.entityWrite?.pk ?? null,
    p_entity_update:   input.entityWrite?.update ?? null,
    p_event_type:      input.event_type,
    p_actor_type:      input.actor_type,
    p_subject_type:    input.subject_type,
    p_subject_id:      input.subject_id,
    p_account_id:      input.account_id ?? null,
    p_payload:         scrubbed as Record<string, unknown>,
    p_idempotency_key: input.idempotency_key ?? null,
  });

  if (error) {
    throw new EmitError(`emit_event_atomic failed: ${error.message}`);
  }
  if (!eventId || typeof eventId !== 'string') {
    throw new EmitError(
      `emit_event_atomic returned no event_id (got ${JSON.stringify(eventId)}).`,
    );
  }

  // (6) Return event_id — caller uses it as causation chain + realtime subscribe.
  return eventId;
}
