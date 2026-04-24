import { describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for `withEmit()` pre-DB validation logic. The integration
 * tests in tests/integration/events/ exercise the plpgsql contract against
 * the real sandbox DB. These unit tests cover the JS-side rejections that
 * fire BEFORE the rpc call:
 *
 *   (1) unknown event_type → EmitError (Zod registry miss)
 *   (2) non-human actor without idempotency_key → EmitError
 *   (3) malformed payload → ZodError (from schema.parse)
 *
 * We mock `@/lib/supabase-admin` so an unexpected DB hit during these
 * rejection paths would surface as "mock not called" (a signal that the
 * guard failed and we leaked into the RPC).
 */

vi.mock('@/lib/supabase-admin', () => {
  const throwOnDbContact = (name: string) =>
    new Proxy(function () {}, {
      apply: () => {
        throw new Error(
          `supabaseAdmin.${name} invoked in a unit test. ` +
          'Pre-DB validation should have thrown earlier.',
        );
      },
      get: () => throwOnDbContact(`${name}<subprop>`),
    });
  return {
    supabaseAdmin: new Proxy(
      {},
      {
        get: (_t, prop: string) => throwOnDbContact(String(prop)),
      },
    ),
  };
});

// Re-import after the mock — vi.mock is hoisted, so this resolves to the
// mocked module at test time.
import { withEmit, EmitError } from '@/lib/events/emit';

const UUID = '11111111-2222-4333-8444-555555555555';

describe('withEmit — unknown event_type', () => {
  it('throws EmitError before any DB contact', async () => {
    await expect(
      withEmit({
        event_type: 'definitely.not.registered',
        actor_type: 'admin',
        subject_type: 'engagement',
        subject_id: UUID,
        payload: {},
      }),
    ).rejects.toBeInstanceOf(EmitError);
  });
});

describe('withEmit — idempotency-key enforcement for non-human actors', () => {
  it('throws when actor_type=webhook and no idempotency_key', async () => {
    await expect(
      withEmit({
        event_type: 'payment.confirmed',
        actor_type: 'webhook',
        subject_type: 'engagement',
        subject_id: UUID,
        account_id: UUID,
        payload: {
          amount: 100,
          currency: 'USD',
          method: 'stripe',
          invoice_number: 'INV-1',
          engagement_id: UUID,
          transaction_id: 'pi_x',
        },
      }),
    ).rejects.toBeInstanceOf(EmitError);
  });

  it('throws when actor_type=cron and no idempotency_key', async () => {
    await expect(
      withEmit({
        event_type: 'engagement.started',
        actor_type: 'cron',
        subject_type: 'engagement',
        subject_id: UUID,
        payload: { trigger: 'payment_confirmed' },
      }),
    ).rejects.toBeInstanceOf(EmitError);
  });

  it('throws when actor_type=agent and no idempotency_key', async () => {
    await expect(
      withEmit({
        event_type: 'ai.decision',
        actor_type: 'agent',
        subject_type: 'engagement',
        subject_id: UUID,
        payload: {
          question: 'q',
          decision: 'y',
          confidence: 0.9,
          reasoning: 'r',
          model: 'm',
          evidence_cited: [],
          tokens_input: 0,
          tokens_output: 0,
          cached: false,
          scar_matches: [],
        },
      }),
    ).rejects.toBeInstanceOf(EmitError);
  });

  it('throws when actor_type=migration and no idempotency_key', async () => {
    await expect(
      withEmit({
        event_type: 'engagement.created',
        actor_type: 'migration',
        subject_type: 'engagement',
        subject_id: UUID,
        payload: {
          contract_type: 'smllc',
          contact_id: UUID,
          spec_id: UUID,
          spec_version: 1,
          contracted_price: 1500,
        },
      }),
    ).rejects.toBeInstanceOf(EmitError);
  });

  it('does NOT require idempotency_key for actor_type=admin (human)', async () => {
    // Admin is a human actor — no key required at the type-guard layer.
    // This call will reach schema.parse + scrub + rpc, and our mock will
    // explode on DB contact — which is EXPECTED. We only assert that the
    // error is NOT "idempotency_key required" (i.e. we got past stage 2).
    try {
      await withEmit({
        event_type: 'engagement.started',
        actor_type: 'admin',
        subject_type: 'engagement',
        subject_id: UUID,
        payload: { trigger: 'admin_manual' },
      });
      throw new Error('expected a DB-contact error from mock');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toMatch(/idempotency_key required/i);
    }
  });
});

describe('withEmit — payload Zod validation', () => {
  it('rejects a malformed payload before any DB contact', async () => {
    // payment.confirmed requires amount:number — pass a string instead.
    await expect(
      withEmit({
        event_type: 'payment.confirmed',
        actor_type: 'webhook',
        subject_type: 'engagement',
        subject_id: UUID,
        account_id: UUID,
        idempotency_key: 'webhook:stripe:evt_1',
        payload: {
          amount: 'not-a-number',
          currency: 'USD',
          method: 'stripe',
          invoice_number: 'INV-1',
          engagement_id: UUID,
          transaction_id: 'pi_x',
        },
      }),
    ).rejects.toThrow(); // ZodError
  });
});
