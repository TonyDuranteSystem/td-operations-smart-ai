-- 003_event_subsystem.sql
-- Event log + outbox + emit_event_atomic() + claim_outbox_batch().
-- Architecture §5.1-§5.4, locked at v1.5 (six adversarial review rounds).
-- EVERY line here matches the architecture contract. Do not simplify or
-- reorder — the ordering carries correctness (e.g. idempotency check FIRST).
--
-- Must run AFTER 002_entity_graph.sql (references engagements) and
-- 005_agent_solver.sql (references exceptions). Apply order is lexicographic
-- by number, so 005 lands after 003 — do NOT move the ELSIF branch for
-- 'exceptions' until 005 has also been applied. To resolve: apply 002 and
-- 005 first, then 003, OR accept that the exceptions ELSIF branch will fail
-- only if called before 005 ships. Since emit_event_atomic is never called
-- during migrations (only by runtime), this ordering is fine.

-- ---------------------------------------------------------------------------
-- events — append-only. Denormalized account_id and expanded actor_type
-- CHECK per F2/Round 5. idempotency_key UNIQUE blocks duplicates from
-- webhook retries and AI proposal re-runs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT NOT NULL,
  subject_type      TEXT NOT NULL,
  subject_id        UUID NOT NULL,
  account_id        UUID,
  actor_type        TEXT NOT NULL
                      CHECK (actor_type IN ('human','agent','webhook','cron','system','migration','inngest','admin')),
  actor_id          TEXT,
  payload           JSONB NOT NULL,
  caused_by         UUID[] NOT NULL DEFAULT '{}',
  idempotency_key   TEXT UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_subject ON events(subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type    ON events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_actor   ON events(actor_type, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_account ON events(account_id, created_at DESC) WHERE account_id IS NOT NULL;

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- service_role only. Per-user read access is added in the Realtime / portal phase
-- when subscription channels are defined (architecture §5.2 engagement-scoped channels).
CREATE POLICY "events_service_role" ON events
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- outbox — transactional outbox for at-least-once delivery to Inngest +
-- Realtime. Denormalizes subject_type/subject_id/account_id so the drain
-- doesn't JOIN events for channel routing. event_id UNIQUE prevents double
-- enqueuing from concurrent emit_event_atomic retries.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL UNIQUE REFERENCES events(id),
  event_type      TEXT NOT NULL,
  subject_type    TEXT NOT NULL,
  subject_id      UUID NOT NULL,
  account_id      UUID,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','publishing','published','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  published_at    TIMESTAMPTZ,
  locked_at       TIMESTAMPTZ,
  locked_by       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending    ON outbox(created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbox_publishing ON outbox(locked_at)  WHERE status = 'publishing';

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outbox_service_role" ON outbox
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- emit_event_atomic() — THE ONLY function that writes to events/outbox.
-- Architecture §5.4 (v1.5 locked). Postgres wraps the entire plpgsql body in
-- an implicit transaction; no client-side BEGIN/COMMIT needed.
--
-- Contract (do not change without an adversarial review round):
--   1. Idempotency check runs FIRST — before any entity mutation.
--      Retry with same key returns existing event_id and touches NOTHING.
--   2. Entity table whitelist: 'engagements', 'exceptions'. Any other value
--      hits ELSE RAISE. Do not add a table without adding an ELSIF branch
--      AND a per-field whitelist AND updating SupportedEntityTable in
--      lib/events/emit.ts (CI assertion enforces the sync).
--   3. Per-branch field whitelist: unknown JSONB keys RAISE — not silently
--      dropped by COALESCE. A caller passing {metadata: {...}} to the
--      engagements branch raises immediately.
--   4. UPDATE only, never INSERT. Creating a new row (e.g. payments) is a
--      direct supabase call in the Inngest step; then withEmit() without
--      entityWrite emits the event with p_entity_table = NULL.
--   5. INSERT ... ON CONFLICT (idempotency_key) DO NOTHING + re-SELECT
--      handles two simultaneous retries safely.
--   6. Outbox INSERT is idempotent via ON CONFLICT (event_id) DO NOTHING.
--   7. REVOKE FROM PUBLIC, anon, authenticated; GRANT TO service_role.
--      Re-apply on every migration that recreates the function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION emit_event_atomic(
  p_entity_table     TEXT,
  p_entity_pk        UUID,
  p_entity_update    JSONB,
  p_event_type       TEXT,
  p_actor_type       TEXT,
  p_subject_type     TEXT,
  p_subject_id       UUID,
  p_account_id       UUID,
  p_payload          JSONB,
  p_idempotency_key  TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
-- SET search_path is a security hardening against function-hijacking via
-- schema shadowing. Without it, a DEFINER function can be tricked into
-- resolving unqualified table names against a malicious schema.
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  -- 1. IDEMPOTENCY CHECK FIRST (F1/Round 5).
  --    v1.3 ran UPDATE before this check; a retried webhook with the same
  --    key would mutate the entity even if the event already existed —
  --    silently overwriting state changes between the original call and
  --    the retry.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_event_id FROM events WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_event_id;
    END IF;
  END IF;

  v_event_id := gen_random_uuid();

  -- 2. Apply entity update — supported tables only, no dynamic SQL.
  --    Two enforcement layers (R6-F1):
  --    (a) ELSE clause: any p_entity_table outside the ladder RAISES.
  --        Without ELSE, the function would fall through, emit the event,
  --        fire the outbox — but the DB row was never touched.
  --    (b) Per-branch field whitelist: unknown JSONB keys RAISE.
  --        COALESCE would silently drop them.
  IF p_entity_table IS NOT NULL THEN
    IF p_entity_table = 'engagements' THEN
      IF (p_entity_update - ARRAY['status', 'started_at', 'completed_at']) <> '{}'::jsonb THEN
        RAISE EXCEPTION
          'emit_event_atomic: unsupported engagements field(s): %. Add to whitelist.',
          (p_entity_update - ARRAY['status', 'started_at', 'completed_at'])::text;
      END IF;
      UPDATE engagements
      SET status       = COALESCE((p_entity_update->>'status'), status),
          started_at   = COALESCE((p_entity_update->>'started_at')::TIMESTAMPTZ, started_at),
          completed_at = COALESCE((p_entity_update->>'completed_at')::TIMESTAMPTZ, completed_at)
      WHERE id = p_entity_pk;

    ELSIF p_entity_table = 'exceptions' THEN
      IF (p_entity_update - ARRAY['status', 'expired_at']) <> '{}'::jsonb THEN
        RAISE EXCEPTION
          'emit_event_atomic: unsupported exceptions field(s): %. Add to whitelist.',
          (p_entity_update - ARRAY['status', 'expired_at'])::text;
      END IF;
      UPDATE exceptions
      SET status     = COALESCE((p_entity_update->>'status'), status),
          expired_at = COALESCE((p_entity_update->>'expired_at')::TIMESTAMPTZ, expired_at)
      WHERE id = p_entity_pk;

    -- ADD NEW BRANCHES HERE. Each branch: field whitelist CHECK, then UPDATE.
    -- Adding a branch requires: (1) ELSIF above, (2) SupportedEntityTable
    -- union in lib/events/emit.ts, (3) scripts/assert-entity-table-sync.ts
    -- CI assertion passes.

    ELSE
      -- Unknown table — abort. Do NOT fall through.
      RAISE EXCEPTION
        'emit_event_atomic: unsupported entity table "%". Add a branch to this function and update SupportedEntityTable in lib/events/emit.ts.',
        p_entity_table;
    END IF;
  END IF;

  -- 3. Insert event. ON CONFLICT handles concurrent retries (F8/Round 5):
  --    two simultaneous webhook retries both pass the SELECT above (neither
  --    finds a row); both attempt INSERT; one hits the UNIQUE constraint.
  --    DO NOTHING is safe because we re-SELECT below to get the winner.
  INSERT INTO events (id, event_type, actor_type, subject_type, subject_id, account_id, payload, idempotency_key)
  VALUES (v_event_id, p_event_type, p_actor_type, p_subject_type, p_subject_id, p_account_id, p_payload, p_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- Re-SELECT if INSERT lost the race.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_event_id FROM events WHERE idempotency_key = p_idempotency_key;
  END IF;

  -- 4. Enqueue for outbox drain. ON CONFLICT (event_id) DO NOTHING makes
  --    this step idempotent too — if the outbox row already exists (e.g.
  --    from a prior retry that got past the events INSERT but failed
  --    before the outbox INSERT), skip.
  INSERT INTO outbox (event_id, event_type, subject_type, subject_id, account_id, status)
  VALUES (v_event_id, p_event_type, p_subject_type, p_subject_id, p_account_id, 'pending')
  ON CONFLICT (event_id) DO NOTHING;

  RETURN v_event_id;
END;
$$;

-- F9/Round 5: SECURITY DEFINER + no REVOKE = any authenticated portal user
-- can call emit_event_atomic directly and bypass RLS on every supported
-- entity table. Lock it down to service_role (server-side withEmit only).
-- Re-apply every time this function is recreated.
REVOKE EXECUTE ON FUNCTION emit_event_atomic(TEXT,UUID,JSONB,TEXT,TEXT,TEXT,UUID,UUID,JSONB,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_event_atomic(TEXT,UUID,JSONB,TEXT,TEXT,TEXT,UUID,UUID,JSONB,TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION emit_event_atomic(TEXT,UUID,JSONB,TEXT,TEXT,TEXT,UUID,UUID,JSONB,TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION emit_event_atomic(TEXT,UUID,JSONB,TEXT,TEXT,TEXT,UUID,UUID,JSONB,TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- claim_outbox_batch — atomic FIFO claim for drain workers.
-- FOR UPDATE SKIP LOCKED lets multiple concurrent workers (primary Inngest
-- + fallback Vercel cron) grab disjoint row sets with no waits, no deadlocks.
-- locked_by = pg_backend_pid() for diagnostic tracking only — uniqueness
-- across cluster restarts is not required because the reaper resets stuck
-- rows by wall-clock time (locked_at < now() - 60s).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_outbox_batch(p_limit INT DEFAULT 100)
RETURNS SETOF outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE outbox
  SET
    status    = 'publishing',
    locked_at = now(),
    locked_by = pg_backend_pid()::text
  WHERE id IN (
    SELECT id
    FROM outbox
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_outbox_batch(INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION claim_outbox_batch(INT) TO service_role;

-- Reaper (see architecture §5.2 comments): plain UPDATE issued by the Vercel
-- fallback cron BEFORE it claims new rows. Not a function — the cron runs it
-- directly. Documented here so it's not forgotten:
--
--   UPDATE outbox
--   SET status = 'pending', locked_at = NULL, locked_by = NULL
--   WHERE status = 'publishing' AND locked_at < now() - interval '60 seconds';
--
-- 60s window matches the Vercel cron interval → stuck rows recovered within 120s.
