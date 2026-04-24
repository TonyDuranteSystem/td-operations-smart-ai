/**
 * evaluate — architecture §7 (Layer 4: The Solver).
 *
 * Pure function: `(EffectiveSpec, EvaluationContext) -> StatusReport`. The
 * solver reads nothing and writes nothing; all inputs arrive via `context`,
 * timestamps come from `context.now` (architecture §7.2 "timestamps are
 * inputs, not dependencies").
 *
 * Skeleton scope (S0.5):
 *   - Gate, data, document, deliverable evaluation.
 *   - `when_account_null` fallback for data requirements (§7.4 Fix 4).
 *   - `per_member` per-member document satisfaction (§5.3 Fix F7).
 *   - Dependency topology: `blocked` vs `possible`.
 *   - `blocks: ['*']` gate propagation.
 *   - `satisfied_by_exception` override from active exceptions.
 *   - `ai_evaluable` requirements: read latest `ai.decision` or report
 *     `evaluation_pending`. No TTL / staleness check yet (deferred).
 *   - `overall_progress` = satisfied fraction of total.
 *
 * Deferred to later tickets:
 *   - `next_actions` computation (§7.5).
 *   - Cross-engagement dependencies (`dependsOnEngagement()`, §6.4).
 *   - Cache layer (§7.3).
 *   - Context fingerprint and agent-dispatch throttling (§7.2 v1.4).
 */
import type {
  ReqData,
  ReqDeliverable,
  ReqDocument,
  ReqGate,
  Requirement,
} from '@/lib/specs/types';
import type {
  AccountView,
  EffectiveSpec,
  EngagementView,
  EvaluationContext,
  ExceptionView,
  PerMemberSatisfaction,
  RequirementStatus,
  SolverEvent,
  StatusReport,
} from '@/lib/solver/types';

/**
 * Resolve a dotted path like `account.company_name` or
 * `engagement.metadata.state_of_formation` against the context. Returns
 * `undefined` when any intermediate is missing — the caller interprets
 * undefined as "not satisfied", never as an error.
 */
function readFieldPath(
  path: string,
  engagement: EngagementView,
  account: AccountView | null,
): unknown {
  const parts = path.split('.');
  const head = parts[0];
  let cursor: unknown;
  if (head === 'account') cursor = account;
  else if (head === 'engagement') cursor = engagement;
  else return undefined;

  for (let i = 1; i < parts.length; i++) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[parts[i]!];
  }
  return cursor;
}

function isActiveException(ex: ExceptionView, nowISO: string): boolean {
  if (ex.status !== 'active') return false;
  if (ex.expires_at === null) return true;
  return ex.expires_at > nowISO;
}

// ---------------------------------------------------------------------------
// Per-kind evaluation (isolation pass). Returns status + evidence; dependency
// topology (blocked vs possible) is resolved in a second pass.
// ---------------------------------------------------------------------------

type IsolationResult = {
  status: 'satisfied' | 'missing' | 'pending_account' | 'evaluation_pending';
  satisfied_at?: string;
  evidence_event_ids?: string[];
  per_member?: PerMemberSatisfaction[];
};

function evalGate(req: ReqGate, events: SolverEvent[]): IsolationResult {
  const match = events.find(e => e.event_type === req.condition.event_type);
  if (match) {
    return {
      status: 'satisfied',
      satisfied_at: match.created_at,
      evidence_event_ids: [match.id],
    };
  }
  return { status: 'missing' };
}

function evalData(
  req: ReqData,
  engagement: EngagementView,
  account: AccountView | null,
): IsolationResult {
  const { field, not_null, in: allowed, when_account_null } = req.condition;

  // Pre-account: follow when_account_null fallback if declared; otherwise
  // report `pending_account` (distinct from missing — does not block).
  let value: unknown;
  if (field.startsWith('account.') && account === null) {
    if (when_account_null) {
      value = readFieldPath(when_account_null, engagement, account);
    } else {
      return { status: 'pending_account' };
    }
  } else {
    value = readFieldPath(field, engagement, account);
  }

  if (not_null && (value === null || value === undefined || value === '')) {
    return { status: 'missing' };
  }
  if (allowed && allowed.length > 0) {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      return { status: 'missing' };
    }
  }
  if (value === null || value === undefined) {
    return { status: 'missing' };
  }
  // No created_at on entity-field satisfaction — data reqs are timeless.
  return { status: 'satisfied' };
}

function evalDocument(
  req: ReqDocument,
  ctx: EvaluationContext,
): IsolationResult {
  const uploads = ctx.events.filter(
    e =>
      e.event_type === 'document.uploaded' &&
      (e.payload as { doc_type?: string }).doc_type === req.doc_type,
  );

  if (req.per_member) {
    if (ctx.members.length === 0) {
      // Per-member with no members yet — nothing to satisfy, treat as missing.
      return { status: 'missing', per_member: [] };
    }
    const perMember: PerMemberSatisfaction[] = ctx.members.map(m => {
      const match = uploads.find(
        e =>
          (e.payload as { contact_id?: string }).contact_id === m.contact_id,
      );
      return match
        ? { contact_id: m.contact_id, satisfied: true, evidence_event_id: match.id }
        : { contact_id: m.contact_id, satisfied: false };
    });
    const allSatisfied = perMember.every(p => p.satisfied);
    if (allSatisfied) {
      const mostRecent = perMember
        .map(p => uploads.find(u => u.id === p.evidence_event_id)!)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]!;
      return {
        status: 'satisfied',
        satisfied_at: mostRecent.created_at,
        evidence_event_ids: perMember.map(p => p.evidence_event_id!),
        per_member: perMember,
      };
    }
    return { status: 'missing', per_member: perMember };
  }

  const first = uploads[0];
  if (first) {
    return {
      status: 'satisfied',
      satisfied_at: first.created_at,
      evidence_event_ids: [first.id],
    };
  }
  return { status: 'missing' };
}

function evalDeliverable(
  req: ReqDeliverable,
  events: SolverEvent[],
): IsolationResult {
  const match = events.find(e => {
    if (e.event_type !== req.condition.event_type) return false;
    const wantPayload = req.condition.payload;
    if (!wantPayload) return true;
    // Shallow payload match — every key in wantPayload must equal on event.
    for (const [k, v] of Object.entries(wantPayload)) {
      if ((e.payload as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
  });
  if (match) {
    return {
      status: 'satisfied',
      satisfied_at: match.created_at,
      evidence_event_ids: [match.id],
    };
  }
  return { status: 'missing' };
}

function evalRequirementInIsolation(
  req: Requirement,
  ctx: EvaluationContext,
): IsolationResult {
  // ai_evaluable short-circuit: read the latest ai.decision event, otherwise
  // evaluation_pending. Skeleton does not TTL-age decisions — any decision
  // present for this requirement counts. Staleness is a §7.2 follow-up.
  if (req.ai_evaluable) {
    const decision = ctx.ai_decisions.find(d => d.requirement_key === req.key);
    if (!decision) return { status: 'evaluation_pending' };
    // Truthy decision → satisfied. Non-boolean decisions map: null/false = missing.
    const ok =
      decision.decision === true ||
      (typeof decision.decision === 'string' && decision.decision.length > 0) ||
      (typeof decision.decision === 'number' && decision.decision !== 0);
    return ok
      ? { status: 'satisfied', satisfied_at: decision.created_at }
      : { status: 'missing' };
  }

  switch (req.kind) {
    case 'gate':
      return evalGate(req, ctx.events);
    case 'data':
      return evalData(req, ctx.engagement, ctx.account);
    case 'document':
      return evalDocument(req, ctx);
    case 'deliverable':
      return evalDeliverable(req, ctx.events);
  }
}

// ---------------------------------------------------------------------------
// Top-level solver
// ---------------------------------------------------------------------------

export function evaluate(
  spec: EffectiveSpec,
  ctx: EvaluationContext,
): StatusReport {
  const requirements = spec.requirements;
  const byKey = new Map(requirements.map(r => [r.key, r]));

  // Active exceptions by requirement_key (first wins if duplicates).
  const activeExceptions = ctx.exceptions.filter(ex => isActiveException(ex, ctx.now));
  const exceptionByKey = new Map<string, ExceptionView>();
  for (const ex of activeExceptions) {
    if (!exceptionByKey.has(ex.requirement_key)) {
      exceptionByKey.set(ex.requirement_key, ex);
    }
  }

  // Pass 1 — isolation.
  const isolation = new Map<string, IsolationResult>();
  for (const req of requirements) {
    isolation.set(req.key, evalRequirementInIsolation(req, ctx));
  }

  // Gate propagation: a gate with `blocks: ['*']` or an explicit block list
  // whose status != satisfied forces the named targets to `blocked`. Collected
  // here and applied in Pass 2 alongside `depends_on` resolution.
  const blockedByGate = new Map<string, string[]>();
  for (const req of requirements) {
    if (req.kind !== 'gate') continue;
    const iso = isolation.get(req.key)!;
    if (iso.status === 'satisfied') continue;
    const targets = req.blocks.includes('*')
      ? requirements.filter(r => r.key !== req.key).map(r => r.key)
      : req.blocks;
    for (const t of targets) {
      const list = blockedByGate.get(t) ?? [];
      list.push(req.key);
      blockedByGate.set(t, list);
    }
  }

  // Pass 2 — dependency + gate topology, + exceptions.
  const statuses: RequirementStatus[] = [];
  const evaluationPending: string[] = [];

  for (const req of requirements) {
    const iso = isolation.get(req.key)!;
    const base: RequirementStatus = {
      key: req.key,
      kind: req.kind,
      status: iso.status,
      ...(iso.satisfied_at !== undefined ? { satisfied_at: iso.satisfied_at } : {}),
      ...(iso.evidence_event_ids !== undefined
        ? { evidence_event_ids: iso.evidence_event_ids }
        : {}),
      ...(iso.per_member !== undefined ? { per_member: iso.per_member } : {}),
    };

    // Exception override takes precedence over everything except gate.
    const ex = exceptionByKey.get(req.key);
    if (ex && req.kind !== 'gate') {
      statuses.push({
        ...base,
        status: 'satisfied_by_exception',
        exception_id: ex.id,
        satisfied_at: ex.expires_at ?? ctx.now,
      });
      continue;
    }

    if (iso.status === 'evaluation_pending') {
      evaluationPending.push(req.key);
      statuses.push(base);
      continue;
    }

    if (iso.status === 'satisfied') {
      statuses.push(base);
      continue;
    }

    if (iso.status === 'pending_account') {
      statuses.push(base);
      continue;
    }

    // Blocked-by-gate or blocked-by-unsatisfied-dependency.
    const blockers: string[] = [];
    for (const g of blockedByGate.get(req.key) ?? []) blockers.push(g);

    for (const dep of req.depends_on) {
      const depReq = byKey.get(dep);
      if (!depReq) continue; // DAG validation at author time prevents this.
      const depIso = isolation.get(dep)!;
      const depEx = exceptionByKey.get(dep);
      const depSatisfied =
        depIso.status === 'satisfied' || (depEx !== undefined && depReq.kind !== 'gate');
      if (!depSatisfied) blockers.push(dep);
    }

    if (blockers.length > 0) {
      statuses.push({ ...base, status: 'blocked', blocked_by: blockers });
    } else {
      // Isolation=missing + no blockers → `possible` (ready to work on).
      statuses.push({ ...base, status: 'possible' });
    }
  }

  const satisfiedCount = statuses.filter(
    s => s.status === 'satisfied' || s.status === 'satisfied_by_exception',
  ).length;

  return {
    engagement_id: ctx.engagement.id,
    contract_type: spec.contract_type,
    spec_row_id: spec.spec_row_id,
    spec_version: spec.version,
    overall_progress:
      requirements.length === 0 ? 0 : satisfiedCount / requirements.length,
    requirements: statuses,
    exceptions_active: activeExceptions,
    evaluation_pending: evaluationPending,
    computed_at: ctx.now,
  };
}
