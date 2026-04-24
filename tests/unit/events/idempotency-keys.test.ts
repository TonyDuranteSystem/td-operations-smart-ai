import { describe, expect, it } from 'vitest';
import {
  webhookIdempotencyKey,
  cronIdempotencyKey,
  inngestIdempotencyKey,
  agentEvalIdempotencyKey,
  manualIdempotencyKey,
  migrationIdempotencyKey,
} from '@/lib/events/idempotency-keys';

describe('idempotency-key factories', () => {
  it('webhookIdempotencyKey composes namespace + provider + id', () => {
    expect(webhookIdempotencyKey('stripe', 'evt_123')).toBe('webhook:stripe:evt_123');
  });

  it('cronIdempotencyKey composes namespace + job + bucket', () => {
    expect(cronIdempotencyKey('outbox-drain', '2026-04-23T14:00')).toBe(
      'cron:outbox-drain:2026-04-23T14:00',
    );
  });

  it('inngestIdempotencyKey composes namespace + function + entity id', () => {
    expect(inngestIdempotencyKey('activate-engagement', 'eng-1')).toBe(
      'inngest:activate-engagement:eng-1',
    );
  });

  it('agentEvalIdempotencyKey includes context fingerprint', () => {
    expect(agentEvalIdempotencyKey('eng-1', 'req-1', 'fp-abc')).toBe(
      'agent:eval:eng-1:req-1:fp-abc',
    );
  });

  it('manualIdempotencyKey composes namespace + user + hash', () => {
    expect(manualIdempotencyKey('user-1', 'h1')).toBe('manual:user-1:h1');
  });

  it('migrationIdempotencyKey composes namespace + name + record', () => {
    expect(migrationIdempotencyKey('m001', 'rec-1')).toBe('migration:m001:rec-1');
  });

  it('different namespaces produce different keys for identical suffixes', () => {
    const a = webhookIdempotencyKey('stripe', 'same-id');
    const b = cronIdempotencyKey('stripe', 'same-id');
    expect(a).not.toBe(b);
  });
});
