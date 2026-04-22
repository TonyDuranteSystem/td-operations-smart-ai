# Smart AI TD Operations — Architecture Plan

**Version:** 1.0 — Draft for multi-session challenge review
**Date:** 2026-04-21
**Status:** Pre-build. Signed-off decisions (D1-D9) locked. Plan open for structured challenge before Stage 0 begins.
**Cutover target:** 2026-10-21 (6 months from sign-off)
**Repo:** `TonyDuranteSystem/td-operations-smart-ai`
**Local path (lead machine — MacBook):** `~/Developer/td-operations-smart-ai/`
**Sandbox Supabase ref:** `tapbgvbglqacamhayfel` (verified alive 2026-04-21)
**Vercel project (to be created, S0.1):** `td-operations-v2`
**Staging domain:** `v2.tonydurante.us` (to be provisioned, S0.1)

**Owner (business):** Antonio Durante
**Owner (implementation):** Claude Code (Opus 4.7, 1M context) working from the MacBook
**Supervisor (quality gate):** R101 Devil's Advocate rule, enforced per-session, mechanically via `plan_challenge` MCP tool once shipped (dev_task `24cfad54`)

---

## Table of Contents

0. [Executive Summary](#0-executive-summary)
1. [Vision — In Antonio's Words](#1-vision--in-antonios-words)
2. [Scope and Non-Goals](#2-scope-and-non-goals)
3. [Architecture Overview](#3-architecture-overview)
4. [Layer 1 — Entity Graph](#4-layer-1--entity-graph)
5. [Layer 2 — Event Log](#5-layer-2--event-log)
6. [Layer 3 — Specification Engine](#6-layer-3--specification-engine)
7. [Layer 4 — The Solver](#7-layer-4--the-solver)
8. [Layer 5 — Ops Agent and AI Infrastructure](#8-layer-5--ops-agent-and-ai-infrastructure)
9. [v1 Scar Index — The Learning Layer](#9-v1-scar-index--the-learning-layer)
10. [Client Portal Experience](#10-client-portal-experience)
11. [Admin CRM Experience](#11-admin-crm-experience)
12. [Exception Handling](#12-exception-handling)
13. [Business Rules — The Honest Split](#13-business-rules--the-honest-split)
14. [Security, PII, Compliance](#14-security-pii-compliance)
15. [Claude API and Model Strategy](#15-claude-api-and-model-strategy)
16. [Workflow Engine — Inngest](#16-workflow-engine--inngest)
17. [Infrastructure and Environments](#17-infrastructure-and-environments)
18. [Observability](#18-observability)
19. [Build Stages](#19-build-stages)
20. [Migration Strategy](#20-migration-strategy)
21. [Governance and Session Discipline](#21-governance-and-session-discipline)
22. [Cost Model](#22-cost-model)
23. [Appendix A — Locked Decisions D1 through D9](#appendix-a--locked-decisions-d1-through-d9)
24. [Appendix B — S0.8 Verification Panel (30 Clients)](#appendix-b--s08-verification-panel-30-clients)
25. [Appendix C — v1 vs v2 — What Actually Changes](#appendix-c--v1-vs-v2--what-actually-changes)
26. [Appendix D — Glossary](#appendix-d--glossary)
27. [Appendix E — References](#appendix-e--references)

---

## 0. Executive Summary

Smart AI TD Operations is the greenfield successor to v1 TD Operations (`~/Developer/td-operations/`, Supabase ref `ydzipybqeebtpcvsbtvs`). The current system runs 253 Active client accounts (277 `account_type='Client'`, plus 30 One-Time and 2 Partner) across 15 service types. It works. It also has 101 scarring rules (CLAUDE.md R005 through R101), ~85 hardcoded service-type string literals across `lib/` and `app/`, a known pattern of "rules-as-prose that AI reads" that R093 and R101 exist specifically to counter, and an accreted architecture where adding a new service type is a multi-file code change.

The business wants three things it cannot get from v1:

1. **Flexibility.** Rules as data, not code. Exceptions as first-class. Rule changes without deployment.
2. **Intelligence.** AI as a first-class operator acting on the same interface as humans, not a chat bot bolted on top.
3. **Scale.** 225 → 500 → 1,000 clients without architectural rewrite, and without increasing Antonio's operational burden.

The target system rebuilds the data model around five layers (entity graph, event log, specification engine, solver, Ops Agent with tools) plus a sixth subsystem — the v1 Scar Index — that turns every v1 rule and every v1 bugfix into a structured guardrail that the agent retrieves at decision time. Infrastructure stays on Vercel + Supabase + adds Inngest (managed durable workflows). Rules author in TypeScript with a runtime-editable override layer in the CRM. The agent is a single Ops Agent with scoped tools, per-client context bundles, pgvector retrieval over SOPs and scars, and a multi-model stack (Claude Haiku 4.5 ~70% of calls, Sonnet 4.6 ~25%, Opus 4.7 ~5%) with prompt caching and Batch API applied wherever cacheable.

Cutover on 2026-10-21 brings **new clients only** into v2. The existing 253 clients stay on v1 until feature-by-feature migration after cutover. This is the single largest non-architectural constraint: it protects production during the build, and it sizes the first cutover to what is realistically achievable in 6 months.

Cost at 225 clients with the model mix and caching optimizations applied lands between $900 and $1,400 per month across Claude API, Inngest, Supabase, Vercel, embeddings, and monitoring. At 500 clients, $1,800-$2,500. At 1,000 clients, $3,500-$5,000 — at which point the $4,000/month cap that anchors the system to Antonio's current employee-equivalent spend must be explicitly raised. The cap exists so cost is visible, not to throttle quality.

The governing quality gate is R101 — Devil's Advocate Mandatory — committed to both v1 and Smart AI CLAUDE.md files as of 2026-04-21. R101 requires a five-question self-challenge before every plan, proposal, or decision reaches Antonio, and an enforcement tool (`plan_challenge` MCP, dev_task `24cfad54`) is being built to require structured challenge records before significant proposals ship. This plan itself is the first artifact produced under R101 discipline and is designed to be attacked by 2-3 fresh Claude sessions before Stage 0 begins.

This document is the standalone, defensible specification for what we are building. Every section is meant to survive cold reading by a reviewer who was not in the original conversations. If a claim in this document cannot be verified by opening a file, running a query, or citing a fresh tool output, it is flagged as unverified and called out as such.

---

## 1. Vision — In Antonio's Words

This section captures exactly what the system owner wants, in his own words. Every architectural decision in this document must trace back to these statements. If a design choice cannot be justified by one of them, it does not belong in the system.

### 1.1 What the system must be

*Antonio, 2026-04-21:*

> "I want a flexible and smart system that can understand the context, adapt to it, find the solution, propose and work on it. Everything must be used from the AI and from human on the UI. Everything must be connected, CRM and client portal.
>
> I have the SOP that fix the rules, but the rules can be changed any moment and the system must adapt to the changes.
>
> I want a system more flexible that can accept the exception instead of hardly demand to have, for example, a 'placeholder.' A lot of things in this system must follow an order according to the code. This is hard to manage and I feel like in a box where I can't move or decide something different if it doesn't reflect the code.
>
> It's like the system can't think out of the box. For me it's impossible that in 2026 with the AI a flexible and smarter system can't be built."

### 1.2 What the system must NOT be

> "Don't judge the timing, my business or how to get what I want rushing, assuming or looking for the shorter way. I want you to put all your effort to use the best technology available today to build the system that I want.
>
> I don't want you to judge my business. I want you to use your knowledge to let me know what is the best plan."

### 1.3 Scale requirement

> "The system serves 225 active clients today and must scale naturally to 500 and 1,000 without architectural changes. I am already struggling to manage 225 — the system must reduce operational burden as the client base grows, not increase it."

### 1.4 Economic anchor

> "I am already spending $4,000 for an employee that can do a quarter of what my broken system does today."

That number is the reference point for every AI cost decision. It is not a ceiling imposed to throttle quality; it is the business benchmark the system must beat. Cutting $500 off monthly AI spend at the cost of 10% agent-decision quality is the wrong trade.

### 1.5 Derived principles

From the statements above, the following principles govern every decision in this document:

1. **Flexibility is not optional. It is the primary architectural requirement.** The system must handle exceptions, out-of-order operations, and rule changes without code modifications for anything except genuinely structural changes.
2. **AI is a first-class operator, not an add-on.** Both humans and AI use the same interface, read the same data, act through the same authority layers, and produce the same audit trail.
3. **The portal and CRM are one system with two perspectives.** Clients and administrators see the same state from different angles. They never diverge because they read from the same solver output.
4. **SOPs define rules. Rules live as data.** When a rule changes, the system adapts immediately without deployment. Where rules must live as code (genuinely structural logic), they live as small, named, registered TypeScript functions — not scattered across 50 files.
5. **No shortcuts. No assumptions. No laziness.** Every layer is designed for the best possible outcome. R093 (no assumed facts) and R101 (devil's advocate mandatory) are enforced on every proposal, not just at architecture time.
6. **Quality over speed.** The system is built right, not fast. The forcing function (2026-10-21 cutover) exists to prevent the opposite failure — endless polishing without ship.

These are not aspirational. They are constraints. Every section of this plan must honor them, and a reviewer catching a violation should flag it explicitly.

---

## 2. Scope and Non-Goals

### 2.1 In scope for first cutover (2026-10-21)

Cutover on 2026-10-21 brings **new clients only** onto v2. The in-scope feature set at cutover day:

**Data model:**
- `contacts`, `accounts`, `account_members`, `engagements`, `events`, `outbox`, `sensitive_data`, `service_specs`, `rule_overrides`, `exceptions`, `proposals`, `ai_decisions`, `v1_scars`, `shadow_diffs`.

**Service types covered (first cutover):**
- SMLLC Formation (spec authored, solver validates end-to-end).
- MMLLC Formation (spec authored, with per-member document requirements).
- Client Onboarding (wizard auto-generates account, OA + Lease auto-generated at template level).
- Tax Return intake + routing (not full India filing handoff — intake only).

**Payments at cutover:**
- Stripe, Whop, wire transfer, and manual entry — all funnel through a single `payment.confirmed` event type.
- Invoice generation with version-pinned pricing (spec_version_id snapshots to engagement at creation so future spec edits cannot retroactively alter a contracted price).
- Canonical invoice numbering via the same `INV-NNNNNN` format as v1 (R098 preserved — invoice-number generator is race-safe via DB unique constraint, not a code retry loop).

**Portal v2 (client-facing):**
- Adaptive dashboard driven by solver output per logged-in contact's engagements.
- Dynamic wizards for Formation and Onboarding with per-member document upload.
- Unified timeline per client: every event, document, message, payment in chronological order.
- Portal chat integrated with the event log.

**CRM v2 (admin-facing):**
- Client 360 view per account (all engagements, all services, all members, all documents, all payments, unified timeline, AI-generated context summary).
- Proposal inbox for AI-generated actions with one-click approve/reject and batch operations.
- Spec editor for runtime-editable rule values (pricing, thresholds, cadences).
- Exception handling UI (one-click override with reason and audit trail).
- Event inspector (browse, search, filter all events).
- Intelligence-first dashboard (Needs Action, Blocked, Proposals, Anomalies, Healthy).

**Ops Agent (Stage 1):**
- Single agent with scoped tools: query events, query solver, create proposal, draft communication via `safeSend`, create exception record, read SOPs and scars via retrieval.
- Per-client context bundles cached between invocations.
- Multi-model tiering (Haiku/Sonnet/Opus) with prompt caching and Batch API.

**Workflow engine:**
- Inngest (managed) for all durable workflows: formation pipeline, onboarding pipeline, tax intake, payment handling, agent triggers, retry-with-backoff for every external call.

**v1 Scar Index:**
- ≥50 scars populated by Stage 0 exit. Build-time design guardrail + runtime agent retrieval signal.

**Infrastructure:**
- New Supabase project (ref `tapbgvbglqacamhayfel`).
- New Vercel project (`td-operations-v2`).
- New Inngest account.
- New staging domain (`v2.tonydurante.us`).
- New MCP server instance (cloned from v1 TD Ops MCP, repointed at Smart AI Supabase, trimmed to a greenfield tool surface).

### 2.2 Explicitly out of scope for first cutover

These features stay on v1 for their existing 253 clients and migrate feature-by-feature **after** cutover. They are not in the 2026-10-21 critical path.

**Service types deferred:**
- ITIN applications.
- Company closure.
- CMRA Mailing Address.
- Banking wizard flows (Payset, Relay, Sokin partner referrals).
- Operating Agreement full generation (first cutover has template-level only).
- Lease generation.
- Annual renewal logic (installment-driven, recurring services).
- Tax Return India routing + accountant handoff (intake only at first cutover).
- Bank statement processing.
- Bank referral click tracking.
- Referral payouts.
- Partner/affiliate commissions.
- Welcome package generation.
- Harbor Compliance integration.
- Calendly integration.
- Circleback integration.

**Integrations deferred:**
- QuickBooks sync (v1 rule R097 carries forward: manual-only, one-way downstream, button-driven in CRM. Not automatic. Not on Stripe/Whop/activation paths. If Antonio wants an automatic QB path later, it is a separate design decision.).
- Airtable sync.
- HubSpot sync.
- Full Gmail integration in CRM (shadow mode only at first cutover — inbound email classification via Triage path, but full inbox rendering deferred).
- Google Drive document automation beyond upload (folder tree creation, bulk move, drive_map — deferred).

**Existing 253 v1 clients:**
- They stay on v1 through cutover. All current service deliveries, payments, documents, and invoices continue to be managed in v1.
- Migration strategy (Section 20) governs how they move over post-cutover, feature-by-feature, on a schedule.

**Agents:**
- Specialist agents (Billing, Tax, Compliance, Communications, Portal-Support) are Stage 1+ additions. First cutover ships the single Ops Agent only.

### 2.3 Non-goals (explicit)

These are things the system will not try to do, now or later under this architecture:

1. **Replace human judgment on client-facing sends.** Auto-approval thresholds do not apply to client-visible actions — emails, invoices, contract sends. Those require human approval regardless of AI confidence. (Anti-pattern: "95% historical approval rate, so auto-send" on client emails. The reputational cost of one bad auto-send exceeds the efficiency gain of 50 good ones.)
2. **Perfectly match v1 behavior.** v1 has known bugs the scar index exists to document. Matching v1 would replicate those bugs. The solver's job is to correctly apply the spec, not to mirror v1's current output.
3. **Build an LLM-authored rule engine.** Rules are typed TypeScript with CRM-editable overrides. They are not free-form text the LLM interprets at runtime. AI evaluates *rules applied to clients* (e.g., "is this client eligible for post-September installment skip?"), not *what the rule is* (the rule is code).
4. **Build a workflow engine from scratch.** Inngest is the workflow engine. v1's cron + webhook + action_log pattern is reimplemented through Inngest's step functions, not reinvented.
5. **Share runtime state between v1 and v2.** Hard isolation. Shadow mode consumes v1 webhooks read-only; everything else is siloed.

### 2.4 Forcing function

**2026-10-21.** First new client lands on Smart AI TD Operations on that date.

If 7-8 months proves necessary, extension is allowed with explicit Antonio approval. Past that, it is a red flag requiring project-level re-examination, not silent slide. The date is in the architecture sysdoc, in the build dev_task description, in every progress log, and in the session-start reading protocol. It cannot drift by accident.

---

## 3. Architecture Overview

The system is built on **five layers plus one subsystem**. Every feature — from offer creation to tax filing to annual renewals — is expressed through these layers. No feature bypasses them. Adding a new feature is adding spec data, event types, policy rules, and agent tools — rarely new layers.

### 3.1 The five layers

| Layer | Purpose | Key primitive |
|---|---|---|
| **1. Entity Graph** | Who exists, what exists, how they relate | Contacts, accounts, account_members, engagements |
| **2. Event Log** | What happened, when, by whom, why | Append-only `events` table + `outbox` pattern |
| **3. Specification Engine** | What "done" looks like for each service | TypeScript specs seeded to DB + runtime overrides |
| **4. Solver** | What's done, what's missing, what's next | Pure function: spec + current state → status report |
| **5. Ops Agent + Tools** | Understand context, propose actions, learn | Single agent with scoped tools, per-client context, retrieval over SOPs + scars |

Each layer builds on the one below. The entity graph holds the facts. The event log records what has happened. The spec engine defines what is required. The solver evaluates what is true against what is needed. The Ops Agent uses the solver's output to understand context and propose actions.

**The portal and CRM are rendering layers** on top of the solver. The portal shows the logged-in contact what they need to do. The CRM shows admins what is happening across all clients. Both read from the same solver, so they cannot diverge.

### 3.2 The Scar Index subsystem (sixth first-class element)

Running alongside the five layers is the **v1 Scar Index** — a structured table of every failure mode v1 has suffered, mapped to a Smart AI prevention. The scar index has two uses:

- **Build-time:** every new feature is designed by first querying the scar index for related categories. Every matching scar must be provably prevented in the new code, by schema constraint, typed invariant, test case, or RLS policy. Prose-level promise does not count.
- **Runtime:** the Ops Agent retrieves relevant scars into its context bundle. If a proposed action matches a known failure pattern and the prevention condition is not satisfied in current state, the agent escalates regardless of confidence.

The scar index is populated from CLAUDE.md R005-R101, from v1 bugfix dev_tasks, from `action_log` anomalies, from the working-tree planning documents, and from session-captured observations (Section 9 details the full population strategy).

### 3.3 Flow of information

A client uploads a passport. The sequence:

1. **Portal UI** accepts the upload, writes the file to Supabase storage, calls an API route.
2. **API route** emits `document.uploaded` via `emit()`, which writes both to `events` and `outbox` in one transaction.
3. **Outbox drain worker** (Inngest scheduled, every 5-10 seconds) reads the outbox row, publishes the event to the Inngest event stream and to Supabase Realtime, marks the row `published`.
4. **Realtime subscription** fires on the admin's CRM client-360 page — the passport appears in the documents list immediately.
5. **Inngest workflow** triggered by `document.uploaded` calls the solver for the affected engagement. Solver re-evaluates. Requirement "member passport" transitions from `missing` to `satisfied`. Dependent requirements that were blocked on passport (e.g., `ein`) transition from `blocked` to `possible`.
6. **Ops Agent** is triggered by the requirement-status-change workflow. It reads the solver output, retrieves relevant scars ("EIN filing window," "SS-4 signer eligibility") and relevant SOPs, reasons via Claude API with structured output, and proposes: "File SS-4 for EIN. Signer: [member]. Expected turnaround: 2-3 weeks." Proposal lands in the CRM inbox.
7. **Admin** opens the proposal inbox, reviews, approves. Approval triggers an Inngest workflow that executes the filing path (template generation, signature request, tracking).

No silent writes. Every step emits an event. Every event is auditable forever. Every AI decision is logged with evidence and retrievable for future retrieval signals.

### 3.4 What this architecture rejects

Explicit rejections, each justified against an alternative:

- **Temporal for workflows.** Mature and powerful, but requires persistent workers (dedicated worker tier outside Vercel's serverless model), documented LLM-payload saturation issues for agent-heavy workloads (workflow history bloats with each prompt/response and requires external payload codecs to mitigate), and weeks-to-production vs Inngest's days-to-production. At Antonio's scale (225 → 1,000 clients, thousands of workflows per day not millions), Inngest is sufficient and simpler. If Smart AI ever outgrows Vercel, Temporal becomes a reconsider.
- **Pure JSONB specs as authoring form.** JSONB in the DB is the runtime representation. The authoring form is TypeScript with strict types, tested in unit tests, seeded at deploy time. Without type safety at authoring, spec schema evolution breaks every existing row silently.
- **OPA or Cedar for rules.** Both are excellent policy languages. But Antonio will not author Rego or Cedar directly. The CRM UI is the editor. The CRM UI would translate to a policy language anyway — pointless intermediate. TypeScript-first with a CRM override layer is the simpler, more honest version of the same pattern.
- **Pure per-client agents with persistent memory.** A stateful agent per client at 1,000 clients means 1,000 always-on agent instances — expensive, memory-management-hard, and diminishing returns. The event log + scar index + per-client context bundle (assembled on-demand on every invocation) gives the agent all the context a persistent agent would have, without the cost.
- **Multi-orchestrator agent architecture at Stage 1.** Current 2026 production research (arxiv.org/abs/2512.08769, beam.ai multi-agent analysis, Anthropic and OpenAI agent frameworks) is explicit: single-agent-with-good-context outperforms multi-agent for sequential workloads. Multi-agent pays off when subtasks can run concurrently. Smart AI's workflows are mostly sequential. The Ops Agent is one agent at Stage 1. Specialist agents (Billing, Tax, Compliance, Communications, Portal-Support) emerge at Stage 1+ only when concurrent workloads justify the complexity.

### 3.5 What this architecture does not guarantee

Honest about limits:

- **Zero v1 bugs replicated.** The solver is deterministic; the specs are correct by construction of the authoring discipline. But `v1_scars` requires manual curation of v1 failures, and scars we miss from v1 might re-occur in v2 before we identify them. The scar index lowers the risk; it does not eliminate it.
- **AI decisions will always be correct.** Claude, Haiku, Sonnet, Opus — all have calibration errors. A 91% confidence decision is not 91% accurate in practice. The observability stack (Section 18) includes calibration plots specifically to measure this gap over time and adjust thresholds empirically.
- **No outages.** Vercel, Supabase, Inngest, Anthropic — each has its own SLA. Combined availability is their product, not their minimum. A 4-nines world (each at 99.99%) multiplied across 4 dependencies is ~99.96% — about 3.5 hours per year of compound downtime. The system must degrade gracefully when any one fails.
- **No cost surprises.** The cost model (Section 22) is based on average-case assumptions. A spike in agent invocations — a client with many events, a model upgrade that increases input tokens per call — can move the envelope fast. Cost alerting fires at 80% of monthly cap; breach of 100% pages Antonio.

---

## 4. Layer 1 — Entity Graph

The entity graph holds the facts about who exists, what exists, and how they relate. It is the substrate every other layer sits on.

### 4.1 Core entities

**`contacts` (people).** Every person in the system: clients, members, spouses, partners, signers. Each contact has:
- Personal attributes: `full_name`, `first_name`, `last_name`, `email`, `email_2`, `phone`, `phone_2`, `language`, `preferred_channel`.
- Identity: `citizenship`, `residency`, `date_of_birth`, `gender`.
- Documents (tokenized, raw values live in `sensitive_data` — Section 14): `passport_on_file` (boolean), `passport_expiry_date`, `passport_number_token` (references `sensitive_data`), `itin_number_token`, `itin_issue_date`, `itin_renewal_date`.
- Address: `address_line1`, `address_city`, `address_state`, `address_zip`, `address_country`.
- Portal: `portal_tier` (text — `none` | `onboarding` | `active` | `suspended`), `portal_email_sent_at`, `portal_email_template`, `portal_role`, `kyc_status`.
- Referral: `referrer_type`, `referral_code`.
- Relationships: `primary_company_id` (weak signal for "which company is this contact most associated with" — authoritative member link lives in `account_members`).
- Audit: `created_at`, `updated_at`.
- QuickBooks: `qb_customer_id` (for eventual manual QB sync, R097).
- Test flag: `is_test` (boolean — keeps QA accounts out of production queries).

**`accounts` (companies).** Every company: LLCs, corporations, DBAs. Each account has:
- Identity: `company_name`, `entity_type` (enum — `Single Member LLC` | `Multi Member LLC` | `C-Corp Elected` | more as added), `ein_number_token` (references `sensitive_data`), `state_of_formation`, `formation_date`, `filing_id`.
- Addresses: `physical_address`, `registered_agent_address`, `registered_agent_provider`.
- Dates: `ra_renewal_date`, `annual_report_due_date`, `cmra_renewal_date`.
- Financial (summary fields for reporting — authoritative detail in `payments` and `invoices`): `installment_1_amount`, `installment_1_currency`, `installment_2_amount`, `installment_2_currency`, `setup_fee_amount`, `setup_fee_currency`, `setup_fee_paid_date`.
- Operational: `status` (enum — `Active` | `Suspended` | `Cancelled` | `Closed` | `Offboarding` | `Pending Formation`), `client_health` (enum — `green` | `yellow` | `red` | null), `account_type` (enum — `Client` | `One-Time` | `Partner`), `welcome_package_status`, `portal_account` (boolean), `portal_created_date`, `portal_tier`.
- Billing: `dunning_reminder_1_days`, `dunning_reminder_2_days`, `dunning_escalation_email`, `dunning_pause` (boolean), `payment_gateway`, `payment_link`, `bank_details` (jsonb — sanitized references only, never raw account numbers), `invoice_logo_url`, `communication_email`.
- Services bundle: `services_bundle` (text array — the service types active on this account; denormalized for quick display, authoritative source is `engagements` + `service_deliveries`).
- Storage: `drive_folder_id`, `gdrive_folder_url`, `kb_folder_path`.
- Referral: `referrer`, `lead_source`, `referred_by`, `referral_commission_pct`, `referral_status`, `partner_id`.
- Cancellation: `cancellation_requested` (boolean), `cancellation_date`.
- Integrations: `qb_customer_id`, `hc_company_id` (Harbor Compliance), `airtable_id`, `hubspot_id`, `zoho_account_id`.
- Notes: `notes` (text — free-form admin notes).
- Audit: `created_at`, `updated_at`.
- Test flag: `is_test`.

**`account_members` (the enhanced junction).** Replaces v1's `account_contacts` with a richer model that handles member lifecycle, signer designation, and audit provenance. Schema:

```sql
CREATE TABLE account_members (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  role                TEXT NOT NULL CHECK (role IN ('owner','member','manager','agent','signer','officer')),
  ownership_pct       NUMERIC CHECK (ownership_pct IS NULL OR (ownership_pct >= 0 AND ownership_pct <= 100)),
  is_primary          BOOLEAN NOT NULL DEFAULT false,
  is_signer           BOOLEAN NOT NULL DEFAULT false,
  joined_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at             TIMESTAMPTZ,                     -- NULL = active
  added_by            TEXT NOT NULL CHECK (added_by IN ('wizard','admin','agent','import','migration')),
  added_by_user_id    UUID,                            -- auth.users.id if actor is a human
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, contact_id, left_at)             -- partial uniqueness; allows rejoining after leaving
);

CREATE INDEX idx_account_members_active ON account_members(account_id) WHERE left_at IS NULL;
CREATE INDEX idx_account_members_contact ON account_members(contact_id);
```

**Key improvements over v1's `account_contacts`:**

1. **`is_signer` is explicit and changeable.** Changing the SS-4 signer in v1 is a multi-table update. Here it is one row update with an audit event.
2. **`left_at` supports member removal without data loss.** A member who leaves is still in the history; ownership_pct and role at time of departure are preserved. Historical queries can reconstruct the membership at any point in time.
3. **`added_by` tracks provenance.** You always know how a member got into the system — wizard-created, admin-added, agent-proposed-and-approved, bulk-imported, or migrated from v1.
4. **`role` is flexible.** Owner, member, manager, agent, signer, officer — any role the business defines. New roles are added as a CHECK constraint amendment (one migration). Not as a code refactor.
5. **Partial unique constraint.** `(account_id, contact_id, left_at)` allows a contact to rejoin an account they previously left — the `left_at=NULL` slot is occupied only by the currently-active membership; historical rows have `left_at` set and don't conflict.

**`engagements` (the commercial relationship).** New entity that represents the relationship between Tony Durante LLC and a client around a specific contract. This is where offers, contracts, services, and payments are anchored.

```sql
CREATE TABLE engagements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID REFERENCES accounts(id),  -- NULL until account exists
  contact_id            UUID NOT NULL REFERENCES contacts(id),  -- always has a person
  offer_id              UUID REFERENCES offers(id),    -- source of truth for contracted price and terms
  contract_type         TEXT NOT NULL CHECK (contract_type IN ('formation','onboarding','tax','itin','renewal','closure','banking','cmra','ra_renewal','other')),
  entity_type           TEXT,                          -- SMLLC, MMLLC, Corp — may be unknown at engagement creation
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','cancelled','failed')),
  spec_id               UUID NOT NULL REFERENCES service_specs(id),        -- which spec governs this engagement
  spec_version          INTEGER NOT NULL,                                  -- pinned at creation; future spec edits do not retroactively affect this engagement
  contracted_price      NUMERIC(10,2),                                     -- snapshot at engagement creation
  contracted_currency   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ,                                       -- set when work actually begins
  completed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT,
  metadata              JSONB DEFAULT '{}',                                -- flexible per-engagement data (e.g., special terms, override notes)
  created_by            TEXT NOT NULL CHECK (created_by IN ('wizard','admin','agent','import','migration')),
  created_by_user_id    UUID
);

CREATE INDEX idx_engagements_account ON engagements(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX idx_engagements_contact ON engagements(contact_id);
CREATE INDEX idx_engagements_spec ON engagements(spec_id);
CREATE INDEX idx_engagements_status ON engagements(status) WHERE status IN ('active','paused');
```

**`engagements` solves three v1 problems:**

1. **The placeholder account problem.** In v1, a formation creates an account with placeholder data, then updates it when state-of-formation confirms. This is brittle — the placeholder account looks real, gets indexed, can be found by search, can accumulate wrong data. In v2, an engagement exists without an account until the state confirms the LLC. `account_id` is nullable on engagement. Services, payments, and documents attach to the engagement and link to the account when it exists.

2. **Pricing version pinning.** Every engagement snapshots its `spec_version` at creation. When Antonio edits the MMLLC spec to change base pricing, existing engagements keep their snapshot version. Future offers use the new version. No retroactive price mutation. Contract-compliant.

3. **Commercial truth separation.** Current v1 conflates "the LLC as a business entity" with "the commercial contract TD has to serve that LLC." `engagements` separates them: one account can have multiple engagements over time (Formation engagement → Onboarding engagement → Renewal engagement → eventual Closure engagement). Each has its own status, lifecycle, and price.

### 4.2 Supporting entities

These are entities that attach to accounts, contacts, or engagements but are not the "center" of the entity graph.

**`offers`** — contract offers sent to contacts. Stores the unsigned offer body, signing state, token. Existing v1 pattern (the `offers` table) ports forward with minor cleanup.

**`service_deliveries` (SDs)** — individual units of work attached to an engagement. For a Formation engagement, the SDs are: Company Formation SD, EIN SD, Operating Agreement SD. For a Tax engagement: Tax Return SD per year, Extension SD when filed. Each SD has a stage progression, due date, and completion criteria driven by the spec.

**`payments`** — money movements. Every Stripe/Whop/wire/manual payment is a row here. Paired with an `invoice_number` generated via the race-safe generator (R098 carries forward). Linked to `engagement_id`, `account_id`, `contact_id`.

**`client_invoices`** — client's own sales invoices (their business, not TD's). R027 carries forward: TD systems NEVER write to this table. Only the client-facing portal invoice-creation flow writes here. This entity is separate from `payments` (which is TD's receivables).

**`client_expenses`** — the client's expense ledger. Auto-synced from `payments` (where TD billed the client — source='td_invoice') plus uploaded receipts plus manual entries.

**`td_expenses`** — TD's own operating expenses (vendor bills, filing fees, software subscriptions). Admin-managed via CRM Finance → Expenses tab.

**`documents`** — every client document. Uploaded from portal, pulled from Google Drive, generated from templates. Linked to `account_id` and/or `contact_id` (for member-level documents like passports). File path stored; actual bytes live in Google Drive Shared Drive (already paid for, already in use).

**`tasks`** — admin tasks. Assigned to Antonio or Luca. Linked to account or engagement. Status flow: `To Do` → `In Progress` → `Waiting` → `Done` (or `Cancelled`).

**`deadlines`** — date-based obligations (annual report due, tax filing deadline, RA renewal date). Derived from account fields (`annual_report_due_date`, `ra_renewal_date`) plus spec-defined cadences (tax return deadline depends on entity_type and tax_year).

**`leads`** — pre-contact funnel entities. Someone who inquired but hasn't signed. State machine: `New` → `Qualified` → `Offer Sent` → `Converted` (per v1 R094: `Converted` means PAYMENT confirmed, not offer signed). Ports forward with R094 semantics preserved — in v2 we have both the `leads` table for funnel tracking and an event `lead.converted` on the event log, so downstream consumers don't depend on column state alone.

### 4.3 What the entity graph does NOT include

- **AI-specific tables** (agent memory, proposals, conversations) — those live in the Ops Agent layer (Section 8).
- **Events and outbox** — Event Log layer (Section 5).
- **Specs and rule overrides** — Spec Engine layer (Section 6).
- **Exceptions** — Exception handling (Section 12).
- **Scars** — Scar Index subsystem (Section 9).

This separation keeps each layer's schema focused. The entity graph is "who and what"; everything else is "what happened" or "what should happen."

### 4.4 Entity graph RLS posture

Every client-visible table has row-level security. The portal access path is:

```
auth.uid → contacts.user_id → account_members.contact_id (where left_at IS NULL) → account_id
```

A contact sees only engagements, service_deliveries, documents, payments, members, and invoices where the account is in their active membership set. Admins (identified via a separate `admin_users` table plus JWT claim) bypass RLS via service-role policies.

RLS policies are designed upfront, before the first `emit()` call, before the first seed. Retrofitting RLS onto existing tables is painful and error-prone — v1 has known RLS edges that v2 should not inherit. Specific policy definitions are in Section 14.

### 4.5 Entity graph rationale and devil's-advocate flags

**[R101-FLAG on engagements vs case-centric model.]** The 2026-04-18 `target-control-model-challenge.md` in the v1 working tree argued that the missing layer is not per-engagement but per-client-case — a client-centric aggregate that names "what's happening with Juan's Delaware LLC right now across all services." The challenge doc's recommendation was to grow the `accounts` table with case-level fields (`current_phase`, `priority_focus`, `open_exception_count`).

This plan chose `engagements` over `accounts.case_state` because: (a) engagements are commercial contracts, they have contracts, prices, statuses, and lifecycles that an `accounts.case_state` column set does not capture, and (b) a single account can have multiple engagements over time (Formation → Onboarding → Tax Return → Renewal → Closure), and denormalizing all of their state into `accounts` collapses time.

**The open question for external challenge:** is the solver's "per-engagement status report" enough to answer the compound question "what's happening with this client across all services?" or do we need a per-account case aggregate on top of per-engagement solver output?

This plan's current answer: the CRM Client 360 view (Section 11) composes solver output across all engagements for a given account and renders the compound view. Compound state is a *render* concern, not a storage concern. If that answer breaks at 1,000 clients, we add a materialized `account_case_state` view at that point. Starting with storage denormalization before rendering proves it is needed is premature.

A reviewer session should attack this specifically: is per-engagement + render-time composition genuinely sufficient, or are there operational decisions (which reminder to send when there are overlapping blockers across engagements, priority focus across services) that require pre-computed compound state?

---

## 5. Layer 2 — Event Log

Every meaningful change in the system produces an event. Events are append-only — once written, they cannot be modified or deleted. This is the system's memory, its audit trail, its invalidation signal, and its scar-mining source.

### 5.1 Event schema

```sql
CREATE TABLE events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT NOT NULL,               -- e.g., 'payment.confirmed', 'member.added', 'document.uploaded'
  subject_type      TEXT NOT NULL,               -- e.g., 'engagement', 'account', 'contact', 'service_delivery'
  subject_id        UUID NOT NULL,
  actor_type        TEXT NOT NULL CHECK (actor_type IN ('human','agent','webhook','cron','system','migration')),
  actor_id          TEXT,                        -- user UUID for human, 'ops_agent' for agent, webhook provider name for webhook, cron job name for cron
  payload           JSONB NOT NULL,              -- typed per event_type (see §5.3)
  caused_by         UUID[] DEFAULT '{}',         -- event IDs that caused this one (for chain tracing)
  idempotency_key   TEXT UNIQUE,                 -- prevents duplicate events (webhook retries, AI proposals re-running)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_subject ON events(subject_type, subject_id, created_at DESC);
CREATE INDEX idx_events_type ON events(event_type, created_at DESC);
CREATE INDEX idx_events_actor ON events(actor_type, actor_id, created_at DESC);
CREATE INDEX idx_events_created ON events(created_at DESC);
```

**Every event answers four questions:**
- *What happened* — `event_type`
- *To what* — `subject_type` + `subject_id`
- *Who did it* — `actor_type` + `actor_id`
- *Why* — `caused_by` chain (walk back through IDs to trace the event that triggered this one, and the one before that)

This replaces v1's 176 database writes (per the audit referenced in the original Smart-AI plan; unverified at this point — will confirm at Stage 0 S0.2) scattered across MCP tools, webhook handlers, cron jobs, and portal API routes, each with inconsistent logging, inconsistent error handling, and no causation chain.

### 5.2 The outbox pattern — why "atomic emit" is not a promise, it is a mechanism

The original Smart-AI plan said "emit writes the event to the events table atomically with any state changes." That is a promise, not a mechanism. In Postgres + Next.js + Supabase + Inngest, there is no magic atomicity between "write a row" and "publish to a message bus." You have to build the atomicity.

**The outbox pattern:**

```sql
CREATE TABLE outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL UNIQUE REFERENCES events(id),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','publishing','published','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at       TIMESTAMPTZ,
  locked_by       TEXT
);

CREATE INDEX idx_outbox_pending ON outbox(created_at) WHERE status = 'pending';
CREATE INDEX idx_outbox_publishing ON outbox(locked_at) WHERE status = 'publishing';
```

`emit(event)` does this, inside one Postgres transaction:

1. `INSERT INTO events (...) RETURNING id` — get the event_id.
2. `INSERT INTO outbox (event_id, status) VALUES ($1, 'pending')` — record that this event needs to be published.
3. If both writes succeed, COMMIT. If either fails, ROLLBACK. No split-brain possible.

`emit()` returns the event_id. The caller does not wait for the event to be *published* — only for it to be *recorded*.

A separate **outbox drain worker** runs on Inngest (scheduled every 5-10 seconds, plus triggered on `outbox` insert via a Supabase Realtime subscription for low-latency):

```typescript
export const outboxDrain = inngest.createFunction(
  { id: 'outbox-drain', concurrency: 1 },
  { cron: '*/10 * * * * *' },     // every 10 seconds
  async ({ step }) => {
    const batch = await step.run('claim-batch', async () => {
      return await supabase.rpc('claim_outbox_batch', { limit: 100 });
    });

    for (const row of batch) {
      await step.run(`publish-${row.id}`, async () => {
        try {
          // Publish to Inngest event stream for downstream workflows
          await inngest.send({ id: row.event_id, name: row.event_type, data: row.payload });
          // Publish to Supabase Realtime channel for UI live updates
          await supabase.channel('events').send({ type: 'broadcast', event: row.event_type, payload: row });
          // Mark as published
          await supabase.from('outbox').update({ status: 'published', published_at: new Date() }).eq('id', row.id);
        } catch (err) {
          await supabase.from('outbox').update({
            status: row.attempts >= 5 ? 'failed' : 'pending',
            attempts: row.attempts + 1,
            last_error: err.message,
          }).eq('id', row.id);
          throw err;  // let Inngest retry per step
        }
      });
    }
  }
);
```

**Why this matters:**

- **No silent writes.** If a state change happens but `emit()` fails, the outer transaction rolls back. If `emit()` succeeds but the publish fails, the event still exists and will eventually publish; downstream workflows still fire.
- **No silent duplications.** `idempotency_key` on `events` blocks duplicate emits. A webhook that fires twice (Stripe famously retries on ACK timeouts) produces at most one event.
- **Natural backpressure.** If the publisher falls behind (Inngest rate limit, Supabase Realtime connection issue), the outbox queue grows. A monitoring alert fires when depth exceeds threshold. The system degrades visibly, not silently.
- **Recoverable.** If the drain worker crashes mid-batch, `locked_at` releases on restart (via a separate reaper cron), and pending rows republish. No lost events.

**This pattern is not invented.** It is a well-known pattern, documented by Microsoft, AWS, GoCardless, and countless others. Smart AI uses it because atomicity between storage and message bus is the single most common source of silent data loss in event-sourced systems, and the outbox is the proven fix.

### 5.3 Event types catalog

Events are organized by domain. The catalog below is the first-cutover set (Stage 0 S0.3 ships with these implemented; subsequent stages add more).

**Engagement lifecycle:**
- `engagement.created` — new client engagement starts. Payload: `{ contract_type, contact_id, offer_id, spec_id, spec_version, contracted_price }`.
- `engagement.started` — work begins. Payload: `{ trigger: 'payment_confirmed' | 'wizard_completed' | 'admin_manual' }`.
- `engagement.paused` — engagement temporarily held. Payload: `{ reason, paused_by }`.
- `engagement.resumed` — payload: `{ resumed_by }`.
- `engagement.completed` — engagement finished. Payload: `{ completion_type: 'full' | 'partial' | 'cancelled' }`.
- `engagement.cancelled` — payload: `{ cancellation_reason, cancelled_by, refund_amount }`.

**Account lifecycle:**
- `account.created` — new LLC exists in the system. Payload: `{ entity_type, state_of_formation }`.
- `account.formation_confirmed` — state-of-formation confirms the LLC exists. Payload: `{ filing_id, formation_date }`.
- `account.ein_received` — IRS issues EIN. Payload: `{ ein_number_token, received_date }`.
- `account.cancellation_requested` — payload: `{ reason, requested_by }`.
- `account.closed` — payload: `{ closure_type: 'voluntary' | 'admin' | 'automated' }`.

**Member lifecycle:**
- `member.added` — member linked to account. Payload: `{ contact_id, role, ownership_pct, is_primary, is_signer, added_by }`.
- `member.removed` — member leaves. Payload: `{ contact_id, reason, left_at }`.
- `member.role_changed` — payload: `{ contact_id, old_role, new_role }`.
- `member.signer_designated` — payload: `{ contact_id, effective_date }`.

**Payment lifecycle:**
- `payment.pending` — payment intent created. Payload: `{ amount, currency, method, invoice_number, engagement_id }`.
- `payment.confirmed` — payment received (Stripe succeeds, Whop webhooks confirm, wire cleared manually, admin marks paid). Payload: `{ amount, currency, method, invoice_number, engagement_id, transaction_id }`.
- `payment.failed` — payload: `{ failure_reason, amount, method }`.
- `payment.refunded` — payload: `{ amount, refund_id, reason }`.
- `payment.disputed` — payload: `{ dispute_id, dispute_reason, amount }`.

**Document lifecycle:**
- `document.uploaded` — document added to system. Payload: `{ doc_type, contact_id, account_id, file_path, uploaded_by }`.
- `document.classified` — AI classification result. Payload: `{ doc_type_classified, confidence, evaluator: 'agent' }`.
- `document.processed` — extraction complete. Payload: `{ extracted_fields, processing_method }`.
- `document.expired` — deadline-bound document passes expiry. Payload: `{ doc_type, expired_at }`.

**Requirement lifecycle:**
- `requirement.satisfied` — a spec requirement is now met. Payload: `{ requirement_key, evidence_event_id, spec_id }`.
- `requirement.unsatisfied` — a previously satisfied requirement is no longer met (e.g., a member leaves, a document expires). Payload: `{ requirement_key, reason }`.
- `requirement.blocked` — payload: `{ requirement_key, blocked_by: [requirement_keys] }`.
- `requirement.ai_evaluation_needed` — the solver flagged this requirement as requiring AI evaluation. Payload: `{ requirement_key, context }`.

**AI decisions:**
- `ai.decision` — AI evaluated a question and committed an answer. Payload: `{ question, decision, confidence, reasoning, model, evidence_cited: [sources], tokens_input, tokens_output, cached, scar_matches: [scar_ids] }`. These events are the audit trail for every AI action — and the source the solver reads (never calling AI inline, Section 7).

**Exceptions:**
- `exception.requested` — a human or agent proposes overriding a requirement. Payload: `{ requirement_key, exception_type, proposed_by, reason }`.
- `exception.approved` — override granted by authorized party. Payload: `{ requirement_key, exception_type, approved_by, reason, expires_at, evidence: [event_ids] }`.
- `exception.revoked` — previously granted exception rescinded. Payload: `{ exception_id, revoked_by, reason }`.

**Communications:**
- `communication.drafted` — agent drafted a message for admin review. Payload: `{ channel, recipient, template_id, body, draft_event_id }`.
- `communication.sent` — admin approved and message was sent, or the message was auto-sent under policy. Payload: `{ channel, recipient, template_id, provider_id, sent_by }`.
- `communication.bounced` — delivery failed. Payload: `{ reason }`.
- `communication.opened` — read receipt (email tracking pixel or portal open event). Payload: `{ opened_at, device }`.

**Proposals:**
- `proposal.created` — agent proposes an action. Payload: `{ action_type, parameters, rationale, confidence, evidence_events: [event_ids], expires_at }`.
- `proposal.approved` — admin approves. Payload: `{ proposal_id, approved_by, review_reason }`.
- `proposal.rejected` — admin rejects. Payload: `{ proposal_id, rejected_by, review_reason }`. Rejections feed retrieval signals: future proposals check "have similar proposals been rejected?" before surfacing.
- `proposal.expired` — proposal timed out without review. Payload: `{ proposal_id, expired_at }`.
- `proposal.auto_executed` — policy permitted auto-execution. Payload: `{ proposal_id, policy_id, policy_rule_matched }`.

**Rules and specs:**
- `spec.created` — new service spec seeded.
- `spec.updated` — spec version bumped.
- `rule_override.created` — Antonio edited a rule value in the CRM. Payload: `{ rule_key, old_value, new_value, changed_by }`.

**System:**
- `webhook.received` — inbound webhook arrived at any endpoint. Payload: `{ provider, signature_verified, raw_body_hash, headers }`.
- `webhook.rejected` — signature invalid or malformed. Payload: `{ provider, rejection_reason }`.
- `agent.invoked` — Ops Agent was called. Payload: `{ trigger_event_id, context_bundle_hash, tools_used }`. Useful for auditing agent frequency and cost.

This catalog grows as the system grows. Adding a new event type is adding a TypeScript type definition to `lib/events/types.ts`, a Zod schema validator, and a row to a registry — not a code refactor across many files.

### 5.4 emit() contract

`emit()` is the single entry point for writing to the event log. No other code writes directly to `events` or `outbox`. This is enforced by:

1. **ESLint rule** (`no-restricted-syntax` targeting `.from('events')` and `.from('outbox')` outside `lib/events/emit.ts`).
2. **Code review discipline.**
3. **Runtime check** in CI: grep the codebase for prohibited patterns; build fails if found.

The contract:

```typescript
// lib/events/emit.ts
import { eventSchemas } from './schemas';

export type EventInput<T extends EventType> = {
  event_type: T;
  subject_type: SubjectType;
  subject_id: string;
  actor_type: ActorType;
  actor_id?: string;
  payload: EventPayload<T>;  // typed per event_type via discriminated union
  caused_by?: string[];
  idempotency_key?: string;  // optional but STRONGLY RECOMMENDED for any event from a retry-capable source (webhook, cron, AI proposal)
};

export async function emit<T extends EventType>(input: EventInput<T>): Promise<{ event_id: string }> {
  // 1. Validate payload against the event_type's Zod schema
  const schema = eventSchemas[input.event_type];
  const validated = schema.parse(input.payload);  // throws on invalid

  // 2. Begin transaction, insert event + outbox atomically
  return await supabaseAdmin.rpc('emit_event', {
    p_event_type: input.event_type,
    p_subject_type: input.subject_type,
    p_subject_id: input.subject_id,
    p_actor_type: input.actor_type,
    p_actor_id: input.actor_id ?? null,
    p_payload: validated,
    p_caused_by: input.caused_by ?? [],
    p_idempotency_key: input.idempotency_key ?? null,
  });
}
```

The `emit_event` Postgres function wraps both inserts in a single transaction and handles `idempotency_key` uniqueness gracefully — duplicate-key violations return the existing event_id instead of erroring, so webhook retries are naturally idempotent.

### 5.5 What the event log is NOT

- **Not the solver's source of truth for "current state."** The solver reads the entity graph plus events as *evidence*. The entity graph tells you what is; the event log tells you how it came to be. They work together.
- **Not a message bus for inter-service communication.** Inngest is the message bus. Events are durable records; Inngest events (triggered from the outbox drain) are the execution signals.
- **Not a log of every read.** Only state changes are events. A user viewing a page does not produce an event. (Exception: security-sensitive reads might be logged to a separate `access_log` table in a future stage.)
- **Not a PII store.** PII (passport numbers, ITINs, EINs, DOBs, addresses) is tokenized in event payloads — the raw value is in `sensitive_data` and the payload holds a token. Section 14 details this.

### 5.6 Event log rationale and devil's-advocate flags

**[R101-FLAG on GDPR compatibility.]** Events are append-only. If a client requests GDPR deletion, and their PII sits in event payloads, you cannot comply without breaking the append-only invariant or leaving orphan tokens.

The resolution: PII in event payloads is always a token. Raw values live in `sensitive_data` with a per-row RLS policy and an explicit deletion path. GDPR deletion wipes the `sensitive_data` rows; the event payloads retain tokens that now resolve to `(deleted)`. Audit trail is preserved; PII is gone. This pattern is documented and implemented from day one in Section 14.

**[R101-FLAG on event schema evolution.]** What happens when we need to evolve an event type's payload? Example: `payment.confirmed` initially has `{ amount, currency, method, invoice_number }`. Later we need `platform_fee`, `net_amount`, `processor_fee`. Every historical event now has an incomplete payload.

The resolution:
1. **Never remove fields.** Add new fields with default values. Old consumers read old fields; new consumers read the new ones.
2. **Add a `schema_version` field** to every event payload from day one. Consumers match `(event_type, schema_version)` and can branch logic.
3. **When a breaking change is required**, introduce a new event type (`payment.confirmed.v2`) that runs alongside v1. Solver and agents consume both. Eventually, v1 is deprecated when no consumers read it.

This is the Google/Meta/Stripe discipline for event-sourced systems at scale. It is not elegant but it is correct.

**[R101-FLAG on transaction size.]** Long transactions (holding event + outbox + caller's DB writes) increase lock contention. If a caller is doing 20 writes in a single operation that also emits 20 events, the transaction holds row locks for the whole duration.

The resolution: `emit()` is a tight, fast call. The caller's DB writes happen in the SAME transaction, but the caller is responsible for keeping that transaction short. The solver's job is not to make atomic updates of 50 rows; it is to compute status. Workflows that need large atomic operations are broken into smaller steps via Inngest, each with its own transaction and event(s).

**[R101-FLAG on event volume at scale.]** At 1,000 clients with ~50 events per client per month (rough estimate — to be validated), the events table is 50k rows/month, 600k/year, 3M over 5 years. Postgres handles this fine. Query performance on `events` with the indexes above is sub-second. Cross-engagement analytics (e.g., "how many MMLLC formations reached EIN within 30 days last quarter") may need specialized indices or a separate analytics replica. Noted; deferred to Stage 3+.

---

## 6. Layer 3 — Specification Engine

For every service Tony Durante LLC delivers, there is a **specification** that defines what "done" looks like. Specifications are the most important abstraction in this system — they are where business rules live, where the solver gets its marching orders, and where Antonio's editability lives.

### 6.1 Authoring form: TypeScript

Specifications are authored as TypeScript files in `lib/specs/`. Each spec is a typed object with strict schema validation (Zod) at build time. They are committed to the repo, tested in unit tests, and seeded to the `service_specs` table at deploy time.

```typescript
// lib/specs/smllc-formation.ts
import { defineSpec, ReqData, ReqDocument, ReqDeliverable, ReqGate } from '@/lib/specs/dsl';

export const smllcFormation = defineSpec({
  service_type: 'smllc_formation',
  display_name: 'SMLLC Formation',
  version: 1,
  pricing_rules: {
    base_price_usd: 999,
    by_state: {
      'New Mexico': { filing_fee: 50 },
      'Wyoming': { filing_fee: 100 },
      'Delaware': { filing_fee: 90 },
      'Florida': { filing_fee: 125 },
    },
  },
  requirements: [
    ReqGate({
      key: 'payment',
      condition: { event_type: 'payment.confirmed', subject: '$engagement' },
      blocks: ['*'],  // no other requirement progresses until payment confirmed
    }),
    ReqData({
      key: 'company_name',
      condition: { field: 'account.company_name', not_null: true },
    }),
    ReqData({
      key: 'state',
      condition: { field: 'account.state_of_formation', not_null: true, in: ['New Mexico','Wyoming','Delaware','Florida','Nevada'] },
    }),
    ReqDocument({
      key: 'member_passport',
      doc_type: 'passport',
      per_member: true,
      condition: { contact_id: '$member.contact_id', not_expired: true },
    }),
    ReqDocument({
      key: 'member_proof_of_address',
      doc_type: 'proof_of_address',
      per_member: true,
      condition: { contact_id: '$member.contact_id' },
    }),
    ReqDeliverable({
      key: 'state_filing',
      condition: { event_type: 'account.formation_confirmed', subject: '$account' },
      depends_on: ['payment','company_name','state'],
      ai_hint: 'File via Harbor Compliance when dependencies met',
    }),
    ReqDeliverable({
      key: 'ein',
      condition: { event_type: 'account.ein_received', subject: '$account' },
      depends_on: ['state_filing'],
      requires_signer: true,
    }),
    ReqDeliverable({
      key: 'operating_agreement',
      condition: { event_type: 'document.uploaded', payload: { doc_type: 'operating_agreement_signed' } },
      depends_on: ['ein'],
    }),
  ],
  follow_up_rules: {
    // Reminder cadence per requirement status
    missing_member_passport: { first_reminder_days: 3, subsequent_every_days: 7, max_reminders: 5 },
    missing_member_proof_of_address: { first_reminder_days: 3, subsequent_every_days: 7, max_reminders: 5 },
    blocked_on_state_filing: { escalate_to_admin_after_days: 14 },
    blocked_on_ein: { escalate_to_admin_after_days: 21 },
  },
  exceptions_config: {
    'member_proof_of_address': { overridable_by: ['antonio','luca'], requires_reason: true },
    'member_passport': { overridable_by: ['antonio'], requires_reason: true, requires_alternative_document: true },
    'ein': { overridable_by: ['antonio'], requires_reason: true, note: 'EIN is legally required; override must include alternative evidence' },
  },
});
```

The DSL (`defineSpec`, `ReqData`, `ReqDocument`, etc.) provides typed authoring. IDE autocomplete catches mistakes. Unit tests import specs and assert over them. Refactoring (renaming a requirement key) is an IDE operation, not a grep-in-JSONB exercise.

### 6.2 Runtime form: service_specs table

On deploy, specs are serialized to the `service_specs` table:

```sql
CREATE TABLE service_specs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type      TEXT NOT NULL,
  version           INTEGER NOT NULL,
  display_name      TEXT NOT NULL,
  spec_json         JSONB NOT NULL,                -- serialized TypeScript spec
  pricing_rules     JSONB NOT NULL,
  requirements      JSONB NOT NULL,
  follow_up_rules   JSONB NOT NULL,
  exceptions_config JSONB NOT NULL,
  seeded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  seeded_by         TEXT NOT NULL,                 -- git commit SHA
  active            BOOLEAN NOT NULL DEFAULT true, -- false = archived, kept for historical engagements
  UNIQUE (service_type, version)
);

CREATE INDEX idx_service_specs_active ON service_specs(service_type, version) WHERE active = true;
```

Each engagement pins to a specific `(service_type, version)` at creation (`engagements.spec_id`, `engagements.spec_version`). When the spec is edited and a new version is seeded, existing engagements keep their pinned version; new engagements use the new version.

### 6.3 The rule override layer

Some values in a spec are inherently variable — pricing, reminder cadences, grace periods, exception configurations. Antonio wants to edit these without a deploy. The `rule_overrides` table is where runtime edits live:

```sql
CREATE TABLE rule_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_id         UUID NOT NULL REFERENCES service_specs(id),
  rule_path       TEXT NOT NULL,                  -- JSON path into the spec, e.g., 'pricing_rules.base_price_usd'
  override_value  JSONB NOT NULL,
  reason          TEXT NOT NULL,                  -- why this override exists
  created_by      UUID NOT NULL,                  -- auth.users.id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to    TIMESTAMPTZ,                    -- NULL = indefinite
  active          BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_rule_overrides_active ON rule_overrides(spec_id, rule_path) WHERE active = true;
```

At spec-resolution time, the effective spec is computed as: `spec_json` from `service_specs` deep-merged with active `rule_overrides` for that spec. The solver, the agent, and the CRM all call `resolveSpec(spec_id)` which returns the effective spec.

**What can be overridden:**
- `pricing_rules.*` (all pricing values).
- `follow_up_rules.*` (reminder cadences, escalation thresholds).
- `exceptions_config.*` (who can override what, with what alternatives).
- Constants in conditions (e.g., the minimum members count for MMLLC).
- Grace periods, thresholds, cadences.

**What cannot be overridden (requires code change):**
- Requirement *structure* (adding a new requirement, changing `depends_on` topology, changing `per_member` or `per_account` scoping).
- Condition *shape* (e.g., switching from `field.not_null` to `event_type.exists` is a structural change).
- Requirement types (`ReqData` vs `ReqDocument` vs `ReqDeliverable` vs `ReqGate`).

This split is the honest version of Antonio's goal: "rules live as data." Value-level edits are data (editable via CRM). Structural edits are code (require deploy). Most business rule changes are value-level — pricing, cadence, threshold.

### 6.4 Requirement structure — the four kinds

**`ReqGate`.** A hard prerequisite. Blocks all other requirements (or a named subset) until satisfied. Payment is the canonical gate.

**`ReqData`.** A field on an entity must have a value (optionally meeting a predicate). "Account has a company name." "Account's state is in the supported states list."

**`ReqDocument`.** A document of a specified type exists, attached to a specific entity, optionally meeting criteria (not expired, signed, etc.). Supports `per_member`, `per_account`, or scoped to the engagement.

**`ReqDeliverable`.** An event of the specified type has occurred for the subject, indicating TD has produced an output (filed something, received something, sent something).

Each requirement also carries:
- **`key`** — unique within the spec.
- **`depends_on`** — requirement keys that must be satisfied first.
- **`blocks`** — requirement keys that this one blocks (inverse dependency, useful for gates).
- **`per_member`** / **`per_account`** — scope.
- **`requires_signer`** — special hint for EIN-like requirements that need the designated signer.
- **`ai_hint`** — free-text hint for the agent about what action to propose when this becomes `possible`.
- **`ai_evaluable`** — boolean. If true, the requirement's condition is evaluated by the agent rather than the solver directly. The solver does not call the AI inline; instead, it reads the most recent `ai.decision` event for this requirement. If no recent decision exists, it triggers an `agent.invoked` workflow and reports `evaluation_pending`.
- **`overridable`** — spec-level flag whether exceptions_config applies to this requirement.

### 6.5 Seeding and versioning

On every deploy:

1. The build process imports all TypeScript specs from `lib/specs/`.
2. Each spec is validated against its Zod schema.
3. The seeder computes the current content hash of each spec.
4. For each spec, the seeder checks: does the latest version in `service_specs` have the same content hash?
   - If yes: no-op.
   - If no: insert a new row with incremented version. Previous versions are marked `active = false`.
5. A seeding event is emitted: `spec.created` or `spec.updated` with payload `{ service_type, version, content_hash, git_sha }`.

### 6.6 Spec evolution and migration

When a spec's *structural* shape changes (new requirement, changed dependency topology), existing engagements are unaffected — they keep their pinned version. But the question becomes: when should an existing engagement be migrated to a new spec version?

Default answer: never automatically. Structural spec changes are rare (the business changes its offering, not its data); existing contracts should be honored. An admin-initiated "migrate engagement X to spec version Y" action is supported in the CRM Spec Editor, but only when Antonio explicitly decides the migration is appropriate (e.g., a client's engagement has been paused for months, they want to resume under the new terms).

Value-level changes (via `rule_overrides`) apply to all engagements using that spec as of the override's `effective_from` — and the engagement's own resolved spec is recomputed on the next solver invocation. This is intentional: if pricing for existing engagements should NOT change (they have contracted prices), the pricing override must use `effective_from: [future date]` or scope to new engagements only via a condition.

### 6.7 Spec rationale and devil's-advocate flags

**[R101-FLAG on authoring-vs-editing split.]** There is a gap between "Antonio can change pricing in the CRM" and "Antonio wants to add a new requirement like 'require a second passport page for certain states.'" The second is a structural change requiring code. Antonio may not see the distinction clearly; the UI must communicate it.

The resolution: the CRM Spec Editor has two tabs — **Values** (all override-able fields, with preview of current effective value vs proposed) and **Structure** (read-only view of requirements, with a "propose structural change" button that creates a dev_task but does not directly mutate the spec). If Antonio wants structural changes, he proposes them; Claude Code (or a future engineer) implements; the deploy seeds the new version.

**[R101-FLAG on override conflicts.]** What if two overrides target the same `rule_path` with different `effective_from` windows? What if one is active and another becomes active later?

The resolution: the resolver picks the *most recently created* active override for each rule_path. Overlapping effective_from/effective_to are allowed; newer wins. The audit trail (`created_by`, `created_at`, `reason`) makes this transparent. If two admins edit the same value within minutes of each other, the last write wins (Postgres-level, with optimistic concurrency via `updated_at` check on the CRM save action to detect and warn).

**[R101-FLAG on the "ai_evaluable" flag as a back door.]** Marking a requirement as `ai_evaluable` says "this is too context-dependent for a pure data check — let the agent decide." That is a back door for avoiding hard design work. The temptation is to flag every edge case `ai_evaluable` and rely on the agent to sort it out.

The resolution: `ai_evaluable` requires approval in code review. Every new `ai_evaluable` requirement comes with a documented rationale (why data + code is insufficient), a defined input contract (what context the agent gets), a defined output contract (what the agent returns), and unit test coverage of at least 5 example cases with expected outputs. The scar index will surface cases where `ai_evaluable` was used as an escape hatch and the agent's decisions drifted — those become future scars pushing the logic back into structured rules.

---

*(Plan continues in Part 2, next turn. Remaining sections: Layer 4 Solver, Layer 5 Ops Agent, Scar Index, Portal UX, CRM UX, Exception Handling, Business Rules, Security/PII, Claude API, Inngest, Infrastructure, Observability, Build Stages, Migration, Governance, Cost Model, Appendices A-E.)*
