-- 006_learning_substrate.sql
-- v1_scars (with pgvector embeddings) and shadow_diffs.
-- Architecture §v1 Scar Index subsystem + S0.2/S0.9 checklist.
-- Requires 001_extensions.sql (vector extension) to have run first.

-- ---------------------------------------------------------------------------
-- v1_scars: every known failure mode from v1 with its prevention in Smart AI.
-- Populated in S0.9. Ops Agent retrieves relevant scars before every proposal.
-- Matching scar + unsatisfied prevention → escalate regardless of confidence.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v1_scars (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scar_id             TEXT NOT NULL UNIQUE,           -- human-readable e.g. 'R093', 'emit-atomicity-01'
  category            TEXT NOT NULL,                  -- 'data_integrity' | 'workflow' | 'billing' | 'comms' | 'infra' | 'ux'
  what_broke_in_v1    TEXT NOT NULL,
  root_cause          TEXT NOT NULL,
  evidence_refs       TEXT[] NOT NULL DEFAULT '{}',   -- CLAUDE.md R-codes, dev_task UUIDs, commit SHAs
  smart_ai_prevention TEXT NOT NULL,
  verification_path   TEXT NOT NULL,                  -- how to confirm the prevention is in place
  retrieval_tags      TEXT[] NOT NULL DEFAULT '{}',
  embedding           vector(1536),                   -- OpenAI text-embedding-3-small
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE v1_scars ENABLE ROW LEVEL SECURITY;

-- Scars are read-only for authenticated users (agent retrieval); only service_role writes.
CREATE POLICY "scars_authenticated_read" ON v1_scars
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY "scars_service_role_write" ON v1_scars
  FOR ALL USING (auth.role() = 'service_role');

-- IVFFlat index for approximate nearest-neighbour retrieval (cosine similarity).
-- lists=100 is appropriate for the expected scar count (50-500 rows in S0.9).
CREATE INDEX IF NOT EXISTS idx_v1_scars_embedding
  ON v1_scars USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_v1_scars_category ON v1_scars(category);
CREATE INDEX IF NOT EXISTS idx_v1_scars_tags      ON v1_scars USING GIN(retrieval_tags);

-- ---------------------------------------------------------------------------
-- shadow_diffs: solver output diffs between v1 data and Smart AI spec.
-- Populated in S0.7 (shadow-mode) and used in S0.8 (panel verification).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shadow_diffs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  v1_account_id       UUID NOT NULL,              -- v1 account UUID (cross-ref only, no FK)
  engagement_id       UUID REFERENCES engagements(id),
  diff_category       TEXT                        -- 'spec_bug' | 'import_bug' | 'v1_data_issue' | 'expected'
                        CHECK (diff_category IN ('spec_bug', 'import_bug', 'v1_data_issue', 'expected')),
  v1_status_report    JSONB,
  smart_ai_status_report JSONB,
  diff_detail         JSONB NOT NULL DEFAULT '{}',
  triaged_at          TIMESTAMPTZ,
  triaged_by          TEXT,                       -- 'human' | 'agent'
  triage_notes        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE shadow_diffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shadow_diffs_service_role" ON shadow_diffs
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_shadow_diffs_v1_account   ON shadow_diffs(v1_account_id);
CREATE INDEX IF NOT EXISTS idx_shadow_diffs_category     ON shadow_diffs(diff_category);
CREATE INDEX IF NOT EXISTS idx_shadow_diffs_triaged      ON shadow_diffs(triaged_at) WHERE triaged_at IS NULL;
