/**
 * SMLLC Formation spec — Stage 0 S0.4.
 *
 * First real exercise of the Smart AI specification engine. Seven
 * requirements per the S0.4 worklist; shape per architecture §6.1.
 *
 * Requirement dependency structure (payment_gate blocks all via `blocks: ['*']`):
 *
 *     payment_gate ── blocks ──▶ all others
 *
 *     company_name ─┐
 *     state_of_formation ┼─▶ state_filing ──▶ ein
 *     member_passport ───┘                  ┘
 *                        └──▶ operating_agreement
 *
 * Divergences from architecture §6.1 (intentional, per S0.4 task wording):
 *   - Requirement keys: `payment_gate` (vs arch `payment`), `state_of_formation`
 *     (vs arch `state`). The longer keys are more self-describing; the solver
 *     doesn't care.
 *   - Seven requirements, not eight: `member_proof_of_address` from arch is
 *     deferred. Scope decision in S0.4 worklist.
 *   - `operating_agreement` depends on data + document reqs (company_name,
 *     state_of_formation, member_passport) rather than arch's `ein`. Reflects
 *     the business reality that the OA can be drafted before EIN issuance.
 */

import {
  defineSpec,
  ReqGate,
  ReqData,
  ReqDocument,
  ReqDeliverable,
  type Spec,
} from '@/lib/specs/types';

export const smllcFormation: Spec = defineSpec({
  contract_type: 'smllc_formation',
  display_name: 'SMLLC Formation',
  version: 1,

  pricing_rules: {
    base_price_usd: 999,
    by_state: {
      'New Mexico': { filing_fee: 50 },
      'Wyoming':    { filing_fee: 100 },
      'Delaware':   { filing_fee: 90 },
      'Florida':    { filing_fee: 125 },
      'Nevada':     { filing_fee: 75 },
    },
  },

  requirements: [
    ReqGate({
      key: 'payment_gate',
      blocks: ['*'],   // no other requirement progresses until payment confirmed
      condition: {
        event_type: 'payment.confirmed',
        subject: '$engagement',
      },
    }),

    // when_account_null fallbacks: the wizard collects company_name +
    // state_of_formation before the account row exists. The solver reads
    // the fallback path from `engagement.metadata.*` until account_id is
    // non-null (architecture §5.3 Fix 4/Round 4).
    ReqData({
      key: 'company_name',
      condition: {
        field: 'account.company_name',
        not_null: true,
        when_account_null: 'engagement.metadata.company_name',
      },
    }),

    ReqData({
      key: 'state_of_formation',
      condition: {
        field: 'account.state_of_formation',
        not_null: true,
        in: ['New Mexico', 'Wyoming', 'Delaware', 'Florida', 'Nevada'],
        when_account_null: 'engagement.metadata.state_of_formation',
      },
    }),

    // SMLLC has exactly one active member. `per_member: true` is still
    // correct — Fix F7 per-member satisfaction trivially fires at 1-of-1.
    ReqDocument({
      key: 'member_passport',
      doc_type: 'passport',
      per_member: true,
      condition: { contact_id: '$member.contact_id', not_expired: true },
    }),

    ReqDeliverable({
      key: 'state_filing',
      depends_on: ['company_name', 'state_of_formation', 'member_passport'],
      condition: {
        event_type: 'account.formation_confirmed',
        subject: '$account',
      },
      ai_hint: 'File via Harbor Compliance when dependencies met',
    }),

    ReqDeliverable({
      key: 'ein',
      depends_on: ['state_filing'],
      requires_signer: true,
      condition: {
        event_type: 'account.ein_received',
        subject: '$account',
      },
    }),

    ReqDeliverable({
      key: 'operating_agreement',
      depends_on: ['company_name', 'state_of_formation', 'member_passport'],
      condition: {
        event_type: 'document.uploaded',
        payload: { doc_type: 'operating_agreement_signed' },
      },
    }),
  ],

  follow_up_rules: {
    missing_member_passport: {
      first_reminder_days: 3,
      subsequent_every_days: 7,
      max_reminders: 5,
    },
    blocked_on_state_filing: { escalate_to_admin_after_days: 14 },
    blocked_on_ein: { escalate_to_admin_after_days: 21 },
  },

  exceptions_config: {
    // Architecture §6.1 Fix G: roles, not usernames. Role membership is
    // managed in auth.users_roles (Stage 1); specs only reference the role.
    member_passport: {
      overridable_by_roles: ['owner'],
      requires_reason: true,
      requires_alternative_document: true,
    },
    ein: {
      overridable_by_roles: ['owner'],
      requires_reason: true,
      note: 'EIN is legally required; override must include alternative evidence',
    },
  },
});
