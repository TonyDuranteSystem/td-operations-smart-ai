-- 002_entity_graph.sql
-- Core entity graph: contacts, accounts, account_members, engagements, sensitive_data.
-- Architecture §5 (Entity graph) + S0.2 checklist.
-- Idempotent via CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
--
-- Ordering note: all tables are created FIRST, then all RLS + policies at the
-- bottom. CREATE POLICY with a USING clause parse-checks the referenced tables
-- at policy-creation time, so a policy on contacts that references engagements
-- would fail if engagements didn't exist yet.

-- ===========================================================================
-- TABLES
-- ===========================================================================

-- sensitive_data: PII storage with per-row RLS + GDPR soft-delete support.
-- Raw PII never stored on contacts directly — only tokens pointing here.
CREATE TABLE IF NOT EXISTS sensitive_data (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token           TEXT NOT NULL UNIQUE,
  encrypted_value TEXT,                          -- NULL = GDPR-deleted
  data_type       TEXT NOT NULL,                 -- 'name' | 'email' | 'phone' | 'ssn' | etc.
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- contacts: individual people. PII tokenized via sensitive_data.
CREATE TABLE IF NOT EXISTS contacts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_name_token    TEXT REFERENCES sensitive_data(token),
  contact_email_token   TEXT REFERENCES sensitive_data(token),
  preferred_language    TEXT NOT NULL DEFAULT 'en'
                          CHECK (preferred_language IN ('en', 'it', 'es', 'fr', 'pt')),
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- accounts: the LLC / company entity.
CREATE TABLE IF NOT EXISTS accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name        TEXT NOT NULL,
  entity_type         TEXT NOT NULL DEFAULT 'llc'
                        CHECK (entity_type IN ('llc', 'corp', 'sole_prop')),
  state_of_formation  TEXT,
  formation_date      DATE,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'dissolved', 'suspended')),
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- account_members: who belongs to which LLC and in what role.
-- Partial unique index enforces "no two active rows for same contact+account".
-- Plain UNIQUE fails with NULL semantics — must use partial index.
CREATE TABLE IF NOT EXISTS account_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('member', 'manager', 'registered_agent', 'observer')),
  ownership_pct   NUMERIC(5,2) CHECK (ownership_pct >= 0 AND ownership_pct <= 100),
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  is_signer       BOOLEAN NOT NULL DEFAULT false,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at         TIMESTAMPTZ,                   -- NULL = currently active member
  added_by        UUID REFERENCES contacts(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_members_active
  ON account_members(account_id, contact_id)
  WHERE left_at IS NULL;

-- engagements: commercial anchor per service. account_id nullable for pre-formation.
CREATE TABLE IF NOT EXISTS engagements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID REFERENCES accounts(id),
  contact_id      UUID NOT NULL REFERENCES contacts(id),
  contract_type   TEXT NOT NULL,
  spec_id         TEXT NOT NULL,
  spec_version_id UUID,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'completed', 'cancelled', 'on_hold')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagements_account_id    ON engagements(account_id);
CREATE INDEX IF NOT EXISTS idx_engagements_contact_id    ON engagements(contact_id);
CREATE INDEX IF NOT EXISTS idx_engagements_status        ON engagements(status);
CREATE INDEX IF NOT EXISTS idx_engagements_contract_type ON engagements(contract_type);

-- ===========================================================================
-- ROW LEVEL SECURITY
-- ===========================================================================
-- Enable RLS on all client-visible tables. Service role bypasses RLS;
-- everything else gates on the auth.uid() → contact → account → engagement chain.

ALTER TABLE sensitive_data  ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagements     ENABLE ROW LEVEL SECURITY;

-- sensitive_data: service_role only. Never client-readable.
DROP POLICY IF EXISTS "service_role_only" ON sensitive_data;
CREATE POLICY "service_role_only" ON sensitive_data
  USING (auth.role() = 'service_role');

-- contacts: contact may read their own row, and any contact linked to the same
-- active account as the requesting user. service_role bypasses.
DROP POLICY IF EXISTS "contacts_read_own_or_shared_account" ON contacts;
CREATE POLICY "contacts_read_own_or_shared_account" ON contacts
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR id = auth.uid()::uuid
    OR EXISTS (
      SELECT 1
      FROM account_members am_self
      JOIN account_members am_other
        ON am_self.account_id = am_other.account_id
      WHERE am_self.contact_id  = auth.uid()::uuid
        AND am_self.left_at     IS NULL
        AND am_other.contact_id = contacts.id
        AND am_other.left_at    IS NULL
    )
  );

-- accounts: readable by any active member of the account. service_role bypasses.
DROP POLICY IF EXISTS "accounts_read_by_member" ON accounts;
CREATE POLICY "accounts_read_by_member" ON accounts
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM account_members am
      WHERE am.account_id = accounts.id
        AND am.contact_id = auth.uid()::uuid
        AND am.left_at    IS NULL
    )
  );

-- account_members: readable by any active member of the same account.
DROP POLICY IF EXISTS "account_members_read_by_peer" ON account_members;
CREATE POLICY "account_members_read_by_peer" ON account_members
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM account_members am_self
      WHERE am_self.account_id = account_members.account_id
        AND am_self.contact_id = auth.uid()::uuid
        AND am_self.left_at    IS NULL
    )
  );

-- engagements: readable by the owning contact, or by active account members.
DROP POLICY IF EXISTS "engagements_read_by_contact_or_member" ON engagements;
CREATE POLICY "engagements_read_by_contact_or_member" ON engagements
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR contact_id = auth.uid()::uuid
    OR (
      account_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM account_members am
        WHERE am.account_id = engagements.account_id
          AND am.contact_id = auth.uid()::uuid
          AND am.left_at    IS NULL
      )
    )
  );
