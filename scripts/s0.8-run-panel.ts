/**
 * S0.8 — 30-client panel runner.
 *
 * Selects 30 representative accounts from the v1-clone sandbox, builds an
 * EvaluationContext for each, runs the solver, compares to v1's observable
 * state, and writes diffs to shadow_diffs.
 *
 * Run: npx tsx scripts/s0.8-run-panel.ts
 * Requires: SUPABASE_DB_URL in .env.local pointing to tapbgvbglqacamhayfel.
 */

import 'dotenv/config';
import pg from 'pg';
import { resolveSpec } from '../lib/solver/resolve-spec';
import { evaluate } from '../lib/solver/evaluate';
import { buildContext, type SandboxClient } from '../lib/shadow/build-context';
import type { AccountView, StatusReport } from '../lib/solver/types';

const SPEC_ID = '40fed2c9-02fe-442a-9c7d-800eef711a98';

// Panel: 30 accounts covering SMLLC/MMLLC, active/closed, clean/exception
const PANEL_SQL = `
  WITH ranked AS (
    SELECT
      a.id,
      a.company_name,
      a.entity_type,
      a.status,
      a.state_of_formation,
      a.ein_number,
      a.formation_date,
      a.portal_created_date,
      -- "exception" heuristic: active account with no paid payment in last 12m
      EXISTS (
        SELECT 1 FROM payments p
        WHERE p.account_id = a.id AND p.status = 'paid'
      ) AS has_paid_payment,
      ROW_NUMBER() OVER (
        PARTITION BY a.entity_type, a.status,
          CASE WHEN EXISTS (
            SELECT 1 FROM payments p WHERE p.account_id = a.id AND p.status = 'paid'
          ) THEN 'paid' ELSE 'unpaid' END
        ORDER BY a.created_at DESC
      ) AS rn
    FROM accounts a
    WHERE a.entity_type IN ('Single Member LLC', 'Multi Member LLC')
      AND a.company_name IS NOT NULL
      AND a.is_test IS NOT TRUE
  )
  SELECT * FROM ranked
  WHERE rn <= 5
  ORDER BY entity_type, status, has_paid_payment DESC
  LIMIT 30
`;

async function loadClient(pool: pg.Pool, accountId: string): Promise<SandboxClient> {
  const [accountRes, paymentsRes, membersRes, oaRes] = await Promise.all([
    pool.query('SELECT * FROM accounts WHERE id = $1', [accountId]),
    pool.query(
      "SELECT * FROM payments WHERE account_id = $1 AND status = 'paid' ORDER BY paid_date ASC LIMIT 5",
      [accountId]
    ),
    pool.query('SELECT * FROM account_contacts WHERE account_id = $1', [accountId]),
    pool.query(
      "SELECT COUNT(*) as n FROM oa_agreements WHERE account_id = $1 AND status = 'signed'",
      [accountId]
    ),
  ]);

  return {
    account: accountRes.rows[0] as AccountView,
    paid_payments: paymentsRes.rows,
    members: membersRes.rows,
    oa_signed: parseInt(String(oaRes.rows[0]?.n ?? '0'), 10) > 0,
    formation_completed_at: null,
  };
}

function buildV1StatusReport(client: SandboxClient): Record<string, unknown> {
  const a = client.account;
  return {
    entity_type: a['entity_type'],
    status: a['status'],
    company_name: a['company_name'] ?? null,
    state_of_formation: a['state_of_formation'] ?? null,
    ein_number: a['ein_number'] ?? null,
    formation_date: a['formation_date'] ?? null,
    has_paid_payment: client.paid_payments.length > 0,
    oa_signed: client.oa_signed,
    member_count: client.members.length,
  };
}

function diffCategory(v1: Record<string, unknown>, report: StatusReport): string {
  const allSatisfied = report.requirements.every(
    (r) => r.status === 'satisfied' || r.status === 'satisfied_by_exception'
  );
  const v1Active = String(v1['status']).toLowerCase() === 'active';

  if (allSatisfied && v1Active) return 'match_complete';
  if (!allSatisfied && !v1Active) return 'match_incomplete';
  if (allSatisfied && !v1Active) return 'solver_over_satisfied';
  if (!allSatisfied && v1Active) return 'solver_under_satisfied';
  return 'unknown';
}

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('SUPABASE_DB_URL not set');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: dbUrl, max: 4 });

  // Select panel
  const panelRes = await pool.query(PANEL_SQL);
  const panel = panelRes.rows;
  console.log(`Panel: ${panel.length} accounts selected`);

  const now = new Date().toISOString();

  // Clear previous run
  await pool.query("DELETE FROM shadow_diffs WHERE triage_notes LIKE 's0.8-panel-%'");

  const spec = await resolveSpec(pool, SPEC_ID, new Date(now));

  let matched = 0;
  let diffed = 0;
  let skipped = 0;

  for (const row of panel) {
    const accountId = row.id as string;
    const entityType = String(row.entity_type ?? '');

    // MMLLC: no spec yet — log as no_spec diff
    if (!entityType.includes('Single Member')) {
      await pool.query(
        `INSERT INTO shadow_diffs
           (v1_account_id, engagement_id, diff_category, v1_status_report, smart_ai_status_report, diff_detail, triage_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          accountId,
          null,
          'no_spec',
          JSON.stringify({ entity_type: entityType, status: row.status }),
          null,
          JSON.stringify({ reason: 'No Smart AI spec for MMLLC yet — S0.4 only seeded smllc_formation' }),
          `s0.8-panel-${now.slice(0, 10)}`,
        ]
      );
      skipped++;
      continue;
    }

    try {
      const client = await loadClient(pool, accountId);
      const ctx = buildContext(client, now);
      const report: StatusReport = evaluate(spec, ctx);
      const v1Status = buildV1StatusReport(client);
      const category = diffCategory(v1Status, report);

      await pool.query(
        `INSERT INTO shadow_diffs
           (v1_account_id, engagement_id, diff_category, v1_status_report, smart_ai_status_report, diff_detail, triage_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          accountId,
          ctx.engagement.id,
          category,
          JSON.stringify(v1Status),
          JSON.stringify(report),
          JSON.stringify({
            missing: report.requirements.filter((r) => r.status === 'missing').map((r) => r.key),
            blocked: report.requirements.filter((r) => r.status === 'blocked').map((r) => r.key),
            satisfied: report.requirements.filter(
              (r) => r.status === 'satisfied' || r.status === 'satisfied_by_exception'
            ).map((r) => r.key),
            overall_progress: report.overall_progress,
          }),
          `s0.8-panel-${now.slice(0, 10)}`,
        ]
      );

      if (category.startsWith('match')) matched++;
      else diffed++;

      console.log(`  ${category.padEnd(25)} ${row.company_name ?? accountId}`);
    } catch (err) {
      console.error(`  ERROR ${accountId}:`, err instanceof Error ? err.message : err);
    }
  }

  await pool.end();

  console.log(`\nDone: ${matched} matched, ${diffed} diffs, ${skipped} skipped (no spec)`);
  console.log('Browse results at /admin/shadow-diffs');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
