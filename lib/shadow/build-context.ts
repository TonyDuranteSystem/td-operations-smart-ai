/**
 * Builds an EvaluationContext from v1-clone sandbox data for a given account.
 *
 * V1 has no event log — we infer what events "should have happened" from v1's
 * observable state (paid payments, EIN, formation date, OA, etc.) and synthesize
 * them. This gives the solver something to evaluate. When solver output diverges
 * from v1 reality, the diff is logged to shadow_diffs.
 *
 * SMLLC Formation spec event mapping:
 *   payments (status=paid)      → payment.confirmed  (subject = synthetic engagement)
 *   accounts.formation_date     → account.formation_confirmed (subject = account)
 *   accounts.ein_number         → account.ein_received (subject = account)
 *   oa_agreements (signed)      → document.uploaded + payload.doc_type=operating_agreement_signed
 *   account_contacts            → AccountMemberView[] (no left_at in v1 — all treated as active)
 */

import type {
  EvaluationContext,
  EngagementView,
  AccountView,
  AccountMemberView,
  SolverEvent,
  ExceptionView,
  AiDecisionView,
} from '@/lib/solver/types';

export interface SandboxClient {
  /** v1 account row */
  account: AccountView;
  /** payments with status = 'paid' */
  paid_payments: Record<string, unknown>[];
  /** account_contacts rows */
  members: Record<string, unknown>[];
  /** oa_agreements rows (signed) */
  oa_signed: boolean;
  /** formation_submissions.completed_at if present */
  formation_completed_at: string | null;
}

const SPEC_ID = '40fed2c9-02fe-442a-9c7d-800eef711a98';

function syntheticEngagementId(accountId: string): string {
  // Deterministic synthetic ID: hash not needed, just prefix for clarity
  return `00000000-0000-0000-0000-${accountId.replace(/-/g, '').slice(0, 12)}`;
}

function syntheticEvent(
  id: string,
  event_type: string,
  subject_type: string,
  subject_id: string,
  account_id: string | null,
  payload: Record<string, unknown>,
  created_at: string,
): SolverEvent {
  return { id, event_type, subject_type, subject_id, account_id, payload, created_at };
}

export function buildContext(client: SandboxClient, now: string): EvaluationContext {
  const accountId = client.account['id'] as string;
  const engagementId = syntheticEngagementId(accountId);

  const V1_STATUS_MAP: Record<string, string> = {
    Active: 'active',
    Cancelled: 'cancelled',
    Closed: 'completed',
    'Pending Formation': 'active',
    Offboarding: 'on_hold',
    Suspended: 'on_hold',
  };
  const v1AccountStatus = String(client.account['status'] ?? 'Active');
  const engagementStatus = V1_STATUS_MAP[v1AccountStatus] ?? 'active';

  const engagement: EngagementView = {
    id: engagementId,
    account_id: accountId,
    contact_id: accountId, // v1 has no separate contact per engagement; use account as proxy
    contract_type: 'smllc_formation',
    status: engagementStatus,
    metadata: {
      company_name: client.account['company_name'],
      state_of_formation: client.account['state_of_formation'],
      spec_id: SPEC_ID,
    },
    started_at: String(client.account['portal_created_date'] ?? now),
  };

  const account: AccountView = client.account;

  const members: AccountMemberView[] = client.members.map((m) => ({
    contact_id: String(m['contact_id']),
    is_primary: Boolean(m['is_primary']),
    is_signer: m['role'] === 'owner' || Boolean(m['is_primary']),
    left_at: null, // v1 account_contacts has no left_at; treat all as active
  }));

  // Ensure at least one member (SMLLC has exactly one — the account owner)
  if (members.length === 0) {
    members.push({
      contact_id: accountId,
      is_primary: true,
      is_signer: true,
      left_at: null,
    });
  }

  const events: SolverEvent[] = [];

  // payment.confirmed — synthesized from paid payments
  const firstPaid = client.paid_payments[0];
  if (firstPaid) {
    const paidAt = String(firstPaid['paid_date'] ?? firstPaid['created_at'] ?? now);
    events.push(syntheticEvent(
      `synthetic-payment-${accountId}`,
      'payment.confirmed',
      'engagement',
      engagementId,
      accountId,
      { amount: firstPaid['amount'], invoice_number: firstPaid['invoice_number'] },
      paidAt,
    ));
  }

  // account.formation_confirmed — synthesized from formation_date
  const formationDate = client.account['formation_date'];
  if (formationDate) {
    events.push(syntheticEvent(
      `synthetic-formation-${accountId}`,
      'account.formation_confirmed',
      'account',
      accountId,
      accountId,
      { formation_date: formationDate, state: client.account['state_of_formation'] },
      String(formationDate),
    ));
  }

  // account.ein_received — synthesized from ein_number
  const einNumber = client.account['ein_number'];
  if (einNumber) {
    events.push(syntheticEvent(
      `synthetic-ein-${accountId}`,
      'account.ein_received',
      'account',
      accountId,
      accountId,
      { ein_number: einNumber },
      String(formationDate ?? now), // EIN comes after formation; use formation_date as proxy
    ));
  }

  // document.uploaded (operating_agreement_signed) — from oa_signed flag
  if (client.oa_signed) {
    events.push(syntheticEvent(
      `synthetic-oa-${accountId}`,
      'document.uploaded',
      'engagement',
      engagementId,
      accountId,
      { doc_type: 'operating_agreement_signed' },
      String(formationDate ?? now),
    ));
  }

  const exceptions: ExceptionView[] = [];
  const ai_decisions: AiDecisionView[] = [];

  return { engagement, account, events, members, exceptions, ai_decisions, now };
}
