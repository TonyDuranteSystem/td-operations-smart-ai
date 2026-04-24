/**
 * Event-payload TypeScript types — derived from Zod schemas, never
 * hand-written. If you change a schema in `schemas.ts`, the inferred type
 * changes automatically.
 *
 * `ActorType` is defined here (not in schemas.ts) because it is a table
 * CHECK constraint, not a payload shape — canonical enum lives in SQL
 * (migration 003), mirrored here for type-safe call sites.
 */

import type { z } from 'zod';
import type {
  EngagementCreatedSchema,
  EngagementStartedSchema,
  EngagementCompletedSchema,
  PaymentConfirmedSchema,
  MemberAddedSchema,
  DocumentUploadedSchema,
  RequirementSatisfiedSchema,
  ExceptionApprovedSchema,
  AiDecisionSchema,
} from '@/lib/events/schemas';

export type EngagementCreatedPayload   = z.infer<typeof EngagementCreatedSchema>;
export type EngagementStartedPayload   = z.infer<typeof EngagementStartedSchema>;
export type EngagementCompletedPayload = z.infer<typeof EngagementCompletedSchema>;
export type PaymentConfirmedPayload    = z.infer<typeof PaymentConfirmedSchema>;
export type MemberAddedPayload         = z.infer<typeof MemberAddedSchema>;
export type DocumentUploadedPayload    = z.infer<typeof DocumentUploadedSchema>;
export type RequirementSatisfiedPayload = z.infer<typeof RequirementSatisfiedSchema>;
export type ExceptionApprovedPayload   = z.infer<typeof ExceptionApprovedSchema>;
export type AiDecisionPayload          = z.infer<typeof AiDecisionSchema>;

/**
 * Mirrors the CHECK constraint on `events.actor_type` (migration 003).
 * Any change to this union requires a migration to the CHECK and a
 * matching change here.
 */
export type ActorType =
  | 'human'
  | 'agent'
  | 'webhook'
  | 'cron'
  | 'system'
  | 'migration'
  | 'inngest'
  | 'admin';

/**
 * Non-human actors MUST supply an idempotency key. Webhooks retry,
 * crons re-fire, agents re-invoke, migrations re-run during cutover
 * rehearsal — every one of them can replay. `withEmit()` enforces this
 * at runtime; typed factories in `idempotency-keys.ts` enforce it at
 * compile time by making the call ergonomic only when done correctly.
 */
export const ACTORS_REQUIRING_IDEMPOTENCY: readonly ActorType[] = [
  'webhook',
  'cron',
  'agent',
  'migration',
];

export function requiresIdempotencyKey(actor: ActorType): boolean {
  return ACTORS_REQUIRING_IDEMPOTENCY.includes(actor);
}
