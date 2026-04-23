-- 005_agent_solver.sql
-- Agent + solver tables: exceptions, proposals, solver_cache, dispatch_throttle.
-- Architecture §5 + S0.2 checklist.

-- ---------------------------------------------------------------------------
-- exceptions: approved deviations from spec requirements for a given engagement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exceptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  requirement_key TEXT NOT NULL,
  exception_type  TEXT NOT NULL,                  -- 'waiver' | 'extension' | 'substitution'
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  approved_by     UUID REFERENCES contacts(id),
  approved_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  expired_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exceptions_service_role" ON exceptions
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_exceptions_engagement ON exceptions(engagement_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_status     ON exceptions(status);

-- ---------------------------------------------------------------------------
-- proposals: AI proposal inbox — agent proposals awaiting admin approval.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   UUID REFERENCES engagements(id),
  proposal_type   TEXT NOT NULL,                  -- 'action' | 'exception' | 'spec_change'
  title           TEXT NOT NULL,
  body            JSONB NOT NULL DEFAULT '{}',
  confidence      NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  reviewed_by     UUID REFERENCES contacts(id),
  reviewed_at     TIMESTAMPTZ,
  scar_ids        UUID[],                         -- v1_scars referenced in this proposal
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proposals_service_role" ON proposals
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_proposals_engagement ON proposals(engagement_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status     ON proposals(status);

-- ---------------------------------------------------------------------------
-- solver_cache: per-engagement cached StatusReport.
-- valid_until MUST be NOT NULL DEFAULT 'infinity' — never nullable.
-- Two-valued predicate (valid_until > now()) with no NULL leakage.
-- Architecture Technical Contracts §solver_cache.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS solver_cache (
  engagement_id   UUID PRIMARY KEY REFERENCES engagements(id) ON DELETE CASCADE,
  status_report   JSONB NOT NULL DEFAULT '{}',
  input_hash      TEXT NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until     TIMESTAMPTZ NOT NULL DEFAULT 'infinity'::timestamptz
);

ALTER TABLE solver_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "solver_cache_service_role" ON solver_cache
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- dispatch_throttle: prevents context-fingerprint dispatch from firing on every
-- state change. 5-minute minimum interval enforced at application layer.
-- Architecture §7.2 cost rationale (10 calls/client/day assumption).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispatch_throttle (
  engagement_id       UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  requirement_key     TEXT NOT NULL,
  last_dispatched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  context_fingerprint TEXT NOT NULL,
  PRIMARY KEY (engagement_id, requirement_key)
);

ALTER TABLE dispatch_throttle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dispatch_throttle_service_role" ON dispatch_throttle
  USING (auth.role() = 'service_role');
