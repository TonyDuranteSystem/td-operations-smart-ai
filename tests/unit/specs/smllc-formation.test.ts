import { describe, expect, it } from 'vitest';
import { smllcFormation } from '@/lib/specs/smllc-formation';
import {
  defineSpec,
  ReqGate,
  ReqData,
  ReqDeliverable,
  SpecSchema,
  SpecValidationError,
} from '@/lib/specs/types';

describe('smllcFormation spec', () => {
  it('is Zod-valid', () => {
    // Re-parse to catch any drift between constructor-time validation
    // and the top-level schema. Should be a no-op given defineSpec already
    // ran at module load, but explicit is better than implicit.
    expect(() => SpecSchema.parse(smllcFormation)).not.toThrow();
  });

  it('declares contract_type smllc_formation at version 1', () => {
    expect(smllcFormation.contract_type).toBe('smllc_formation');
    expect(smllcFormation.version).toBe(1);
  });

  it('has exactly 7 requirements', () => {
    expect(smllcFormation.requirements).toHaveLength(7);
  });

  it('has each of the expected requirement keys', () => {
    const keys = smllcFormation.requirements.map(r => r.key).sort();
    expect(keys).toEqual([
      'company_name',
      'ein',
      'member_passport',
      'operating_agreement',
      'payment_gate',
      'state_filing',
      'state_of_formation',
    ]);
  });

  it('payment_gate is a gate with blocks=["*"]', () => {
    const gate = smllcFormation.requirements.find(r => r.key === 'payment_gate');
    expect(gate).toBeDefined();
    expect(gate!.kind).toBe('gate');
    expect(gate!.blocks).toEqual(['*']);
  });

  it('company_name has when_account_null fallback into engagement metadata', () => {
    const r = smllcFormation.requirements.find(r => r.key === 'company_name');
    expect(r).toBeDefined();
    expect(r!.kind).toBe('data');
    // TS narrows via the discriminated union once kind is checked.
    if (r!.kind !== 'data') throw new Error('wrong kind');
    expect(r.condition.when_account_null).toBe('engagement.metadata.company_name');
  });

  it('state_of_formation has when_account_null fallback', () => {
    const r = smllcFormation.requirements.find(r => r.key === 'state_of_formation');
    expect(r).toBeDefined();
    if (r!.kind !== 'data') throw new Error('wrong kind');
    expect(r.condition.when_account_null).toBe('engagement.metadata.state_of_formation');
    expect(r.condition.in).toEqual(['New Mexico', 'Wyoming', 'Delaware', 'Florida', 'Nevada']);
  });

  it('member_passport is a per_member document requirement', () => {
    const r = smllcFormation.requirements.find(r => r.key === 'member_passport');
    expect(r).toBeDefined();
    expect(r!.kind).toBe('document');
    if (r!.kind !== 'document') throw new Error('wrong kind');
    expect(r.per_member).toBe(true);
    expect(r.doc_type).toBe('passport');
  });

  it('state_filing depends on company_name, state_of_formation, member_passport', () => {
    const r = smllcFormation.requirements.find(r => r.key === 'state_filing');
    expect(r).toBeDefined();
    expect([...r!.depends_on].sort()).toEqual([
      'company_name',
      'member_passport',
      'state_of_formation',
    ]);
  });

  it('ein depends on state_filing and requires_signer', () => {
    const r = smllcFormation.requirements.find(r => r.key === 'ein');
    expect(r).toBeDefined();
    expect(r!.depends_on).toEqual(['state_filing']);
    expect(r!.requires_signer).toBe(true);
  });

  it('operating_agreement depends on company_name, state_of_formation, member_passport', () => {
    const r = smllcFormation.requirements.find(r => r.key === 'operating_agreement');
    expect(r).toBeDefined();
    expect([...r!.depends_on].sort()).toEqual([
      'company_name',
      'member_passport',
      'state_of_formation',
    ]);
  });

  it('pricing_rules contain base price and per-state filing fees', () => {
    const pricing = smllcFormation.pricing_rules as {
      base_price_usd: number;
      by_state: Record<string, { filing_fee: number }>;
    };
    expect(pricing.base_price_usd).toBeGreaterThan(0);
    // Every state listed as allowed by state_of_formation must have a fee.
    const r = smllcFormation.requirements.find(x => x.key === 'state_of_formation');
    if (r!.kind !== 'data') throw new Error('wrong kind');
    const allowed = r.condition.in ?? [];
    for (const state of allowed) {
      expect(pricing.by_state[state]?.filing_fee).toBeGreaterThan(0);
    }
  });
});

describe('defineSpec — dependency graph validation', () => {
  it('rejects a spec that references an undefined dependency', () => {
    expect(() =>
      defineSpec({
        contract_type: 'test-broken-dep',
        display_name: 'Broken Dep',
        version: 1,
        requirements: [
          ReqDeliverable({
            key: 'a',
            depends_on: ['missing_key'],
            condition: { event_type: 'whatever.happened' },
          }),
        ],
      }),
    ).toThrow(SpecValidationError);
  });

  it('rejects a direct cycle (a → a)', () => {
    expect(() =>
      defineSpec({
        contract_type: 'test-self-cycle',
        display_name: 'Self Cycle',
        version: 1,
        requirements: [
          ReqDeliverable({
            key: 'a',
            depends_on: ['a'],
            condition: { event_type: 'x.y' },
          }),
        ],
      }),
    ).toThrow(/cycle/i);
  });

  it('rejects a two-node cycle (a ↔ b)', () => {
    expect(() =>
      defineSpec({
        contract_type: 'test-cycle-2',
        display_name: 'Cycle 2',
        version: 1,
        requirements: [
          ReqDeliverable({ key: 'a', depends_on: ['b'], condition: { event_type: 'x' } }),
          ReqDeliverable({ key: 'b', depends_on: ['a'], condition: { event_type: 'x' } }),
        ],
      }),
    ).toThrow(/cycle/i);
  });

  it('rejects a three-node cycle (a → b → c → a)', () => {
    expect(() =>
      defineSpec({
        contract_type: 'test-cycle-3',
        display_name: 'Cycle 3',
        version: 1,
        requirements: [
          ReqDeliverable({ key: 'a', depends_on: ['b'], condition: { event_type: 'x' } }),
          ReqDeliverable({ key: 'b', depends_on: ['c'], condition: { event_type: 'x' } }),
          ReqDeliverable({ key: 'c', depends_on: ['a'], condition: { event_type: 'x' } }),
        ],
      }),
    ).toThrow(/cycle/i);
  });

  it('rejects duplicate requirement keys', () => {
    expect(() =>
      defineSpec({
        contract_type: 'test-dup-key',
        display_name: 'Duplicate Key',
        version: 1,
        requirements: [
          ReqData({ key: 'dup', condition: { field: 'x.y', not_null: true } }),
          ReqData({ key: 'dup', condition: { field: 'x.z', not_null: true } }),
        ],
      }),
    ).toThrow(/duplicate requirement key/i);
  });

  it('accepts a linear DAG', () => {
    expect(() =>
      defineSpec({
        contract_type: 'test-linear',
        display_name: 'Linear',
        version: 1,
        requirements: [
          ReqGate({
            key: 'gate',
            blocks: ['*'],
            condition: { event_type: 'payment.confirmed' },
          }),
          ReqData({ key: 'a', condition: { field: 'x.y', not_null: true } }),
          ReqDeliverable({ key: 'b', depends_on: ['a'], condition: { event_type: 'x.y' } }),
          ReqDeliverable({ key: 'c', depends_on: ['b'], condition: { event_type: 'x.z' } }),
        ],
      }),
    ).not.toThrow();
  });
});
