/**
 * Event payload schemas — architecture §5.3.
 *
 * Stage 0 S0.3 ships Zod schemas for the first event-type set. Every event
 * type emitted by the system maps to exactly one Zod schema. `withEmit()`
 * looks up the schema by `event_type` and calls `.parse()` before any DB
 * write; malformed payloads never reach the events table.
 *
 * The `eventSchemas` registry below is the single source of truth. To add
 * a new event type:
 *   (1) define a `const SomeNameSchema = z.object({...})`,
 *   (2) add it to `eventSchemas` keyed by the event_type string,
 *   (3) export the inferred type from `lib/events/types.ts` via `z.infer`.
 * Do NOT hand-write TS types that duplicate the Zod shapes — derive them.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Engagement lifecycle
// ---------------------------------------------------------------------------

export const EngagementCreatedSchema = z.object({
  contract_type: z.string().min(1),
  contact_id: z.string().uuid(),
  offer_id: z.string().uuid().optional(),
  spec_id: z.string().uuid(),
  spec_version: z.number().int().nonnegative(),
  contracted_price: z.number().nonnegative(),
});

export const EngagementStartedSchema = z.object({
  trigger: z.enum(['payment_confirmed', 'wizard_completed', 'admin_manual']),
});

/**
 * REVISED v1.1 (Fix J): precise emission gating. Schema enforces that
 * completion_type and completed_requirement_count are present. The
 * workflow confirms all requirements satisfied + completed_at set +
 * solver overall_progress=1.0 BEFORE emitting. Emission without these
 * fields fails Zod validation here, before any DB write.
 */
export const EngagementCompletedSchema = z.object({
  completion_type: z.enum(['full', 'exception_assisted']),
  completed_requirement_count: z.number().int().nonnegative(),
  spec_version: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Payment lifecycle
// ---------------------------------------------------------------------------

export const PaymentConfirmedSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  method: z.string().min(1),
  invoice_number: z.string().min(1),
  engagement_id: z.string().uuid(),
  transaction_id: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Member lifecycle
// ---------------------------------------------------------------------------

export const MemberAddedSchema = z.object({
  contact_id: z.string().uuid(),
  role: z.string().min(1),
  ownership_pct: z.number().min(0).max(100),
  is_primary: z.boolean(),
  is_signer: z.boolean(),
  added_by: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Document lifecycle
// ---------------------------------------------------------------------------

export const DocumentUploadedSchema = z.object({
  doc_type: z.string().min(1),
  contact_id: z.string().uuid().nullable(),
  account_id: z.string().uuid().nullable(),
  file_path: z.string().min(1),
  uploaded_by: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Requirement lifecycle
// ---------------------------------------------------------------------------

/**
 * REVISED v1.4 (F7/Round 5): per-member semantics.
 * For `per_member: true` requirements (e.g. member_passport), this event
 * fires ONCE — only when ALL active members have satisfied. The schema
 * captures `all_members_satisfied` and `member_count` so consumers
 * (solver, step.waitForEvent) can distinguish per-member completion from
 * single-subject completion.
 */
export const RequirementSatisfiedSchema = z.object({
  requirement_key: z.string().min(1),
  evidence_event_id: z.string().uuid(),
  spec_id: z.string().uuid(),
  per_member: z.boolean(),
  all_members_satisfied: z.boolean(),
  member_count: z.number().int().nonnegative().nullable(),
});

// ---------------------------------------------------------------------------
// Exception lifecycle
// ---------------------------------------------------------------------------

export const ExceptionApprovedSchema = z.object({
  requirement_key: z.string().min(1),
  exception_type: z.string().min(1),
  approved_by: z.string().min(1),
  reason: z.string().min(1),
  expires_at: z.string().datetime().nullable(),
  evidence: z.array(z.string().uuid()),
});

// ---------------------------------------------------------------------------
// AI decisions
// ---------------------------------------------------------------------------

/**
 * The audit trail for every AI action. `ai.decision` events are the source
 * the solver reads when evaluating `ai_evaluable` requirements — the solver
 * never calls AI inline.
 */
export const AiDecisionSchema = z.object({
  question: z.string().min(1),
  decision: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
  model: z.string().min(1),
  evidence_cited: z.array(z.string()),
  tokens_input: z.number().int().nonnegative(),
  tokens_output: z.number().int().nonnegative(),
  cached: z.boolean(),
  scar_matches: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Registry — keyed by event_type string. Single lookup surface for emit.ts.
// ---------------------------------------------------------------------------

export const eventSchemas = {
  'engagement.created': EngagementCreatedSchema,
  'engagement.started': EngagementStartedSchema,
  'engagement.completed': EngagementCompletedSchema,
  'payment.confirmed': PaymentConfirmedSchema,
  'member.added': MemberAddedSchema,
  'document.uploaded': DocumentUploadedSchema,
  'requirement.satisfied': RequirementSatisfiedSchema,
  'exception.approved': ExceptionApprovedSchema,
  'ai.decision': AiDecisionSchema,
} as const;

export type KnownEventType = keyof typeof eventSchemas;

/**
 * Type guard: returns true iff `s` is a registered event type.
 * Used by `withEmit()` to reject unknown types before any DB call.
 */
export function isKnownEventType(s: string): s is KnownEventType {
  return Object.prototype.hasOwnProperty.call(eventSchemas, s);
}
