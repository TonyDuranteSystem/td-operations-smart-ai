-- 004_spec_rules.sql
-- Specification engine tables: service_specs, rule_overrides, rule_path_policy.
-- Architecture §5 (Specification engine) + S0.2 checklist.

-- ---------------------------------------------------------------------------
-- service_specs: TypeScript specs seeded on deploy. Immutable once published.
-- New version = new row with incremented version number.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_specs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_type   TEXT NOT NULL,                  -- 'smllc_formation' | 'tax_return' | etc.
  spec_json       JSONB NOT NULL,                 -- full spec DSL serialized
  version         INT NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_type, version)
);

ALTER TABLE service_specs ENABLE ROW LEVEL SECURITY;

-- Specs are read-only for all authenticated users; only service_role writes.
CREATE POLICY "specs_public_read" ON service_specs
  FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- rule_path_policy: governs which roles may override which rule paths.
-- find_path_policy() SQL function does LIKE match, most-specific-wins.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rule_path_policy (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path_prefix     TEXT NOT NULL UNIQUE,
  allowed_roles   TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rule_path_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "path_policy_service_role" ON rule_path_policy
  USING (auth.role() = 'service_role');

-- Function: find most-specific matching policy for a given path.
CREATE OR REPLACE FUNCTION find_path_policy(p_path TEXT)
RETURNS TABLE(path_prefix TEXT, allowed_roles TEXT[])
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT path_prefix, allowed_roles
  FROM rule_path_policy
  WHERE p_path LIKE (path_prefix || '%')
  ORDER BY length(path_prefix) DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION find_path_policy(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION find_path_policy(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- rule_overrides: runtime-editable values for spec rules (CRM UI → Supabase).
-- CHECK constraint prevents backdating unless allow_backdate = true.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rule_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_path       TEXT NOT NULL,                  -- e.g. 'smllc_formation.price_usd'
  value           JSONB NOT NULL,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  allow_backdate  BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID REFERENCES contacts(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT effective_from_no_backdate
    CHECK (effective_from >= created_at OR allow_backdate = true)
);

ALTER TABLE rule_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "overrides_service_role" ON rule_overrides
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_rule_overrides_path ON rule_overrides(rule_path);
CREATE INDEX IF NOT EXISTS idx_rule_overrides_effective ON rule_overrides(effective_from DESC);
