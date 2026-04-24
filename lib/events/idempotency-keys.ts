/**
 * Typed idempotency-key factories — architecture §5.4 lines 1181-1215.
 *
 * Every non-human event source has its own factory function. The mandatory
 * namespace prefix makes collisions across sources impossible by construction
 * (webhook:stripe:X can never collide with cron:drain:X or agent:eval:X).
 *
 * Each factory returns a `branded` string — a TypeScript nominal type — so
 * mixing key spaces is a compile-time error, not a runtime race condition.
 * The underlying representation is still `string`; the brand is erased at
 * runtime and exists only for the type checker.
 */

// ---------------------------------------------------------------------------
// Branded key types — nominal typing for idempotency namespaces.
// ---------------------------------------------------------------------------

declare const idempotencyKeyBrand: unique symbol;

export type IdempotencyKey<TNamespace extends string> = string & {
  readonly [idempotencyKeyBrand]: TNamespace;
};

export type WebhookIdempotencyKey  = IdempotencyKey<'webhook'>;
export type CronIdempotencyKey     = IdempotencyKey<'cron'>;
export type InngestIdempotencyKey  = IdempotencyKey<'inngest'>;
export type AgentIdempotencyKey    = IdempotencyKey<'agent'>;
export type ManualIdempotencyKey   = IdempotencyKey<'manual'>;
export type MigrationIdempotencyKey = IdempotencyKey<'migration'>;

/**
 * Any idempotency key at the emit call site. `withEmit()` accepts a plain
 * `string` for flexibility (some callers compute keys dynamically), but the
 * factory outputs are strongly typed — collisions caught earlier.
 */
export type AnyIdempotencyKey =
  | WebhookIdempotencyKey
  | CronIdempotencyKey
  | InngestIdempotencyKey
  | AgentIdempotencyKey
  | ManualIdempotencyKey
  | MigrationIdempotencyKey;

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Stripe / Whop / Inngest-internal / HelloSign — per provider + provider's event ID. */
export function webhookIdempotencyKey(
  provider: 'stripe' | 'whop' | 'inngest' | 'hc',
  providerEventId: string,
): WebhookIdempotencyKey {
  return `webhook:${provider}:${providerEventId}` as WebhookIdempotencyKey;
}

/** Cron jobs — per job name + date/time bucket. Bucket is caller-defined
 *  (daily, hourly, etc.) so a single cron can fan-out into multiple keys. */
export function cronIdempotencyKey(
  jobName: string,
  dateBucket: string,
): CronIdempotencyKey {
  return `cron:${jobName}:${dateBucket}` as CronIdempotencyKey;
}

/**
 * Inngest-driven emissions — per function name + entity under change.
 * Example: `inngest:activate-engagement:<engagement_id>` fires once per
 * engagement even if the outer workflow retries or fans out.
 */
export function inngestIdempotencyKey(
  functionName: string,
  entityId: string,
): InngestIdempotencyKey {
  return `inngest:${functionName}:${entityId}` as InngestIdempotencyKey;
}

/**
 * Agent evaluation key — REVISED v1.2 (Fix 6), v1.5 (R6-F2).
 *
 * The `contextFingerprint` argument is a hash of evaluation-relevant state
 * (active member IDs, latest event ID, active exception IDs, spec version).
 * When state changes, the fingerprint changes, forcing a fresh dispatch
 * instead of the v1.1 24-hour-bucket dedupe that silently blocked
 * re-evaluation for up to a day.
 *
 * Computing the fingerprint itself lives in a separate helper (outside
 * S0.3 scope). For S0.3 this factory just wires the contract.
 */
export function agentEvalIdempotencyKey(
  engagementId: string,
  requirementKey: string,
  contextFingerprint: string,
): AgentIdempotencyKey {
  return `agent:eval:${engagementId}:${requirementKey}:${contextFingerprint}` as AgentIdempotencyKey;
}

/**
 * Manual (human-initiated, admin-tool) emissions. The human is the actor,
 * but retry semantics still warrant a key — admin double-clicks on the
 * "Confirm Payment" button should collapse to one event. `hash` is a stable
 * hash of the action's inputs (e.g. engagement_id + action).
 */
export function manualIdempotencyKey(
  userId: string,
  hash: string,
): ManualIdempotencyKey {
  return `manual:${userId}:${hash}` as ManualIdempotencyKey;
}

/**
 * Migration / cutover idempotency — for one-shot emits during data
 * migrations. Re-running a migration never re-emits events.
 */
export function migrationIdempotencyKey(
  migrationName: string,
  recordId: string,
): MigrationIdempotencyKey {
  return `migration:${migrationName}:${recordId}` as MigrationIdempotencyKey;
}
