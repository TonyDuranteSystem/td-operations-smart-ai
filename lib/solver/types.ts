/**
 * Solver types — architecture §7.1 StatusReport + §6.3 EffectiveSpec.
 *
 * The solver is deterministic and pure (architecture §7.2). It reads nothing
 * and writes nothing on its own — all inputs arrive via `EvaluationContext`
 * and the sole output is `StatusReport`. DB loading is an out-of-band
 * responsibility of the caller; tests pass hand-built contexts directly.
 *
 * Skeleton scope (S0.5): StatusReport shape, RequirementStatus shape, the
 * EvaluationContext minimal surface. Cache (§7.3), fingerprint, next_actions
 * (§7.5), and cross-engagement dependency resolution are deferred.
 */
import type { Spec } from '@/lib/specs/types';

/**
 * A spec with applicable `rule_overrides` already merged in at the given
 * `pin_date`. This is what the solver actually evaluates against; raw specs
 * are immutable post-seed.
 */
export type EffectiveSpec = Spec & {
  /** UUID of the `service_specs` row this EffectiveSpec was resolved from. */
  spec_row_id: string;
  /** Inclusive upper bound used when filtering rule_overrides.effective_from. */
  pin_date: string;
  /** How many rule_overrides were applied during resolution (0 = raw spec). */
  overrides_applied: number;
};

/**
 * A single row of the `events` table, as the solver needs it. This is a
 * lightweight view — the solver never touches the outbox or PII vault.
 */
export type SolverEvent = {
  id: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  account_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type EngagementView = {
  id: string;
  account_id: string | null;
  contact_id: string;
  contract_type: string;
  status: string;
  metadata: Record<string, unknown>;
  started_at: string;
};

export type AccountView = Record<string, unknown> & { id: string };

export type AccountMemberView = {
  contact_id: string;
  is_signer: boolean;
  is_primary: boolean;
  left_at: string | null;
};

export type ExceptionView = {
  id: string;
  engagement_id: string;
  requirement_key: string;
  status: string;
  expires_at: string | null;
};

/**
 * Most recent `ai.decision` event indexed by requirement_key, already filtered
 * to the target engagement. The solver does not call AI inline — it reads the
 * latest decision and treats absence as `evaluation_pending`.
 */
export type AiDecisionView = {
  requirement_key: string;
  decision: unknown;
  created_at: string;
};

/**
 * Everything the solver needs to evaluate one engagement. The caller is
 * responsible for loading — keeping the solver pure lets tests pass fixtures
 * directly and guarantees deterministic output.
 */
export type EvaluationContext = {
  engagement: EngagementView;
  /** Null iff account has not been created yet (pre-formation). */
  account: AccountView | null;
  /** Events filtered to `subject_id IN (engagement.id, account_id, contact_id)`. */
  events: SolverEvent[];
  /** Active members (`left_at IS NULL`). Used for `per_member` requirements. */
  members: AccountMemberView[];
  /** Exceptions for this engagement (solver filters for `active` + not expired). */
  exceptions: ExceptionView[];
  /** Latest `ai.decision` per requirement_key, if any. */
  ai_decisions: AiDecisionView[];
  /** ISO timestamp used for "now" comparisons — passed in for determinism. */
  now: string;
};

export type RequirementStatusKind =
  | 'satisfied'
  | 'satisfied_by_exception'
  | 'possible'
  | 'blocked'
  | 'missing'
  | 'pending_account'
  | 'evaluation_pending';

export type PerMemberSatisfaction = {
  contact_id: string;
  satisfied: boolean;
  evidence_event_id?: string;
};

export type RequirementStatus = {
  key: string;
  kind: 'gate' | 'data' | 'document' | 'deliverable';
  status: RequirementStatusKind;
  /** Set when status = `satisfied` or `satisfied_by_exception`. */
  satisfied_at?: string;
  /** Events whose presence justified `satisfied`. */
  evidence_event_ids?: string[];
  /** Requirement keys blocking this one (non-empty only when status=blocked). */
  blocked_by?: string[];
  /** Set iff exception granted this row. */
  exception_id?: string;
  /** For per_member document requirements — one row per active member. */
  per_member?: PerMemberSatisfaction[];
};

export type StatusReport = {
  engagement_id: string;
  contract_type: string;
  spec_row_id: string;
  spec_version: number;
  overall_progress: number;
  requirements: RequirementStatus[];
  exceptions_active: ExceptionView[];
  evaluation_pending: string[];
  /** ISO timestamp of evaluation — matches `context.now`. */
  computed_at: string;
};
