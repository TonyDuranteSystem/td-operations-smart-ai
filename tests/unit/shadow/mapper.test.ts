import { describe, it, expect } from 'vitest';
import { mapV1Webhook, ShadowMapError } from '@/lib/shadow/mapper';

const PAYMENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ACCOUNT_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

const paymentRecord = {
  id: PAYMENT_ID,
  account_id: ACCOUNT_ID,
  amount: 500,
  status: 'paid',
  created_at: '2026-04-24T10:00:00Z',
  updated_at: '2026-04-24T10:01:00Z',
};

const leadRecord = {
  id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  full_name: 'Test Lead',
  status: 'Offer Sent',
  converted_to_account_id: null,
  created_at: '2026-04-24T09:00:00Z',
  updated_at: '2026-04-24T09:00:00Z',
};

const activationRecord = {
  id: 'd4e5f6a7-b8c9-0123-defa-234567890123',
  lead_id: leadRecord.id,
  status: 'payment_confirmed',
  created_at: '2026-04-24T11:00:00Z',
  updated_at: '2026-04-24T11:00:00Z',
};

describe('mapV1Webhook — payments', () => {
  it('maps INSERT correctly', () => {
    const result = mapV1Webhook({ type: 'INSERT', table: 'payments', schema: 'public', record: paymentRecord, old_record: null });
    expect(result.event_type).toBe('v1.payment.created');
    expect(result.subject_type).toBe('v1_shadow.payment');
    expect(result.subject_id).toBe(PAYMENT_ID);
    expect(result.account_id).toBe(ACCOUNT_ID);
    expect(result.actor_type).toBe('v1_shadow');
    expect(result.actor_id).toBeNull();
    expect(result.caused_by).toEqual([]);
    expect(result.payload).toBe(paymentRecord);
  });

  it('maps UPDATE correctly', () => {
    const result = mapV1Webhook({ type: 'UPDATE', table: 'payments', schema: 'public', record: paymentRecord, old_record: { ...paymentRecord, status: 'pending' } });
    expect(result.event_type).toBe('v1.payment.updated');
  });

  it('builds stable idempotency key', () => {
    const r1 = mapV1Webhook({ type: 'INSERT', table: 'payments', schema: 'public', record: paymentRecord, old_record: null });
    const r2 = mapV1Webhook({ type: 'INSERT', table: 'payments', schema: 'public', record: paymentRecord, old_record: null });
    expect(r1.idempotency_key).toBe(r2.idempotency_key);
    expect(r1.idempotency_key).toContain(PAYMENT_ID);
    expect(r1.idempotency_key).toContain('INSERT');
  });

  it('account_id null when missing', () => {
    const result = mapV1Webhook({ type: 'INSERT', table: 'payments', schema: 'public', record: { ...paymentRecord, account_id: null }, old_record: null });
    expect(result.account_id).toBeNull();
  });
});

describe('mapV1Webhook — leads', () => {
  it('maps INSERT correctly', () => {
    const result = mapV1Webhook({ type: 'INSERT', table: 'leads', schema: 'public', record: leadRecord, old_record: null });
    expect(result.event_type).toBe('v1.lead.created');
    expect(result.subject_type).toBe('v1_shadow.lead');
    expect(result.account_id).toBeNull();
  });

  it('uses converted_to_account_id when present', () => {
    const result = mapV1Webhook({ type: 'UPDATE', table: 'leads', schema: 'public', record: { ...leadRecord, converted_to_account_id: ACCOUNT_ID }, old_record: leadRecord });
    expect(result.account_id).toBe(ACCOUNT_ID);
  });
});

describe('mapV1Webhook — pending_activations', () => {
  it('maps INSERT correctly', () => {
    const result = mapV1Webhook({ type: 'INSERT', table: 'pending_activations', schema: 'public', record: activationRecord, old_record: null });
    expect(result.event_type).toBe('v1.activation.created');
    expect(result.subject_type).toBe('v1_shadow.activation');
    expect(result.account_id).toBeNull();
  });
});

describe('mapV1Webhook — errors', () => {
  it('throws on null record', () => {
    expect(() => mapV1Webhook({ type: 'INSERT', table: 'payments', schema: 'public', record: null, old_record: null }))
      .toThrow(ShadowMapError);
  });

  it('throws on unsupported table', () => {
    expect(() => mapV1Webhook({ type: 'INSERT', table: 'contacts', schema: 'public', record: paymentRecord, old_record: null }))
      .toThrow(ShadowMapError);
  });

  it('throws on invalid subject_id', () => {
    expect(() => mapV1Webhook({ type: 'INSERT', table: 'payments', schema: 'public', record: { ...paymentRecord, id: 'not-a-uuid' }, old_record: null }))
      .toThrow(ShadowMapError);
  });
});
