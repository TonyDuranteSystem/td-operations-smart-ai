import { describe, expect, it } from 'vitest';
import {
  evaluate,
  type AccountMemberView,
  type AccountView,
  type EffectiveSpec,
  type EngagementView,
  type EvaluationContext,
  type ExceptionView,
  type SolverEvent,
} from '@/lib/solver';
import { smllcFormation } from '@/lib/specs/smllc-formation';

/**
 * Solver-evaluate tests. Build hand-crafted EvaluationContexts that exercise
 * each branch of the evaluator. The fixture spec is the real SMLLC spec so
 * dependency topology is non-trivial (payment_gate blocks all, state_filing
 * depends on three peers, etc.).
 */

const ENG_ID = '00000000-0000-4000-8000-000000000001';
const ACCT_ID = '00000000-0000-4000-8000-000000000002';
const MEMBER_CONTACT = '00000000-0000-4000-8000-000000000003';
const SPEC_ROW = '40fed2c9-02fe-442a-9c7d-800eef711a98';
const NOW = '2026-04-24T12:00:00Z';

function effective(): EffectiveSpec {
  return {
    ...smllcFormation,
    spec_row_id: SPEC_ROW,
    pin_date: NOW,
    overrides_applied: 0,
  };
}

function engagement(overrides?: Partial<EngagementView>): EngagementView {
  return {
    id: ENG_ID,
    account_id: ACCT_ID,
    contact_id: MEMBER_CONTACT,
    contract_type: 'smllc_formation',
    status: 'active',
    metadata: {},
    started_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function account(overrides?: Partial<AccountView>): AccountView {
  return { id: ACCT_ID, ...overrides };
}

function member(overrides?: Partial<AccountMemberView>): AccountMemberView {
  return {
    contact_id: MEMBER_CONTACT,
    is_signer: true,
    is_primary: true,
    left_at: null,
    ...overrides,
  };
}

function ctx(partial?: Partial<EvaluationContext>): EvaluationContext {
  return {
    engagement: engagement(),
    account: account(),
    events: [],
    members: [member()],
    exceptions: [],
    ai_decisions: [],
    now: NOW,
    ...partial,
  };
}

function eventRow(overrides: Partial<SolverEvent> & Pick<SolverEvent, 'id' | 'event_type'>): SolverEvent {
  return {
    subject_type: 'engagement',
    subject_id: ENG_ID,
    account_id: ACCT_ID,
    payload: {},
    created_at: '2026-04-10T00:00:00Z',
    ...overrides,
  };
}

function statusOf(report: ReturnType<typeof evaluate>, key: string) {
  const r = report.requirements.find(r => r.key === key);
  if (!r) throw new Error(`no requirement ${key}`);
  return r;
}

// ---------------------------------------------------------------------------

describe('evaluate — empty context', () => {
  it('returns a StatusReport with every non-gate req blocked by the unsatisfied gate', () => {
    const r = evaluate(effective(), ctx());
    expect(r.engagement_id).toBe(ENG_ID);
    expect(r.spec_row_id).toBe(SPEC_ROW);
    expect(r.spec_version).toBe(1);
    expect(r.computed_at).toBe(NOW);
    expect(r.overall_progress).toBe(0);
    // Gate itself is `possible` (no deps, no blockers, unsatisfied).
    expect(statusOf(r, 'payment_gate').status).toBe('possible');
    // All other reqs are blocked by the gate (blocks: ['*']).
    for (const key of ['company_name', 'state_of_formation', 'member_passport', 'state_filing', 'ein', 'operating_agreement']) {
      const s = statusOf(r, key);
      expect(s.status).toBe('blocked');
      expect(s.blocked_by).toContain('payment_gate');
    }
  });
});

describe('evaluate — payment_gate satisfied', () => {
  it('unblocks leaf requirements but keeps multi-dep reqs blocked until deps are met', () => {
    const r = evaluate(
      effective(),
      ctx({
        events: [eventRow({ id: 'e-pay', event_type: 'payment.confirmed' })],
      }),
    );
    expect(statusOf(r, 'payment_gate').status).toBe('satisfied');
    // Data fields still unsatisfied (account has no company_name) → missing → possible (no deps).
    expect(statusOf(r, 'company_name').status).toBe('possible');
    expect(statusOf(r, 'state_of_formation').status).toBe('possible');
    expect(statusOf(r, 'member_passport').status).toBe('possible');
    // state_filing depends on three; none satisfied → blocked by all three.
    const sf = statusOf(r, 'state_filing');
    expect(sf.status).toBe('blocked');
    expect(sf.blocked_by).toEqual(
      expect.arrayContaining(['company_name', 'state_of_formation', 'member_passport']),
    );
    // ein depends on state_filing (transitively blocked).
    expect(statusOf(r, 'ein').status).toBe('blocked');
    expect(statusOf(r, 'ein').blocked_by).toEqual(['state_filing']);
  });
});

describe('evaluate — ReqData', () => {
  it('reads account.company_name when account exists', () => {
    const r = evaluate(
      effective(),
      ctx({
        events: [eventRow({ id: 'e-pay', event_type: 'payment.confirmed' })],
        account: account({ company_name: 'Acme LLC', state_of_formation: 'Wyoming' }),
      }),
    );
    expect(statusOf(r, 'company_name').status).toBe('satisfied');
    expect(statusOf(r, 'state_of_formation').status).toBe('satisfied');
  });

  it('falls back to engagement.metadata when account is null (when_account_null)', () => {
    const r = evaluate(
      effective(),
      ctx({
        events: [eventRow({ id: 'e-pay', event_type: 'payment.confirmed' })],
        account: null,
        engagement: engagement({
          account_id: null,
          metadata: { company_name: 'Wizard LLC', state_of_formation: 'Delaware' },
        }),
      }),
    );
    expect(statusOf(r, 'company_name').status).toBe('satisfied');
    expect(statusOf(r, 'state_of_formation').status).toBe('satisfied');
  });

  it('rejects a value not in the allowed list', () => {
    const r = evaluate(
      effective(),
      ctx({
        events: [eventRow({ id: 'e-pay', event_type: 'payment.confirmed' })],
        account: account({ state_of_formation: 'Texas' }), // not in allowed list
      }),
    );
    expect(statusOf(r, 'state_of_formation').status).toBe('possible'); // missing + no blockers
  });
});

describe('evaluate — ReqDocument per_member', () => {
  it('is satisfied only when every active member has an uploaded doc', () => {
    const secondMember: AccountMemberView = member({
      contact_id: '00000000-0000-4000-8000-000000000004',
    });
    const ev1 = eventRow({
      id: 'e-doc-1',
      event_type: 'document.uploaded',
      payload: { doc_type: 'passport', contact_id: MEMBER_CONTACT },
    });
    // Only one member has a passport → missing.
    const onlyOne = evaluate(
      effective(),
      ctx({
        events: [eventRow({ id: 'e-pay', event_type: 'payment.confirmed' }), ev1],
        members: [member(), secondMember],
      }),
    );
    expect(statusOf(onlyOne, 'member_passport').status).toBe('possible');
    expect(statusOf(onlyOne, 'member_passport').per_member).toEqual([
      expect.objectContaining({ contact_id: MEMBER_CONTACT, satisfied: true }),
      expect.objectContaining({ contact_id: secondMember.contact_id, satisfied: false }),
    ]);

    // Both members → satisfied.
    const ev2 = eventRow({
      id: 'e-doc-2',
      event_type: 'document.uploaded',
      payload: { doc_type: 'passport', contact_id: secondMember.contact_id },
    });
    const bothOk = evaluate(
      effective(),
      ctx({
        events: [eventRow({ id: 'e-pay', event_type: 'payment.confirmed' }), ev1, ev2],
        members: [member(), secondMember],
      }),
    );
    expect(statusOf(bothOk, 'member_passport').status).toBe('satisfied');
    expect(statusOf(bothOk, 'member_passport').evidence_event_ids).toEqual(
      expect.arrayContaining(['e-doc-1', 'e-doc-2']),
    );
  });
});

describe('evaluate — ReqDeliverable with payload match', () => {
  it('requires exact payload shallow-match', () => {
    const satisfyAll = ctx({
      account: account({ company_name: 'X', state_of_formation: 'Wyoming' }),
      events: [
        eventRow({ id: 'e-pay', event_type: 'payment.confirmed' }),
        eventRow({
          id: 'e-doc',
          event_type: 'document.uploaded',
          payload: { doc_type: 'passport', contact_id: MEMBER_CONTACT },
        }),
        eventRow({
          id: 'e-file',
          event_type: 'account.formation_confirmed',
        }),
        eventRow({
          id: 'e-ein',
          event_type: 'account.ein_received',
        }),
      ],
    });
    // No OA event yet.
    const r1 = evaluate(effective(), satisfyAll);
    expect(statusOf(r1, 'operating_agreement').status).toBe('possible');

    // OA event with WRONG payload doc_type.
    const r2 = evaluate(
      effective(),
      ctx({
        ...satisfyAll,
        events: [
          ...satisfyAll.events,
          eventRow({
            id: 'e-oa-bad',
            event_type: 'document.uploaded',
            payload: { doc_type: 'something_else' },
          }),
        ],
      }),
    );
    expect(statusOf(r2, 'operating_agreement').status).toBe('possible');

    // OA event with correct payload.
    const r3 = evaluate(
      effective(),
      ctx({
        ...satisfyAll,
        events: [
          ...satisfyAll.events,
          eventRow({
            id: 'e-oa-ok',
            event_type: 'document.uploaded',
            payload: { doc_type: 'operating_agreement_signed' },
          }),
        ],
      }),
    );
    expect(statusOf(r3, 'operating_agreement').status).toBe('satisfied');
    expect(statusOf(r3, 'operating_agreement').evidence_event_ids).toEqual(['e-oa-ok']);
  });
});

describe('evaluate — exceptions', () => {
  it('satisfies a requirement by active exception', () => {
    const exceptions: ExceptionView[] = [
      {
        id: 'ex-1',
        engagement_id: ENG_ID,
        requirement_key: 'member_passport',
        status: 'active',
        expires_at: null,
      },
    ];
    const r = evaluate(
      effective(),
      ctx({
        events: [eventRow({ id: 'e-pay', event_type: 'payment.confirmed' })],
        exceptions,
      }),
    );
    expect(statusOf(r, 'member_passport').status).toBe('satisfied_by_exception');
    expect(statusOf(r, 'member_passport').exception_id).toBe('ex-1');
    expect(r.exceptions_active).toHaveLength(1);
  });

  it('treats expired exceptions as inactive', () => {
    const exceptions: ExceptionView[] = [
      {
        id: 'ex-expired',
        engagement_id: ENG_ID,
        requirement_key: 'member_passport',
        status: 'active',
        expires_at: '2026-04-01T00:00:00Z', // before NOW
      },
    ];
    const r = evaluate(
      effective(),
      ctx({
        events: [eventRow({ id: 'e-pay', event_type: 'payment.confirmed' })],
        exceptions,
      }),
    );
    expect(statusOf(r, 'member_passport').status).not.toBe('satisfied_by_exception');
    expect(r.exceptions_active).toHaveLength(0);
  });

  it('unblocks downstream requirements when a dependency is satisfied_by_exception', () => {
    const exceptions: ExceptionView[] = [
      {
        id: 'ex-mp',
        engagement_id: ENG_ID,
        requirement_key: 'member_passport',
        status: 'active',
        expires_at: null,
      },
    ];
    const r = evaluate(
      effective(),
      ctx({
        events: [eventRow({ id: 'e-pay', event_type: 'payment.confirmed' })],
        account: account({ company_name: 'X', state_of_formation: 'Wyoming' }),
        exceptions,
      }),
    );
    // state_filing should no longer be blocked by member_passport.
    const sf = statusOf(r, 'state_filing');
    expect(sf.blocked_by ?? []).not.toContain('member_passport');
    expect(sf.status).toBe('possible');
  });
});

describe('evaluate — overall_progress', () => {
  it('is 1 when every requirement is satisfied', () => {
    const allSat = ctx({
      account: account({ company_name: 'X', state_of_formation: 'Wyoming' }),
      events: [
        eventRow({ id: 'e-pay', event_type: 'payment.confirmed' }),
        eventRow({
          id: 'e-doc',
          event_type: 'document.uploaded',
          payload: { doc_type: 'passport', contact_id: MEMBER_CONTACT },
        }),
        eventRow({ id: 'e-file', event_type: 'account.formation_confirmed' }),
        eventRow({ id: 'e-ein', event_type: 'account.ein_received' }),
        eventRow({
          id: 'e-oa',
          event_type: 'document.uploaded',
          payload: { doc_type: 'operating_agreement_signed' },
        }),
      ],
    });
    const r = evaluate(effective(), allSat);
    expect(r.overall_progress).toBe(1);
    for (const req of r.requirements) {
      expect(['satisfied', 'satisfied_by_exception']).toContain(req.status);
    }
  });

  it('is a fraction matching the satisfied count', () => {
    const partial = ctx({
      events: [eventRow({ id: 'e-pay', event_type: 'payment.confirmed' })],
    });
    const r = evaluate(effective(), partial);
    // Only payment_gate is satisfied: 1 / 7.
    expect(r.overall_progress).toBeCloseTo(1 / 7, 5);
  });
});

describe('evaluate — ai_evaluable', () => {
  it('reports evaluation_pending when no ai.decision exists for the key', () => {
    // None of the shipped SMLLC reqs are ai_evaluable, so synthesize a spec.
    const spec: EffectiveSpec = {
      ...effective(),
      requirements: [
        {
          kind: 'data',
          key: 'ai_req',
          depends_on: [],
          blocks: [],
          per_member: false,
          per_account: false,
          requires_signer: false,
          ai_evaluable: true,
          overridable: false,
          condition: { field: 'account.notes', not_null: true },
        },
      ],
    };
    const r = evaluate(spec, ctx());
    expect(statusOf(r, 'ai_req').status).toBe('evaluation_pending');
    expect(r.evaluation_pending).toEqual(['ai_req']);
  });

  it('satisfies when a truthy ai.decision is present', () => {
    const spec: EffectiveSpec = {
      ...effective(),
      requirements: [
        {
          kind: 'data',
          key: 'ai_req',
          depends_on: [],
          blocks: [],
          per_member: false,
          per_account: false,
          requires_signer: false,
          ai_evaluable: true,
          overridable: false,
          condition: { field: 'account.notes', not_null: true },
        },
      ],
    };
    const r = evaluate(
      spec,
      ctx({
        ai_decisions: [
          {
            requirement_key: 'ai_req',
            decision: true,
            created_at: '2026-04-20T00:00:00Z',
          },
        ],
      }),
    );
    expect(statusOf(r, 'ai_req').status).toBe('satisfied');
    expect(r.evaluation_pending).toEqual([]);
  });
});

describe('evaluate — pre-account data requirements without fallback', () => {
  it('reports pending_account when account is null and no when_account_null is declared', () => {
    const spec: EffectiveSpec = {
      ...effective(),
      requirements: [
        {
          kind: 'data',
          key: 'some_account_field',
          depends_on: [],
          blocks: [],
          per_member: false,
          per_account: false,
          requires_signer: false,
          ai_evaluable: false,
          overridable: false,
          condition: { field: 'account.ein_number', not_null: true },
        },
      ],
    };
    const r = evaluate(spec, ctx({ account: null, engagement: engagement({ account_id: null }) }));
    expect(statusOf(r, 'some_account_field').status).toBe('pending_account');
  });
});
