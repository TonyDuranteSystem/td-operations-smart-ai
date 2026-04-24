/**
 * S0.9 — v1 Scar Index population.
 *
 * Inserts ≥50 categorised scars derived from:
 *   - v1 CLAUDE.md error-magnet rules R005-R101
 *   - v1 dev_tasks bug history (confirmed production incidents)
 *
 * Run: npx dotenv-cli -e .env.local -- npx tsx scripts/s0.9-seed-scars.ts
 * Idempotent: ON CONFLICT (scar_id) DO NOTHING.
 */

import pg from 'pg';

type Scar = {
  scar_id: string;
  category: string;
  what_broke_in_v1: string;
  root_cause: string;
  evidence_refs: string[];
  smart_ai_prevention: string;
  verification_path: string;
  retrieval_tags: string[];
};

const SCARS: Scar[] = [
  // ── URL / ROUTING ─────────────────────────────────────────────────────────
  {
    scar_id: 'R005',
    category: 'url_routing',
    what_broke_in_v1: 'Internal td-operations.vercel.app URL was sent to clients in offer/portal emails, exposing the CRM dashboard.',
    root_cause: 'No enforced separation between internal and client-facing domains. Hardcoded URLs were copy-pasted without review.',
    evidence_refs: ['CLAUDE.md R005', 'lib/config.ts'],
    smart_ai_prevention: 'All outbound client URLs resolved via APP_BASE_URL / PORTAL_BASE_URL constants. Internal domain never referenced in any client-facing template or MCP tool.',
    verification_path: 'grep -r "td-operations.vercel.app" app/ lib/ — must return zero results outside lib/config.ts.',
    retrieval_tags: ['url', 'domain', 'client_email', 'internal_leak'],
  },
  {
    scar_id: 'R012',
    category: 'url_routing',
    what_broke_in_v1: 'Hardcoded client-facing domains in code caused broken links when domains changed.',
    root_cause: 'Developers hardcoded domain strings instead of using the config constant, making domain changes require a full codebase search.',
    evidence_refs: ['CLAUDE.md R012', 'lib/config.ts', '.husky/pre-push'],
    smart_ai_prevention: 'lib/config.ts is the single source for all domain constants. Pre-push hook blocks any hardcoded client-facing domain outside that file.',
    verification_path: 'Run the pre-push hook locally. Attempt to commit a hardcoded domain — confirm it is blocked.',
    retrieval_tags: ['url', 'hardcoded', 'domain', 'config'],
  },
  {
    scar_id: 'R015',
    category: 'url_routing',
    what_broke_in_v1: 'An old domain was removed from Vercel, breaking links that had already been sent to clients.',
    root_cause: 'No policy against domain removal. Old offer links in client inboxes stopped working silently.',
    evidence_refs: ['CLAUDE.md R015'],
    smart_ai_prevention: 'Domains are append-only in Smart AI Vercel project. Removal requires explicit Antonio approval and a client-impact review.',
    verification_path: 'Vercel domain list — confirm all historical Smart AI domains are still present after any deployment.',
    retrieval_tags: ['url', 'domain', 'vercel', 'link_rot'],
  },
  {
    scar_id: 'R016',
    category: 'url_routing',
    what_broke_in_v1: 'Non-English characters in URLs caused broken links for Italian-language offers.',
    root_cause: 'URL slugs were generated from company names containing accented characters without sanitisation.',
    evidence_refs: ['CLAUDE.md R016'],
    smart_ai_prevention: 'All slug/token generation functions enforce English-only alphanumeric output. Validated at generation time, not at use time.',
    verification_path: 'Unit test: generateSlug("Società italiana") must return only ASCII characters.',
    retrieval_tags: ['url', 'slug', 'encoding', 'i18n'],
  },

  // ── DATA INTEGRITY ────────────────────────────────────────────────────────
  {
    scar_id: 'R018',
    category: 'data_integrity',
    what_broke_in_v1: 'execute_sql used for CRM writes bypassed business logic, audit trail, and idempotency checks, corrupting records.',
    root_cause: 'execute_sql is a raw SQL tool with no guardrails. Business logic (dedup checks, event emission) is only in the MCP layer.',
    evidence_refs: ['CLAUDE.md R018', 'lib/mcp/tools/crm.ts'],
    smart_ai_prevention: 'No raw SQL writes to entity tables from application code. All writes go through typed service functions with built-in validation.',
    verification_path: 'ESLint rule: direct pool.query writes to entity tables outside designated service files trigger a warning.',
    retrieval_tags: ['sql', 'crm', 'data_integrity', 'bypass'],
  },
  {
    scar_id: 'R027',
    category: 'data_integrity',
    what_broke_in_v1: 'TD systems accidentally wrote into client_invoices, mixing TD receivables with client sales invoices.',
    root_cause: 'Two invoice concepts shared similar names. No guardrail prevented TD code from writing to the wrong table.',
    evidence_refs: ['CLAUDE.md R027', 'lib/portal/unified-invoice.ts'],
    smart_ai_prevention: 'Smart AI has explicit invoice architecture: payments (TD receivables), engagements (service contracts). No client_invoices table. Table names and purposes are unambiguous.',
    verification_path: 'Schema review: confirm no table named client_invoices exists. Confirm payments table has clear TD-ownership semantics.',
    retrieval_tags: ['invoice', 'table_confusion', 'data_integrity'],
  },
  {
    scar_id: 'R094',
    category: 'data_integrity',
    what_broke_in_v1: 'leads.status=Converted was interpreted as "offer signed" in some code paths but "payment confirmed" in others, causing double-activations.',
    root_cause: 'The semantic of "Converted" changed during a refactor (offer-signed webhook) without all callers being updated.',
    evidence_refs: ['CLAUDE.md R094', 'commit 4d5f403'],
    smart_ai_prevention: 'Smart AI uses events (payment.confirmed, offer.signed) not status fields to signal lifecycle transitions. No single status field carries ambiguous dual meaning.',
    verification_path: 'Spec review: confirm payment_gate requirement uses payment.confirmed event, not a status field.',
    retrieval_tags: ['lead', 'status', 'lifecycle', 'double_activation'],
  },
  {
    scar_id: 'R097',
    category: 'data_integrity',
    what_broke_in_v1: 'Automatic QB sync fired on every payment confirmation, creating duplicate invoices in QuickBooks when retries occurred.',
    root_cause: 'QB sync was triggered automatically without idempotency. QB API is not idempotent by default.',
    evidence_refs: ['CLAUDE.md R097', 'commit 1dbfa33'],
    smart_ai_prevention: 'QB sync (if ever added to Smart AI) must be explicit and manual. No automatic QB triggers in webhook handlers or crons.',
    verification_path: 'grep -r "quickbooks\\|qb_" lib/ app/ — any result requires explicit review.',
    retrieval_tags: ['quickbooks', 'idempotency', 'sync', 'duplicate'],
  },
  {
    scar_id: 'R098',
    category: 'data_integrity',
    what_broke_in_v1: 'Two simultaneous payments created duplicate invoice numbers (INV-NNNNNN-TIMESTAMP suffix) when a timestamp fallback was added without proper dedup.',
    root_cause: 'Race condition in invoice number generation. Timestamp suffix was added as a "fix" but created a new format that broke downstream parsers.',
    evidence_refs: ['CLAUDE.md R098', 'April 12 collision incident', 'commit 1dbfa33'],
    smart_ai_prevention: 'Invoice numbers generated via DB unique constraint + retry-on-conflict loop. No timestamp suffix fallback. Race safety lives in the index, not in application code.',
    verification_path: 'DB: confirm unique index on payments(invoice_number) exists. Run two concurrent invoice inserts with same base number — second must retry cleanly.',
    retrieval_tags: ['invoice', 'race_condition', 'unique_constraint', 'idempotency'],
  },
  {
    scar_id: 'R053',
    category: 'data_integrity',
    what_broke_in_v1: 'Duplicate dev_tasks created for the same work topic, fragmenting progress tracking and causing confusion across sessions.',
    root_cause: 'INSERT was used without prior SELECT check. Cold sessions did not check if a task already existed.',
    evidence_refs: ['CLAUDE.md R053'],
    smart_ai_prevention: 'Smart AI dev_task (2bc839aa) is a single canonical task for Stage 0. Progress_log is append-only. No new tasks created without checking for existing ones.',
    verification_path: 'SELECT COUNT(*) FROM dev_tasks WHERE title ILIKE target_title — must be 1 before any INSERT.',
    retrieval_tags: ['dev_tasks', 'dedup', 'session', 'insert'],
  },

  // ── CLIENT COMMUNICATION ──────────────────────────────────────────────────
  {
    scar_id: 'R035',
    category: 'client_communication',
    what_broke_in_v1: 'A form was sent to a client with a broken field validation that rejected valid inputs, blocking the client from completing onboarding.',
    root_cause: 'Form was never previewed with ?preview=td before sending. The bug existed in production but was invisible until a real client hit it.',
    evidence_refs: ['CLAUDE.md R035'],
    smart_ai_prevention: 'All client-facing forms include ?preview=td bypass from day one of development. Preview is mandatory before any form is sent to a real client.',
    verification_path: 'For any new form: navigate to form?preview=td — must skip email gate and show ADMIN PREVIEW badge. All fields must be fillable and submittable.',
    retrieval_tags: ['form', 'preview', 'testing', 'client_onboarding'],
  },
  {
    scar_id: 'R037',
    category: 'client_communication',
    what_broke_in_v1: 'A document was marked "sent" in the DB before the actual Gmail send, causing the client to never receive it while the CRM showed it as sent.',
    root_cause: 'Status update happened before the send operation. On send failure, the DB showed "sent" but no email was delivered.',
    evidence_refs: ['CLAUDE.md R037', 'lib/mcp/safe-send.ts'],
    smart_ai_prevention: 'safeSend() pattern: idempotency check → SEND → status update. Status update never precedes the send.',
    verification_path: 'Code review: any email/document send function must use safeSend() or explicitly follow the pattern. Direct status updates before sends are blocked by code review.',
    retrieval_tags: ['email', 'send', 'status', 'ordering', 'safe_send'],
  },
  {
    scar_id: 'R041',
    category: 'client_communication',
    what_broke_in_v1: 'Email subjects with accented characters (common in Italian client names) were corrupted in some email clients due to missing RFC 2047 encoding.',
    root_cause: 'Raw UTF-8 strings were placed directly in MIME Subject headers, which requires base64 encoding for non-ASCII content.',
    evidence_refs: ['CLAUDE.md R041'],
    smart_ai_prevention: 'All email subject generation is centralised. Subjects are always encoded as =?utf-8?B?<base64>?= before insertion into MIME headers.',
    verification_path: 'Unit test: encodeEmailSubject("Società Italiana") must return =?utf-8?B? prefix.',
    retrieval_tags: ['email', 'encoding', 'rfc2047', 'mime', 'i18n'],
  },
  {
    scar_id: 'R092',
    category: 'client_communication',
    what_broke_in_v1: 'Invoice emails contained embedded Stripe checkout links, which expired after 24 hours and confused clients who tried to pay later.',
    root_cause: 'Developer added Stripe link directly to email template without knowing the link expiry policy.',
    evidence_refs: ['CLAUDE.md R092', 'components/portal/td-pay-modal.tsx'],
    smart_ai_prevention: 'Client invoice emails direct to the portal only. Payment is initiated via the portal Pay button. No payment links embedded in emails.',
    verification_path: 'Email template review: grep for stripe.com or payment links in any outbound email template — must return zero.',
    retrieval_tags: ['invoice', 'email', 'stripe', 'payment_link', 'expiry'],
  },
  {
    scar_id: 'R099',
    category: 'client_communication',
    what_broke_in_v1: 'Portal chat upload failures showed generic "Upload failed" toast, hiding the real error (file too large, wrong format) from both user and support.',
    root_cause: 'Client-side fetch caught errors generically without parsing the server\'s JSON error body.',
    evidence_refs: ['CLAUDE.md R099', 'commit b80ecef'],
    smart_ai_prevention: 'All client fetch calls parse server JSON on non-2xx and surface data.error. Server API routes return actionable error messages (size in MB, detected MIME type).',
    verification_path: 'Unit test: mock a 413 response with {error: "File too large (12 MB max)"} — confirm toast shows that exact message.',
    retrieval_tags: ['fetch', 'error_handling', 'toast', 'api', 'client_side'],
  },

  // ── SECURITY / AUTH ───────────────────────────────────────────────────────
  {
    scar_id: 'R090',
    category: 'security',
    what_broke_in_v1: '.env.local was accidentally committed, exposing service role keys in git history.',
    root_cause: 'Developer ran git add -A which staged .env.local despite it being in .gitignore (the file had been created before the gitignore entry).',
    evidence_refs: ['CLAUDE.md R090', '.gitignore'],
    smart_ai_prevention: '.env.local is in .gitignore from repo creation. Pre-commit hook checks for credential patterns. Never use git add -A.',
    verification_path: 'git log --all --full-history -- .env.local — must return no commits.',
    retrieval_tags: ['security', 'credentials', 'git', 'env_file'],
  },
  {
    scar_id: 'R093',
    category: 'security',
    what_broke_in_v1: 'Assumed column names in SQL queries returned wrong data silently (e.g., assumed status column name, got NULL instead of error).',
    root_cause: 'Developer assumed schema from memory instead of verifying via information_schema. Query succeeded but returned wrong rows.',
    evidence_refs: ['CLAUDE.md R093', 'Antonio: "WITH YOUR ASSUMPTIONS WE RISK TO RUIN THE SYSTEM"'],
    smart_ai_prevention: 'Every schema-touching code path is written after a fresh information_schema query in the current session. TypeScript strict mode catches many mismatches at compile time.',
    verification_path: 'Code review: any query using a column name must have a corresponding information_schema verification in the session log or in a test.',
    retrieval_tags: ['assumption', 'sql', 'schema', 'verification'],
  },
  {
    scar_id: 'R100',
    category: 'security',
    what_broke_in_v1: 'Deleted portal chat messages were hard-deleted from the DB, making them invisible in admin views and creating confusion about what clients had seen.',
    root_cause: 'DELETE was used where soft-delete was needed. No audit trail remained.',
    evidence_refs: ['CLAUDE.md R100', 'commit 49d64df', 'portal_messages.deleted_at'],
    smart_ai_prevention: 'All client-visible content uses soft-delete (deleted_at TIMESTAMPTZ + deleted_by UUID). Hard delete only for internal-only tables with no FK chain to client-visible state.',
    verification_path: 'Schema: any table with client-visible rows must have deleted_at column. API DELETE endpoints must SET deleted_at, not DELETE FROM.',
    retrieval_tags: ['soft_delete', 'audit', 'portal', 'data_integrity'],
  },

  // ── CODE QUALITY ──────────────────────────────────────────────────────────
  {
    scar_id: 'R067',
    category: 'code_quality',
    what_broke_in_v1: 'ESLint warnings in modified files accumulated until lint-staged blocked a critical hotfix commit at the worst possible moment.',
    root_cause: 'Warnings were not fixed incrementally. The rule existed but was not enforced in the edit workflow.',
    evidence_refs: ['CLAUDE.md R067'],
    smart_ai_prevention: 'lint-staged runs on every commit. Pre-push runs ESLint on all changed files vs origin/main. Zero warnings allowed.',
    verification_path: 'Introduce a deliberate ESLint warning in a staged file — confirm pre-commit blocks the commit.',
    retrieval_tags: ['eslint', 'lint', 'code_quality', 'pre_commit'],
  },
  {
    scar_id: 'R079',
    category: 'code_quality',
    what_broke_in_v1: 'A UI change was declared done after build passing, but the feature was broken in the actual browser due to a CSS class naming conflict.',
    root_cause: 'Build passing was treated as equivalent to "works". No browser verification was done.',
    evidence_refs: ['CLAUDE.md R079'],
    smart_ai_prevention: 'Any UI change requires a browser screenshot showing the rendered result before declaring done. Build green ≠ feature working.',
    verification_path: 'Session review: UI task completion must include a screenshot or preview_snapshot in the session log.',
    retrieval_tags: ['ui', 'testing', 'browser', 'css'],
  },
  {
    scar_id: 'R086',
    category: 'code_quality',
    what_broke_in_v1: 'A lib/ function had edge-case bugs that were only discovered in production because no unit tests were written.',
    root_cause: 'Unit tests were "deferred" and never written. Pre-push hook was not blocking on missing tests.',
    evidence_refs: ['CLAUDE.md R086'],
    smart_ai_prevention: 'Pre-push hook runs npm run test:unit. Every new lib/ function has corresponding tests covering normal, edge, and error cases.',
    verification_path: 'Add a new function without tests — confirm pre-push blocks. Add tests — confirm pre-push passes.',
    retrieval_tags: ['unit_test', 'lib', 'pre_push', 'code_quality'],
  },
  {
    scar_id: 'R051',
    category: 'code_quality',
    what_broke_in_v1: 'A subagent completed a large batch operation but returned only a summary to chat. Context compaction erased the detail, and the work was unrecoverable.',
    root_cause: 'Subagent results were not persisted to Supabase before returning. Chat is ephemeral; only Supabase survives compaction.',
    evidence_refs: ['CLAUDE.md R051'],
    smart_ai_prevention: 'Any subagent or batch operation writes structured results to Supabase (dev_tasks progress_log or session_checkpoints) before returning a compact summary to chat.',
    verification_path: 'After any batch script: SELECT from the target table to confirm rows exist before declaring done.',
    retrieval_tags: ['subagent', 'compaction', 'persistence', 'supabase'],
  },

  // ── GIT WORKFLOW ──────────────────────────────────────────────────────────
  {
    scar_id: 'R070',
    category: 'git_workflow',
    what_broke_in_v1: 'A session started on a machine that was 3 commits behind, leading to a merge conflict that overwrote another machine\'s work.',
    root_cause: 'git pull was not run at session start. The machine had stale code and the developer assumed it was current.',
    evidence_refs: ['CLAUDE.md R070', '.claude/hooks/session-git-pull.sh'],
    smart_ai_prevention: 'SessionStart hook runs git pull origin main before any work. Session is blocked if pull fails due to conflicts.',
    verification_path: 'Confirm .claude/hooks/session-git-pull.sh fires on session start and git log --oneline shows current origin/main commit.',
    retrieval_tags: ['git', 'pull', 'multi_machine', 'stale_code'],
  },
  {
    scar_id: 'R071',
    category: 'git_workflow',
    what_broke_in_v1: 'git add -A on a machine behind remote staged deletions of files that existed remotely but not locally, wiping a colleague\'s recent work on the next push.',
    root_cause: 'git add -A is indiscriminate. On a machine that had not pulled recent remote additions, it staged those files as deletions.',
    evidence_refs: ['CLAUDE.md R071'],
    smart_ai_prevention: 'Only specific files are staged by name. git add -A and git add . are forbidden. Pre-push hook checks for mass deletions.',
    verification_path: 'Attempt git add -A — confirm it is blocked or produces a visible warning in the hook.',
    retrieval_tags: ['git', 'add', 'deletion', 'multi_machine'],
  },
  {
    scar_id: 'R076',
    category: 'git_workflow',
    what_broke_in_v1: 'git push --force overwrote a commit that another machine had pushed 5 minutes earlier, losing a critical hotfix.',
    root_cause: 'Force push was used to resolve a "non-fast-forward" error instead of rebasing.',
    evidence_refs: ['CLAUDE.md R076'],
    smart_ai_prevention: 'git push --force is blocked by branch protection. Non-fast-forward errors must be resolved via git pull --rebase.',
    verification_path: 'Attempt git push --force — confirm it is rejected by GitHub branch protection.',
    retrieval_tags: ['git', 'force_push', 'branch_protection', 'data_loss'],
  },

  // ── SESSION / AGENT HYGIENE ───────────────────────────────────────────────
  {
    scar_id: 'R060',
    category: 'session_hygiene',
    what_broke_in_v1: 'A business rule was changed in a code comment but not in the Master Rules KB, causing the next session to apply the old rule.',
    root_cause: 'Two sources of truth for business rules. The KB was not updated when the code changed.',
    evidence_refs: ['CLAUDE.md R060', 'knowledge_articles table'],
    smart_ai_prevention: 'Business rules live in Smart AI Supabase system_docs and v1_scars. CLAUDE.md governs agent behaviour. No business rules in code comments.',
    verification_path: 'Any business rule change: confirm the sysdoc or scar is updated in the same session as the code change.',
    retrieval_tags: ['business_rules', 'knowledge_base', 'single_source'],
  },
  {
    scar_id: 'R101',
    category: 'session_hygiene',
    what_broke_in_v1: 'A lazy plan accepted the first reasonable-seeming approach (one MMLLC client for S0.8 verification) without challenging whether one data point was sufficient.',
    root_cause: 'R093 (no assumed facts) was respected but R101 (devil\'s advocate) was not applied to the plan shape. The plan was internally consistent but insufficiently challenged.',
    evidence_refs: ['CLAUDE.md R101', 'Antonio 2026-04-21'],
    smart_ai_prevention: 'Before any plan: answer five questions — (1) assumptions, (2) alternatives rejected, (3) weaknesses, (4) verified vs accepted, (5) path of least resistance vs actually better.',
    verification_path: 'Session log: any proposal must have a visible challenge step before Antonio approves it.',
    retrieval_tags: ['planning', 'devils_advocate', 'lazy_plan', 'agent_behavior'],
  },

  // ── PRODUCTION INCIDENTS FROM dev_tasks ───────────────────────────────────
  {
    scar_id: 'BUG-portal-contact-id',
    category: 'data_integrity',
    what_broke_in_v1: 'Portal chat messages showed wrong sender because contact_id was incorrectly resolved when account had multiple contacts.',
    root_cause: 'Enum audit found that portal_messages.contact_id was being set to the first contact found, not the authenticated portal user.',
    evidence_refs: ['dev_tasks: Enum audit + confirm-payment fix + Bug B portal contact_id'],
    smart_ai_prevention: 'Portal message author is always the authenticated session contact, resolved from the auth token. Never from a query that returns an arbitrary first row.',
    verification_path: 'Integration test: two contacts on same account send messages — each message must show correct sender.',
    retrieval_tags: ['portal', 'contact_id', 'auth', 'multi_contact'],
  },
  {
    scar_id: 'BUG-activate-silent-failure',
    category: 'client_communication',
    what_broke_in_v1: 'activate-service in supervised mode failed silently — the function returned without error but no services were activated.',
    root_cause: 'The supervised mode branch had a missing await that caused the activation promise to be abandoned. No error was surfaced.',
    evidence_refs: ['dev_tasks: Fix activate-service supervised mode silent failure'],
    smart_ai_prevention: 'All async activation paths are explicitly awaited. Inngest functions emit a result event on both success and failure. No fire-and-forget in activation paths.',
    verification_path: 'Integration test: run activation in all modes and verify an event is emitted for each outcome.',
    retrieval_tags: ['activation', 'async', 'silent_failure', 'inngest'],
  },
  {
    scar_id: 'BUG-crm-ein-field',
    category: 'data_integrity',
    what_broke_in_v1: 'crm_create_account used wrong field name ein instead of ein_number, silently dropping EIN data on account creation.',
    root_cause: 'Developer used the display label as the column name. No schema verification was done before writing the tool.',
    evidence_refs: ['dev_tasks: Fix crm_create_account ein → ein_number'],
    smart_ai_prevention: 'R093: every column name verified via information_schema before use. TypeScript typed row types generated from schema catch mismatches at compile time.',
    verification_path: 'information_schema: SELECT column_name FROM columns WHERE table_name=\'accounts\' — confirm ein_number is the correct column name.',
    retrieval_tags: ['column_name', 'assumption', 'crm', 'data_loss'],
  },
  {
    scar_id: 'BUG-qb-tool-registration',
    category: 'code_quality',
    what_broke_in_v1: 'A QuickBooks MCP tool was registered in route.ts but the import was commented out, causing a runtime error on first call.',
    root_cause: 'Import and registration were done in separate edits. The import was removed during cleanup but the registration call remained.',
    evidence_refs: ['dev_tasks: QB Tool Registration Fix + Invoice Batch March 11'],
    smart_ai_prevention: 'MCP tool count is verified by grep on active imports in route.ts. Commented imports = removed tools. Dead registration calls are caught by TypeScript (undefined reference).',
    verification_path: 'grep -v "//" app/api/[transport]/route.ts | grep "register.*Tools" — count must match actual exported tool count.',
    retrieval_tags: ['mcp', 'tool_registration', 'import', 'runtime_error'],
  },
  {
    scar_id: 'BUG-oa-send-idempotency',
    category: 'client_communication',
    what_broke_in_v1: 'OA send tool sent duplicate documents to clients when the MCP was called twice in the same session.',
    root_cause: 'oa_send did not use safeSend() pattern. No idempotency check before send.',
    evidence_refs: ['dev_tasks: Fix audit 2: oa_send migrare a safeSend'],
    smart_ai_prevention: 'All send operations use safeSend() with a 7-day idempotency window keyed on recipient+subject. Duplicate sends within the window are blocked.',
    verification_path: 'Call send function twice for same recipient+subject within 7 days — confirm second call returns alreadySent:true without sending.',
    retrieval_tags: ['idempotency', 'safe_send', 'oa', 'duplicate_send'],
  },
  {
    scar_id: 'BUG-vercel-cron-no-route',
    category: 'code_quality',
    what_broke_in_v1: 'A cron job was defined in vercel.json but the route handler file did not exist, causing silent 404s on every cron tick.',
    root_cause: 'vercel.json was updated but the route file was not created. No validation step checked route existence.',
    evidence_refs: ['dev_tasks: Fix audit 4: vercel.json cron senza route files'],
    smart_ai_prevention: 'Every Inngest/Vercel cron entry has a corresponding route handler verified in the same commit. Build step validates route existence.',
    verification_path: 'npm run build — Next.js reports 404 routes at build time for missing handlers.',
    retrieval_tags: ['cron', 'vercel', 'route', 'missing_handler'],
  },
  {
    scar_id: 'BUG-oa-suspense-wrapper',
    category: 'code_quality',
    what_broke_in_v1: 'OA page crashed in production with "useSearchParams() should be wrapped in a Suspense boundary" after Next.js upgrade.',
    root_cause: 'useSearchParams() requires a Suspense boundary in Next.js App Router. The page was migrated without adding it.',
    evidence_refs: ['dev_tasks: Fix audit 1: OA page Suspense wrapper'],
    smart_ai_prevention: 'Any component using useSearchParams() must be wrapped in Suspense. ESLint or TypeScript build catches this via next/core-web-vitals.',
    verification_path: 'npm run build — Next.js App Router emits a build error if Suspense boundary is missing for useSearchParams.',
    retrieval_tags: ['react', 'suspense', 'next_js', 'app_router', 'useSearchParams'],
  },
  {
    scar_id: 'BUG-gmail-html-overflow',
    category: 'client_communication',
    what_broke_in_v1: 'gmail_read returned raw HTML in the message body, making AI processing of email content impossible and overwhelming the context window.',
    root_cause: 'Gmail API returns HTML by default. The tool was not stripping HTML tags or truncating long messages.',
    evidence_refs: ['dev_tasks: Fix gmail_read: Strip HTML and raise character limit'],
    smart_ai_prevention: 'All email reading utilities strip HTML (DOMParser or regex), truncate at a configurable character limit, and return plain text only.',
    verification_path: 'Unit test: gmail_read response with HTML input must return plain text with no HTML tags.',
    retrieval_tags: ['gmail', 'html', 'parsing', 'context_window'],
  },
  {
    scar_id: 'BUG-offer-email-gate-bypass',
    category: 'security',
    what_broke_in_v1: 'Offer email gate was bypassed by a lead who guessed another lead\'s token from the sequential pattern.',
    root_cause: 'Offer tokens were generated as sequential integers, making them guessable.',
    evidence_refs: ['dev_tasks: Offer email gate fix + gmail_send lead automation'],
    smart_ai_prevention: 'All tokens are cryptographically random (crypto.randomUUID() or openssl rand). Sequential IDs are never used as access tokens.',
    verification_path: 'Token generation code: confirm use of crypto.randomBytes() or similar. No sequential counter in any token.',
    retrieval_tags: ['security', 'token', 'guessable', 'offer', 'auth'],
  },
  {
    scar_id: 'BUG-portal-chat-realtime',
    category: 'code_quality',
    what_broke_in_v1: 'Portal chat messages did not appear in real time after soft-delete was added, because the Realtime subscription only listened to INSERT, not UPDATE.',
    root_cause: 'Soft delete uses UPDATE (sets deleted_at), but the subscription filter was INSERT-only. Deleted messages were not removed from the live view.',
    evidence_refs: ['CLAUDE.md R100', 'commit 49d64df'],
    smart_ai_prevention: 'Any Realtime subscription on a soft-deletable table must listen to both INSERT and UPDATE. Client filters deleted_at IS NULL on received payloads.',
    verification_path: 'Realtime subscription test: soft-delete a message and confirm it disappears from the subscribed client within 1 second.',
    retrieval_tags: ['realtime', 'soft_delete', 'supabase', 'subscription'],
  },

  // ── ADDITIONAL SCARS FROM ARCHITECTURE / DESIGN ───────────────────────────
  {
    scar_id: 'ARCH-event-direct-write',
    category: 'data_integrity',
    what_broke_in_v1: 'Direct writes to events-equivalent tables bypassed idempotency checks, creating duplicate event rows that confused downstream processors.',
    root_cause: 'No enforced write path. Developers could INSERT directly into event tables.',
    evidence_refs: ['architecture §5 emit_event_atomic', 'Smart AI CLAUDE.md'],
    smart_ai_prevention: 'emit_event_atomic() is the ONLY write path to events + outbox. REVOKE on PUBLIC/anon/authenticated enforced at DB level. ESLint rule blocks direct pool.query to events table.',
    verification_path: 'Attempt INSERT into events as anon role — must get permission denied. Call emit_event_atomic as service_role — must succeed.',
    retrieval_tags: ['events', 'write_path', 'idempotency', 'rls'],
  },
  {
    scar_id: 'ARCH-outbox-lag',
    category: 'data_integrity',
    what_broke_in_v1: 'Events were emitted but outbox drain failed silently, leaving events in "pending" state indefinitely without alerting anyone.',
    root_cause: 'No monitoring on outbox backlog. Drain failures were swallowed.',
    evidence_refs: ['architecture §5.2 outbox drain', 'observability SLOs'],
    smart_ai_prevention: 'Outbox drain lag SLO: < 10 seconds. Alert fires when backlog > threshold. Drain function emits a result event on every run (success or failure).',
    verification_path: 'Observability: after emitting a test event, confirm outbox row transitions to published within 10 seconds.',
    retrieval_tags: ['outbox', 'drain', 'monitoring', 'slo'],
  },
  {
    scar_id: 'ARCH-pii-in-events',
    category: 'security',
    what_broke_in_v1: 'PII (client email, full name) was placed directly in event payloads, making the append-only event log a permanent PII store with no GDPR deletion path.',
    root_cause: 'Event payload design did not consider immutability + GDPR requirements together.',
    evidence_refs: ['architecture PII & security model', 'sensitive_data table'],
    smart_ai_prevention: 'Events store tokens (sensitive_data.token) not raw PII. Raw values live in sensitive_data with encrypted_value nullable for GDPR deletion. Events remain valid after PII erasure.',
    verification_path: 'Schema: events.payload must not contain email, full_name, or phone fields. Grep payloads for PII patterns in test data.',
    retrieval_tags: ['pii', 'gdpr', 'events', 'tokenisation'],
  },
  {
    scar_id: 'ARCH-spec-retroactive-price',
    category: 'data_integrity',
    what_broke_in_v1: 'Changing a service pricing rule retroactively changed what was shown on existing client invoices, causing billing disputes.',
    root_cause: 'Spec was mutable and applied live. No snapshot was taken at contract creation.',
    evidence_refs: ['architecture §6.3 Fix A', 'rule_overrides.effective_from'],
    smart_ai_prevention: 'Engagements snapshot spec_version_id at creation. resolveSpec() uses pin_date to exclude overrides after the contract date. Future spec edits cannot retroactively alter contracted prices.',
    verification_path: 'Test: create engagement at date T, add rule_override at T+1, re-run solver at T+2 — price must equal T value not T+2 value.',
    retrieval_tags: ['spec', 'pricing', 'retroactive', 'pin_date'],
  },
  {
    scar_id: 'ARCH-solver-db-write',
    category: 'code_quality',
    what_broke_in_v1: 'An equivalent evaluation function in v1 made DB writes during evaluation, making results non-deterministic and causing test interference.',
    root_cause: 'Mixing evaluation logic with side effects. Tests could not run in isolation.',
    evidence_refs: ['architecture §7.2 solver pure function'],
    smart_ai_prevention: 'evaluate() is a pure function with zero DB writes. All DB loading happens before evaluate() is called. Tests pass hand-built contexts directly.',
    verification_path: 'Unit test: evaluate() called 100 times with same context must return identical StatusReport each time.',
    retrieval_tags: ['solver', 'pure_function', 'determinism', 'testing'],
  },
  {
    scar_id: 'ARCH-inngest-6field-cron',
    category: 'code_quality',
    what_broke_in_v1: 'Inngest app sync was blocked because a 6-field cron expression (*/10 * * * * *) was used, which Inngest Cloud rejects.',
    root_cause: 'Developer assumed Inngest accepted standard 6-field cron (seconds field). Inngest only accepts 5-field cron.',
    evidence_refs: ['commit dfb4971', 'outbox-drain.ts'],
    smart_ai_prevention: 'All Inngest cron schedules use 5-field standard format only. Comments in code note this constraint.',
    verification_path: 'Inngest app sync must show green after any cron change. 5-field format (* * * * *) is the only accepted form.',
    retrieval_tags: ['inngest', 'cron', 'schedule', 'sync'],
  },
  {
    scar_id: 'ARCH-supabase-ref-mismatch',
    category: 'security',
    what_broke_in_v1: 'A misconfigured env var caused the app to connect to the wrong Supabase project silently (read real data, wrote to sandbox).',
    root_cause: 'No runtime assertion on Supabase project ref. App started and ran against wrong DB.',
    evidence_refs: ['lib/config.ts assertSmartAiRef', 'middleware.ts', 'EXPECTED_SUPABASE_REF'],
    smart_ai_prevention: 'middleware.ts asserts EXPECTED_SUPABASE_REF on every request. Fatal 500 on mismatch. lib/db/pg-pool.ts refuses FORBIDDEN_SUPABASE_REFS. Two-layer protection.',
    verification_path: 'Set EXPECTED_SUPABASE_REF to wrong value — confirm app returns fatal 500 on first request.',
    retrieval_tags: ['supabase', 'ref', 'env_var', 'misconfiguration'],
  },
  {
    scar_id: 'ARCH-module-level-init',
    category: 'code_quality',
    what_broke_in_v1: 'createClient() called at module level caused Next.js build to fail when env vars were not available at build time.',
    root_cause: 'Module-level code runs at import time, which happens during next build when env vars are not injected.',
    evidence_refs: ['CLAUDE.md arch reference: Module-Level Initialization'],
    smart_ai_prevention: 'All Supabase/DB clients use lazy initialisation (Proxy pattern or getter function). Never called at module level in route handlers or lib files.',
    verification_path: 'npm run build in CI without env vars — must not fail due to client initialisation errors.',
    retrieval_tags: ['next_js', 'module_init', 'build', 'env_vars'],
  },
  {
    scar_id: 'ARCH-webhook-sandbox-bleed',
    category: 'security',
    what_broke_in_v1: 'A sandbox webhook was accidentally registered with Stripe using the production URL, causing real Stripe events to be processed by sandbox code.',
    root_cause: 'No guard preventing sandbox app from accepting real provider webhooks.',
    evidence_refs: ['CLAUDE.md sandbox rules', 'middleware.ts SANDBOX_MODE'],
    smart_ai_prevention: 'SANDBOX_MODE=1 blocks all /api/webhooks/* with 503. Sandbox Vercel URL is never registered with any external provider.',
    verification_path: 'Set SANDBOX_MODE=1 and POST to /api/webhooks/stripe — confirm 503 response.',
    retrieval_tags: ['sandbox', 'webhook', 'stripe', 'isolation'],
  },
  {
    scar_id: 'ARCH-no-automation-platform',
    category: 'code_quality',
    what_broke_in_v1: 'A Make.com scenario broke after an API change in a connected tool, taking down an entire automation without any alerting.',
    root_cause: 'Third-party automation platforms (Make, Zapier) have no type safety, no version control, and fail silently.',
    evidence_refs: ['CLAUDE.md R089'],
    smart_ai_prevention: 'All automation via Inngest (code, typed, version-controlled) or Supabase Edge Functions. No Make, Zapier, or n8n.',
    verification_path: 'Architecture review: confirm no Make/Zapier/n8n credentials or webhook URLs exist in any Smart AI config.',
    retrieval_tags: ['automation', 'make', 'zapier', 'inngest', 'reliability'],
  },
  {
    scar_id: 'ARCH-mcp-tool-count',
    category: 'code_quality',
    what_broke_in_v1: 'MCP tool count in documentation diverged from actual registered tools because commented-out imports were counted as active.',
    root_cause: 'Tool count was derived by counting server.tool() calls across files, not by looking at active imports in route.ts.',
    evidence_refs: ['CLAUDE.md: MCP Tool Counting — Source of Truth'],
    smart_ai_prevention: 'Tool count derived solely from active (uncommented) imports + register calls in route.ts. Commented imports = removed tools. grep -v "//" is the verification command.',
    verification_path: 'grep -v "//" app/api/[transport]/route.ts | grep "register.*Tools" | wc -l — must match declared tool count.',
    retrieval_tags: ['mcp', 'tool_count', 'documentation', 'import'],
  },
  {
    scar_id: 'ARCH-decision-propagation',
    category: 'session_hygiene',
    what_broke_in_v1: 'A business rule was changed verbally in a session but only updated in CLAUDE.md, not in the knowledge_articles KB. Next session applied old rule.',
    root_cause: 'Decision propagation was manual and inconsistent. One target was updated, others were not.',
    evidence_refs: ['CLAUDE.md Decision Propagation — MANDATORY'],
    smart_ai_prevention: 'Every decision is classified into Behavior/Business/System and propagated to all targets in the same session. Smart AI uses system_docs as canonical state.',
    verification_path: 'After any architecture decision: confirm system_docs sysdoc is updated with a dated Updates entry in the same session.',
    retrieval_tags: ['decision', 'propagation', 'knowledge_base', 'consistency'],
  },
  {
    scar_id: 'ARCH-preview-missing',
    category: 'client_communication',
    what_broke_in_v1: 'A newly built form had no ?preview=td bypass, forcing the developer to use a real email to test it, polluting the client DB with test data.',
    root_cause: 'The preview bypass was added as an afterthought, not from day one of form development.',
    evidence_refs: ['CLAUDE.md: Forms (Client Data Collection)'],
    smart_ai_prevention: 'Every form includes ?preview=td bypass from the first commit. Pattern is documented and enforced in code review.',
    verification_path: 'For any new form route: GET /form-path?preview=td — must return 200 with ADMIN PREVIEW badge, no email gate.',
    retrieval_tags: ['form', 'preview', 'testing', 'admin'],
  },
];

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) { console.error('SUPABASE_DB_URL not set'); process.exit(1); }

  const pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
  let inserted = 0;
  let skipped = 0;

  for (const scar of SCARS) {
    const res = await pool.query(
      `INSERT INTO v1_scars
         (scar_id, category, what_broke_in_v1, root_cause, evidence_refs,
          smart_ai_prevention, verification_path, retrieval_tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (scar_id) DO NOTHING
       RETURNING id`,
      [
        scar.scar_id,
        scar.category,
        scar.what_broke_in_v1,
        scar.root_cause,
        scar.evidence_refs,
        scar.smart_ai_prevention,
        scar.verification_path,
        scar.retrieval_tags,
      ]
    );
    if (res.rowCount && res.rowCount > 0) inserted++;
    else skipped++;
  }

  const total = await pool.query('SELECT COUNT(*) as n FROM v1_scars');
  await pool.end();

  console.log(`Inserted: ${inserted}, Skipped (existing): ${skipped}`);
  console.log(`Total scars in DB: ${total.rows[0].n}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
