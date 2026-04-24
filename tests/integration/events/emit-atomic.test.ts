/**
 * Integration tests for `emit_event_atomic()` DB contract.
 *
 * These tests hit the Smart AI SANDBOX via direct pg connection. They verify
 * the plpgsql behaviour that `withEmit()` in lib/events/emit.ts depends on:
 *   - Happy path: events + outbox rows land; returns event_id.
 *   - Unknown p_entity_table → RAISE.
 *   - Unknown p_entity_update field → RAISE (engagements + exceptions).
 *   - Duplicate idempotency_key → returns the FIRST event_id, no new row.
 *   - Concurrent emits with same key (Promise.all) → both same event_id.
 *   - entityWrite omitted (NULL p_entity_table) → event inserted, no UPDATE.
 *
 * Requires SUPABASE_DB_URL pointed at the Smart AI sandbox. Skips the suite
 * if absent — local devs who haven't configured it still get a clean run.
 *
 * Guard: the connection string MUST contain the sandbox ref
 * `tapbgvbglqacamhayfel` AND must not contain any v1 ref. If these guards
 * trip, the test suite aborts rather than silently hitting the wrong DB.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  FORBIDDEN_SUPABASE_REFS,
  SANDBOX_SUPABASE_REF,
  PROD_SUPABASE_REF,
} from '@/lib/config';

const DB_URL = process.env.SUPABASE_DB_URL;

/**
 * `describe.skipIf` skips the entire suite when DB_URL is absent. The
 * boolean must be stable — we read env once here.
 */
const SHOULD_SKIP = !DB_URL;

describe.skipIf(SHOULD_SKIP)('emit_event_atomic DB contract', () => {
  let client: Client;

  // Shared test fixtures created once per run and cleaned up at the end.
  // Using UUIDs generated per run keeps tests parallel-safe.
  const runTag = `s0.3-it-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  let testContactId: string;
  let testAccountId: string;
  let testSpecId: string;
  const testEngagementIds: string[] = [];
  const testExceptionIds: string[] = [];

  beforeAll(async () => {
    if (!DB_URL) return;

    // Connection-string guards — identical policy to scripts/apply-migrations.ts.
    for (const forbidden of FORBIDDEN_SUPABASE_REFS) {
      if (DB_URL.includes(forbidden)) {
        throw new Error(
          `Integration tests refuse to run: SUPABASE_DB_URL contains v1 ref "${forbidden}".`,
        );
      }
    }
    if (!DB_URL.includes(SANDBOX_SUPABASE_REF)) {
      throw new Error(
        `Integration tests target SANDBOX only. SUPABASE_DB_URL must contain "${SANDBOX_SUPABASE_REF}".`,
      );
    }
    if (DB_URL.includes(PROD_SUPABASE_REF)) {
      throw new Error(
        `Integration tests refuse: SUPABASE_DB_URL contains Smart AI PROD ref "${PROD_SUPABASE_REF}". Use sandbox.`,
      );
    }

    client = new Client({ connectionString: DB_URL });
    await client.connect();

    // Minimal fixtures — schema already live from migration 002/003.
    // contact_id required on engagements; we create a throwaway contact.
    const contactRes = await client.query<{ id: string }>(
      `INSERT INTO contacts (preferred_language, metadata)
       VALUES ('en', $1::jsonb)
       RETURNING id`,
      [JSON.stringify({ test_tag: runTag })],
    );
    testContactId = contactRes.rows[0]!.id;

    const accountRes = await client.query<{ id: string }>(
      `INSERT INTO accounts (company_name, entity_type, metadata)
       VALUES ($1, 'llc', $2::jsonb)
       RETURNING id`,
      [`Test LLC ${runTag}`, JSON.stringify({ test_tag: runTag })],
    );
    testAccountId = accountRes.rows[0]!.id;

    // service_specs row required for engagements.spec_id FK (if FK exists).
    // Use a minimal valid insert.
    const specRes = await client.query<{ id: string }>(
      `INSERT INTO service_specs (contract_type, spec_json, version, is_active)
       VALUES ($1, '{}'::jsonb, 1, false)
       ON CONFLICT (contract_type, version) DO UPDATE SET spec_json = EXCLUDED.spec_json
       RETURNING id`,
      [`test-${runTag}`],
    );
    testSpecId = specRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (!DB_URL || !client) return;
    try {
      // Clean up engagement, exception, events, outbox rows by tag.
      for (const id of testEngagementIds) {
        await client.query(`DELETE FROM outbox WHERE subject_id = $1`, [id]);
        await client.query(`DELETE FROM events WHERE subject_id = $1`, [id]);
        await client.query(`DELETE FROM engagements WHERE id = $1`, [id]);
      }
      for (const id of testExceptionIds) {
        await client.query(`DELETE FROM outbox WHERE subject_id = $1`, [id]);
        await client.query(`DELETE FROM events WHERE subject_id = $1`, [id]);
        await client.query(`DELETE FROM exceptions WHERE id = $1`, [id]);
      }
      if (testAccountId) {
        await client.query(`DELETE FROM accounts WHERE id = $1`, [testAccountId]);
      }
      if (testContactId) {
        await client.query(`DELETE FROM contacts WHERE id = $1`, [testContactId]);
      }
      if (testSpecId) {
        await client.query(`DELETE FROM service_specs WHERE id = $1`, [testSpecId]);
      }
    } finally {
      await client.end();
    }
  });

  async function createTestEngagement(): Promise<string> {
    const res = await client.query<{ id: string }>(
      `INSERT INTO engagements
         (account_id, contact_id, contract_type, spec_id, spec_version_id, status, metadata)
       VALUES ($1, $2, 'test', $3, $4, 'active', $5::jsonb)
       RETURNING id`,
      [
        testAccountId,
        testContactId,
        `test-spec-${runTag}`,
        testSpecId,
        JSON.stringify({ test_tag: runTag }),
      ],
    );
    const id = res.rows[0]!.id;
    testEngagementIds.push(id);
    return id;
  }

  async function createTestException(engagementId: string): Promise<string> {
    const res = await client.query<{ id: string }>(
      `INSERT INTO exceptions
         (engagement_id, requirement_key, exception_type, status, reason)
       VALUES ($1, 'test_req', 'waiver', 'pending', $2)
       RETURNING id`,
      [engagementId, `integration-test-${runTag}`],
    );
    const id = res.rows[0]!.id;
    testExceptionIds.push(id);
    return id;
  }

  // -------------------------------------------------------------------------

  it('happy path — writes events + outbox rows and returns event_id', async () => {
    const engagementId = await createTestEngagement();
    const idempotencyKey = `it:happy:${runTag}:${engagementId}`;

    // Engagement starts at 'active'; whitelist covers status / started_at / completed_at.
    // Transition 'active' → 'completed' to observe an entity mutation.
    const completedAt = new Date().toISOString();
    const res = await client.query<{ event_id: string }>(
      `SELECT emit_event_atomic(
         $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9::jsonb, $10
       ) AS event_id`,
      [
        'engagements',
        engagementId,
        JSON.stringify({ status: 'completed', completed_at: completedAt }),
        'engagement.completed',
        'inngest',
        'engagement',
        engagementId,
        testAccountId,
        JSON.stringify({
          completion_type: 'full',
          completed_requirement_count: 5,
          spec_version: 1,
        }),
        idempotencyKey,
      ],
    );
    const eventId = res.rows[0]!.event_id;
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/i);

    const eventRow = await client.query(
      `SELECT id, event_type, subject_id, account_id, idempotency_key
       FROM events WHERE id = $1`,
      [eventId],
    );
    expect(eventRow.rowCount).toBe(1);
    expect(eventRow.rows[0]!.event_type).toBe('engagement.completed');
    expect(eventRow.rows[0]!.subject_id).toBe(engagementId);
    expect(eventRow.rows[0]!.account_id).toBe(testAccountId);
    expect(eventRow.rows[0]!.idempotency_key).toBe(idempotencyKey);

    const outboxRow = await client.query(
      `SELECT status, event_type, subject_type, subject_id, account_id
       FROM outbox WHERE event_id = $1`,
      [eventId],
    );
    expect(outboxRow.rowCount).toBe(1);
    expect(outboxRow.rows[0]!.status).toBe('pending');
    expect(outboxRow.rows[0]!.subject_type).toBe('engagement');

    // Entity update applied.
    const engRow = await client.query(
      `SELECT status, completed_at FROM engagements WHERE id = $1`,
      [engagementId],
    );
    expect(engRow.rows[0]!.status).toBe('completed');
    expect(engRow.rows[0]!.completed_at).not.toBeNull();
  });

  it('unknown p_entity_table → RAISES', async () => {
    await expect(
      client.query(
        `SELECT emit_event_atomic(
           'not_a_table'::TEXT,
           gen_random_uuid(),
           '{"status":"active"}'::jsonb,
           'engagement.started',
           'inngest',
           'engagement',
           gen_random_uuid(),
           NULL,
           '{"trigger":"payment_confirmed"}'::jsonb,
           NULL
         )`,
      ),
    ).rejects.toThrow(/unsupported entity table/i);
  });

  it('unknown field in engagements update → RAISES', async () => {
    const engagementId = await createTestEngagement();
    await expect(
      client.query(
        `SELECT emit_event_atomic(
           'engagements',
           $1,
           $2::jsonb,
           'engagement.started',
           'inngest',
           'engagement',
           $1,
           $3,
           '{"trigger":"payment_confirmed"}'::jsonb,
           NULL
         )`,
        [engagementId, JSON.stringify({ not_a_field: 'x' }), testAccountId],
      ),
    ).rejects.toThrow(/unsupported engagements field/i);
  });

  it('unknown field in exceptions update → RAISES', async () => {
    const engagementId = await createTestEngagement();
    const exceptionId = await createTestException(engagementId);
    await expect(
      client.query(
        `SELECT emit_event_atomic(
           'exceptions',
           $1,
           $2::jsonb,
           'exception.approved',
           'admin',
           'exception',
           $1,
           NULL,
           '{"foo":"bar"}'::jsonb,
           NULL
         )`,
        [exceptionId, JSON.stringify({ unknown_field: 'x' })],
      ),
    ).rejects.toThrow(/unsupported exceptions field/i);
  });

  it('duplicate idempotency_key → returns the SAME event_id; no second row', async () => {
    const engagementId = await createTestEngagement();
    const key = `it:dup:${runTag}:${engagementId}`;

    const first = await client.query<{ event_id: string }>(
      `SELECT emit_event_atomic(
         'engagements', $1, $2::jsonb, 'engagement.started', 'inngest', 'engagement', $1, $3,
         $4::jsonb, $5
       ) AS event_id`,
      [
        engagementId,
        JSON.stringify({ status: 'active' }),
        testAccountId,
        JSON.stringify({ trigger: 'payment_confirmed' }),
        key,
      ],
    );
    const firstId = first.rows[0]!.event_id;

    const second = await client.query<{ event_id: string }>(
      `SELECT emit_event_atomic(
         'engagements', $1, $2::jsonb, 'engagement.started', 'inngest', 'engagement', $1, $3,
         $4::jsonb, $5
       ) AS event_id`,
      [
        engagementId,
        JSON.stringify({ status: 'active' }),
        testAccountId,
        JSON.stringify({ trigger: 'payment_confirmed' }),
        key,
      ],
    );
    expect(second.rows[0]!.event_id).toBe(firstId);

    const countRes = await client.query<{ c: string }>(
      `SELECT count(*) AS c FROM events WHERE idempotency_key = $1`,
      [key],
    );
    expect(Number(countRes.rows[0]!.c)).toBe(1);
  });

  it('concurrent emit with same idempotency_key → both calls return same event_id', async () => {
    const engagementId = await createTestEngagement();
    const key = `it:race:${runTag}:${engagementId}`;

    // Use TWO separate client connections for true concurrency — a single pg
    // Client serialises queries, which would defeat the race.
    const clientA = new Client({ connectionString: DB_URL });
    const clientB = new Client({ connectionString: DB_URL });
    await Promise.all([clientA.connect(), clientB.connect()]);

    try {
      const [resA, resB] = await Promise.all([
        clientA.query<{ event_id: string }>(
          `SELECT emit_event_atomic(
             'engagements', $1, $2::jsonb, 'engagement.started', 'inngest', 'engagement', $1, $3,
             $4::jsonb, $5
           ) AS event_id`,
          [
            engagementId,
            JSON.stringify({ status: 'active' }),
            testAccountId,
            JSON.stringify({ trigger: 'payment_confirmed' }),
            key,
          ],
        ),
        clientB.query<{ event_id: string }>(
          `SELECT emit_event_atomic(
             'engagements', $1, $2::jsonb, 'engagement.started', 'inngest', 'engagement', $1, $3,
             $4::jsonb, $5
           ) AS event_id`,
          [
            engagementId,
            JSON.stringify({ status: 'active' }),
            testAccountId,
            JSON.stringify({ trigger: 'payment_confirmed' }),
            key,
          ],
        ),
      ]);

      expect(resA.rows[0]!.event_id).toBe(resB.rows[0]!.event_id);

      const countRes = await client.query<{ c: string }>(
        `SELECT count(*) AS c FROM events WHERE idempotency_key = $1`,
        [key],
      );
      expect(Number(countRes.rows[0]!.c)).toBe(1);
    } finally {
      await Promise.all([clientA.end(), clientB.end()]);
    }
  });

  it('entityWrite omitted (NULL p_entity_table) → event inserted, no entity mutation', async () => {
    const engagementId = await createTestEngagement();
    const key = `it:no-entity:${runTag}:${engagementId}`;

    const before = await client.query(
      `SELECT status, started_at FROM engagements WHERE id = $1`,
      [engagementId],
    );
    const beforeStatus = before.rows[0]!.status;
    const beforeStarted = before.rows[0]!.started_at;

    const res = await client.query<{ event_id: string }>(
      `SELECT emit_event_atomic(
         NULL, NULL, NULL,
         'requirement.satisfied',
         'inngest',
         'engagement',
         $1,
         $2,
         $3::jsonb,
         $4
       ) AS event_id`,
      [
        engagementId,
        testAccountId,
        JSON.stringify({
          requirement_key: 'payment_gate',
          evidence_event_id: '00000000-0000-4000-8000-000000000001',
          spec_id: testSpecId,
          per_member: false,
          all_members_satisfied: true,
          member_count: null,
        }),
        key,
      ],
    );
    const eventId = res.rows[0]!.event_id;
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/i);

    // Engagement row unchanged.
    const after = await client.query(
      `SELECT status, started_at FROM engagements WHERE id = $1`,
      [engagementId],
    );
    expect(after.rows[0]!.status).toBe(beforeStatus);
    expect(String(after.rows[0]!.started_at)).toBe(String(beforeStarted));

    // Outbox row was still enqueued.
    const outbox = await client.query(
      `SELECT count(*) AS c FROM outbox WHERE event_id = $1 AND status = 'pending'`,
      [eventId],
    );
    expect(Number(outbox.rows[0]!.c)).toBe(1);
  });
});
