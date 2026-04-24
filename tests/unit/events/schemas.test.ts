import { describe, expect, it } from 'vitest';
import {
  eventSchemas,
  isKnownEventType,
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

const UUID = '11111111-2222-4333-8444-555555555555';

describe('eventSchemas registry', () => {
  it('exposes all 9 S0.3 event types', () => {
    expect(Object.keys(eventSchemas).sort()).toEqual([
      'ai.decision',
      'document.uploaded',
      'engagement.completed',
      'engagement.created',
      'engagement.started',
      'exception.approved',
      'member.added',
      'payment.confirmed',
      'requirement.satisfied',
    ]);
  });

  it('isKnownEventType returns true only for registered types', () => {
    expect(isKnownEventType('payment.confirmed')).toBe(true);
    expect(isKnownEventType('engagement.created')).toBe(true);
    expect(isKnownEventType('payment.refunded')).toBe(false); // not yet registered
    expect(isKnownEventType('')).toBe(false);
  });
});

describe('EngagementCreatedSchema', () => {
  it('accepts a valid payload', () => {
    expect(
      EngagementCreatedSchema.parse({
        contract_type: 'smllc_formation',
        contact_id: UUID,
        spec_id: UUID,
        spec_version: 1,
        contracted_price: 1500,
      }),
    ).toBeDefined();
  });
  it('rejects missing contact_id', () => {
    expect(() =>
      EngagementCreatedSchema.parse({
        contract_type: 'smllc_formation',
        spec_id: UUID,
        spec_version: 1,
        contracted_price: 1500,
      }),
    ).toThrow();
  });
  it('rejects negative price', () => {
    expect(() =>
      EngagementCreatedSchema.parse({
        contract_type: 'smllc_formation',
        contact_id: UUID,
        spec_id: UUID,
        spec_version: 1,
        contracted_price: -1,
      }),
    ).toThrow();
  });
});

describe('EngagementStartedSchema', () => {
  it('accepts a valid trigger', () => {
    expect(EngagementStartedSchema.parse({ trigger: 'payment_confirmed' })).toEqual({
      trigger: 'payment_confirmed',
    });
  });
  it('rejects an unknown trigger', () => {
    expect(() => EngagementStartedSchema.parse({ trigger: 'magic' })).toThrow();
  });
});

describe('EngagementCompletedSchema (Fix J)', () => {
  it('accepts a valid completion_type + count', () => {
    expect(
      EngagementCompletedSchema.parse({
        completion_type: 'full',
        completed_requirement_count: 7,
        spec_version: 1,
      }),
    ).toBeDefined();
  });
  it('rejects missing completion_type', () => {
    expect(() =>
      EngagementCompletedSchema.parse({
        completed_requirement_count: 7,
        spec_version: 1,
      }),
    ).toThrow();
  });
  it('rejects missing completed_requirement_count', () => {
    expect(() =>
      EngagementCompletedSchema.parse({
        completion_type: 'full',
        spec_version: 1,
      }),
    ).toThrow();
  });
});

describe('PaymentConfirmedSchema', () => {
  it('accepts a valid payload', () => {
    expect(
      PaymentConfirmedSchema.parse({
        amount: 1500,
        currency: 'USD',
        method: 'stripe',
        invoice_number: 'INV-000123',
        engagement_id: UUID,
        transaction_id: 'pi_abc',
      }),
    ).toBeDefined();
  });
  it('rejects wrong-length currency', () => {
    expect(() =>
      PaymentConfirmedSchema.parse({
        amount: 1500,
        currency: 'DOLLARS',
        method: 'stripe',
        invoice_number: 'INV-000123',
        engagement_id: UUID,
        transaction_id: 'pi_abc',
      }),
    ).toThrow();
  });
});

describe('MemberAddedSchema', () => {
  it('accepts a valid payload', () => {
    expect(
      MemberAddedSchema.parse({
        contact_id: UUID,
        role: 'member',
        ownership_pct: 50,
        is_primary: true,
        is_signer: true,
        added_by: 'admin:antonio',
      }),
    ).toBeDefined();
  });
  it('rejects ownership_pct > 100', () => {
    expect(() =>
      MemberAddedSchema.parse({
        contact_id: UUID,
        role: 'member',
        ownership_pct: 150,
        is_primary: false,
        is_signer: false,
        added_by: 'admin:antonio',
      }),
    ).toThrow();
  });
});

describe('DocumentUploadedSchema', () => {
  it('accepts nullable contact_id + account_id', () => {
    expect(
      DocumentUploadedSchema.parse({
        doc_type: 'passport',
        contact_id: null,
        account_id: null,
        file_path: '/tmp/x.pdf',
        uploaded_by: 'admin:antonio',
      }),
    ).toBeDefined();
  });
  it('rejects missing file_path', () => {
    expect(() =>
      DocumentUploadedSchema.parse({
        doc_type: 'passport',
        contact_id: null,
        account_id: null,
        uploaded_by: 'admin:antonio',
      }),
    ).toThrow();
  });
});

describe('RequirementSatisfiedSchema (F7 per-member)', () => {
  it('accepts per_member true with member_count', () => {
    expect(
      RequirementSatisfiedSchema.parse({
        requirement_key: 'member_passport',
        evidence_event_id: UUID,
        spec_id: UUID,
        per_member: true,
        all_members_satisfied: true,
        member_count: 3,
      }),
    ).toBeDefined();
  });
  it('accepts per_member false with null member_count', () => {
    expect(
      RequirementSatisfiedSchema.parse({
        requirement_key: 'state_filing',
        evidence_event_id: UUID,
        spec_id: UUID,
        per_member: false,
        all_members_satisfied: false,
        member_count: null,
      }),
    ).toBeDefined();
  });
});

describe('ExceptionApprovedSchema', () => {
  it('accepts null expires_at (no expiry)', () => {
    expect(
      ExceptionApprovedSchema.parse({
        requirement_key: 'member_passport',
        exception_type: 'missing_document',
        approved_by: 'admin:antonio',
        reason: 'Member travelling — signed affidavit received',
        expires_at: null,
        evidence: [UUID],
      }),
    ).toBeDefined();
  });
  it('rejects empty reason', () => {
    expect(() =>
      ExceptionApprovedSchema.parse({
        requirement_key: 'member_passport',
        exception_type: 'missing_document',
        approved_by: 'admin:antonio',
        reason: '',
        expires_at: null,
        evidence: [],
      }),
    ).toThrow();
  });
});

describe('AiDecisionSchema', () => {
  it('accepts a decision with string result', () => {
    expect(
      AiDecisionSchema.parse({
        question: 'Is this passport valid?',
        decision: 'yes',
        confidence: 0.93,
        reasoning: 'Name, photo, expiry check all pass',
        model: 'claude-sonnet-4-6',
        evidence_cited: ['doc:passport:abc'],
        tokens_input: 1500,
        tokens_output: 200,
        cached: false,
        scar_matches: [],
      }),
    ).toBeDefined();
  });
  it('rejects confidence > 1', () => {
    expect(() =>
      AiDecisionSchema.parse({
        question: 'q',
        decision: 'y',
        confidence: 1.5,
        reasoning: 'r',
        model: 'm',
        evidence_cited: [],
        tokens_input: 0,
        tokens_output: 0,
        cached: false,
        scar_matches: [],
      }),
    ).toThrow();
  });
});
