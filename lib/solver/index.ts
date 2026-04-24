/**
 * Solver barrel — architecture §7.
 *
 * Two public entry points so far:
 *   - `resolveSpec(client, specId, pinDate)` → EffectiveSpec (§6.3 Fix A)
 *   - `evaluate(effectiveSpec, context)`     → StatusReport   (§7.1)
 *
 * Caching, fingerprinting, next_actions, cross-engagement dependencies, and
 * the DB-loading wrapper for `evaluate()` are deferred beyond S0.5.
 */
export { resolveSpec, SpecResolutionError, setAtPath } from '@/lib/solver/resolve-spec';
export type { SpecResolverClient } from '@/lib/solver/resolve-spec';
export { evaluate } from '@/lib/solver/evaluate';
export type {
  AccountMemberView,
  AccountView,
  AiDecisionView,
  EffectiveSpec,
  EngagementView,
  EvaluationContext,
  ExceptionView,
  PerMemberSatisfaction,
  RequirementStatus,
  RequirementStatusKind,
  SolverEvent,
  StatusReport,
} from '@/lib/solver/types';
