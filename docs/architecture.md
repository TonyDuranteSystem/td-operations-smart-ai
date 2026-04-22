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

---

## 7. Layer 4 — The Solver

The solver is the brain of the system. It takes a specification and the current state of an engagement and returns a complete status report: what's done, what's missing, what's blocked, what's possible right now, and what exceptions are active. The solver is the single source of truth that powers the portal, the CRM, the agent's context, and every scheduled follow-up.

### 7.1 The solver contract

```typescript
// lib/solver/solve.ts
type StatusReport = {
  engagement_id: string;
  spec_id: string;
  spec_version: number;
  overall_progress: number;            // 0.0 to 1.0
  requirements: RequirementStatus[];
  exceptions_active: ExceptionRecord[];
  next_actions: NextAction[];
  evaluation_pending: string[];        // requirement keys awaiting ai_evaluable
  computed_at: string;                 // ISO timestamp
  cache_key: string;                   // hash of inputs used
};

type RequirementStatus = {
  key: string;
  type: 'gate' | 'data' | 'document' | 'deliverable';
  status: 'satisfied' | 'possible' | 'blocked' | 'missing' | 'evaluation_pending' | 'satisfied_by_exception';
  satisfied_at?: string;
  evidence_event_ids?: string[];       // which events provided evidence
  blocked_by?: string[];               // requirement keys blocking this one
  scope?: { per_member?: boolean; contact_id?: string };
  action_hint?: string;                // from spec ai_hint
  exception_id?: string;               // if status = satisfied_by_exception
};

type NextAction = {
  priority: number;                    // 1 = highest
  action: string;                      // human-readable
  target: 'client' | 'admin' | 'agent';
  channel?: 'portal_notification' | 'email' | 'task' | 'agent_queue';
  requirement_key: string;
};

export async function solve(engagementId: string): Promise<StatusReport> {
  // 1. Load engagement + spec + events (bounded by subject_id)
  // 2. Load active exceptions for this engagement
  // 3. For each requirement in the spec, evaluate against events + entity state
  // 4. Compute dependency topology: which requirements are blocked
  // 5. For ai_evaluable requirements, read the latest ai.decision event; if none or stale, queue evaluation
  // 6. Compute next_actions by priority
  // 7. Return; do NOT write
}
```

### 7.2 Design principles

**The solver is deterministic.** Same inputs → same outputs. No randomness, no timestamps in the logic except where explicitly required (e.g., "document expired" is a time-dependent check but the time is an input, not a side effect).

**The solver is pure.** No DB writes. No API calls. No event emissions. It reads and computes. Purity is enforced by:
1. **No `emit()` call inside `solve()` or any function it transitively calls.** ESLint rule + code review.
2. **No Supabase write helper** (`dbWrite`, `dbWriteSafe`) called inside solver code paths.
3. **Runtime check**: the solver module exports a `_ensurePure()` hook that, in test mode, wraps all DB clients with a proxy that throws on any write method.

**The solver is composable.** A client with Formation + Tax + RA Renewal engagements has the solver called independently per engagement. Each returns its own `StatusReport`. Compound rendering (CRM Client 360) composes them. Cross-engagement dependencies (e.g., "tax return creation requires completed formation") are expressed as spec-level references — the Tax Return spec has a requirement `formation_complete` whose condition checks for a completed Formation engagement on the same account.

**The solver handles complexity honestly.** Simple conditions (field not null, event exists) are evaluated directly. Complex conditions (post-September installment eligibility, treaty-based ITIN eligibility) are flagged `ai_evaluable` and delegated to the agent layer — but the agent does NOT run inline during `solve()`. Instead:

1. The solver reads the latest `ai.decision` event for this `(engagement_id, requirement_key)` pair.
2. If a decision exists and is fresh (within a configurable TTL, default 24 hours), the solver uses it.
3. If no decision exists or it is stale, the solver returns `status: 'evaluation_pending'` for that requirement and emits a workflow signal (via an Inngest event triggered by the next `emit()` call, not inline) to invoke the agent.
4. The agent evaluates asynchronously, emits an `ai.decision` event, and the next solver invocation uses it.

This breaks the "solver is pure" promise that the original plan made while trying to include AI. The resolution: AI decisions are *events* stored in the event log; the solver reads events, not models. The AI is invoked by a separate workflow, not by the solver. Clean separation.

### 7.3 Solver caching

The solver is called frequently — every portal page load, every CRM client 360 render, every Inngest workflow step that needs to check status. Without caching, each call rebuilds the full status from events, which is unnecessary work for engagements whose state hasn't changed.

**Event-driven cache invalidation:**

```sql
CREATE TABLE solver_cache (
  engagement_id    UUID PRIMARY KEY REFERENCES engagements(id),
  status_report    JSONB NOT NULL,
  input_hash       TEXT NOT NULL,               -- hash of (spec_version, last_event_id_for_subject, active_exceptions_hash)
  computed_at      TIMESTAMPTZ NOT NULL,
  valid_until      TIMESTAMPTZ                  -- optional TTL for time-dependent requirements
);

CREATE INDEX idx_solver_cache_valid ON solver_cache(valid_until) WHERE valid_until IS NOT NULL;
```

On every `emit()` call, the outbox drain worker identifies which engagements are affected (via the event's `subject_id` and related lookups — e.g., a `member.added` event affects all engagements on that account). For each affected engagement, the cache row is invalidated (set `valid_until = now()`).

On solve request:
1. Compute current `input_hash`.
2. Check cache: if `engagement_id` row exists AND `input_hash` matches AND `valid_until > now()`, return cached `status_report`.
3. Else, compute fresh. Write to cache. Return.

Cache fills gradually under load. First-request latency is unchanged; subsequent reads are O(1) until invalidation.

### 7.4 Solver evaluation logic

For each requirement in the spec, the solver runs:

**If `type: gate`:** evaluate condition. If met, `status: satisfied`. Gate requirements block everything else (or a specified subset via `blocks`).

**If `type: data`:** evaluate the field condition against the entity state (`account`, `contact`, `engagement`). Field not null / equals / in list / etc. If met, `status: satisfied`.

**If `type: document`:** check for a `document.uploaded` event (and absence of `document.expired`) matching the spec's condition. For `per_member` requirements, iterate over `account_members where left_at IS NULL` and report status per-member.

**If `type: deliverable`:** check for the specified event type (e.g., `account.ein_received`). If the event exists and is recent enough (per spec), `status: satisfied`.

**Dependency resolution:**
After each requirement is evaluated in isolation, the solver runs a topological pass:
- For each requirement with `depends_on`, if any dependency is not `satisfied` or `satisfied_by_exception`, mark this requirement `blocked` and record `blocked_by: [dependency keys]`.
- If all dependencies are satisfied AND this requirement is not satisfied, mark `possible` (ready to work on).

**Exception handling:**
- For each active exception on this engagement (from the `exceptions` table, `status = 'active'`), find the referenced requirement and override its status to `satisfied_by_exception`. Downstream requirements that depended on it become unblocked naturally.

### 7.5 Next actions computation

Once statuses are computed, the solver produces a prioritized list of next actions:

```typescript
// For each requirement:
// - If status = 'missing' and type = 'document' (per_member): next_action targets the specific member, channel = 'portal_notification'
// - If status = 'missing' and type = 'data': next_action targets either client (if data comes from wizard) or admin (if data is admin-entered)
// - If status = 'possible' and type = 'deliverable': next_action targets admin via 'task' channel (TD must file, send, confirm)
// - If status = 'blocked': no next action (propagates upstream)
// - If status = 'evaluation_pending': queue agent evaluation
```

Priority is set by:
1. **Gates always first** (payment is the canonical gate).
2. **Within the same status level**, shorter `depends_on` chains come first (closer to "done" than "foundational").
3. **Age of request** — a missing requirement that's been `missing` longer has higher priority than a just-became-missing one.
4. **Client-visible actions** are bumped above admin-invisible ones (move the client forward).

### 7.6 Solver rationale and devil's-advocate flags

**[R101-FLAG on cache invalidation correctness.]** Event-driven cache invalidation requires that every event that could change a solver output triggers cache invalidation. If we forget to wire up invalidation for some event type, the cache serves stale data silently.

The resolution: the drain worker has a *generic* invalidation rule — it looks at the `subject_type` + `subject_id` of every event and invalidates all engagements linked to that subject. The only exception is events that are known to have no solver impact (e.g., `communication.opened`); those are in an explicit allowlist of "non-invalidating" event types. This is safer than the inverse (specify which events DO invalidate), because the default is correctness over performance. An unknown new event type invalidates the cache and re-runs the solver — fine; a small performance cost, not a correctness bug.

**[R101-FLAG on evaluation_pending deadlocks.]** What if an agent's `ai_evaluable` decision is required for a requirement, but the workflow that triggers the agent fails silently and never produces an `ai.decision` event? The solver perpetually returns `evaluation_pending`.

The resolution: the agent workflow is governed by Inngest's step functions with automatic retries and alerting. If after N retries and T time the decision is still missing, a `proposal.created` event surfaces the stuck requirement to the admin inbox: "Agent evaluation failing for requirement X on engagement Y; manual decision required." An admin can answer directly, which emits `ai.decision` with `actor_type: 'human'` and unblocks the solver. Stuck evaluations are observable, not silent.

**[R101-FLAG on solver performance at 1,000 clients.]** If a single engagement has thousands of events (long-lived clients with many services), the solver's event scan can become expensive. At 1,000 clients × tens of solver calls per day × expensive scans, latency grows.

The resolution: two optimizations deferred to Stage 2+ but designed for now:
1. **Event scan pruning.** The solver reads only events for `subject_id IN (engagement_id, account_id, member_contact_ids)` filtered by `event_type IN (relevant_types_per_spec)`. Indices support this. Scan stays bounded.
2. **Materialized per-requirement evidence table.** For slow-evolving requirements (e.g., `ein`, satisfied once and never re-evaluated), we can materialize the satisfaction event reference on first satisfaction and query it directly rather than re-scanning events. This is a Stage 2+ optimization; not built at Stage 0.

**[R101-FLAG on cross-engagement dependency evaluation.]** A Tax Return engagement has a requirement `formation_complete` that depends on the sibling Formation engagement. When the solver evaluates the Tax engagement, does it recursively call `solve()` on the Formation engagement? That could cause deep recursion on accounts with many service engagements.

The resolution: cross-engagement dependencies are expressed as event references, not recursive spec references. `formation_complete` is a requirement whose condition is "an `engagement.completed` event exists for an engagement of `contract_type='formation'` on the same `account_id`." The solver reads events, not other solver results. No recursion. If the formation-complete event hasn't fired, the tax requirement is `blocked` and shows `blocked_by: ['formation_complete']`; the admin clicks into the formation engagement directly to see its own status.

---

## 8. Layer 5 — Ops Agent and AI Infrastructure

The Ops Agent is the intelligent layer that transforms solver output into proposed actions, interprets ambiguous SOP rules, and provides live context on CRM client pages. It is one agent at Stage 1 — not six. Specialization emerges later, only when justified.

### 8.1 Why a single agent at Stage 1

Research (2026 production agent analysis including Anthropic, Vellum, Virtido, Beam, and arxiv/2512.08769):

> *"A single agent with a clear goal, a few tools, and good prompting solves more than most teams expect. The mistake engineers make is jumping straight to multi-agent architectures because they sound more capable. They're not inherently more capable. They're more complex, which means more failure surfaces."*

And:

> *"The real question is whether your task can be decomposed into parallel workstreams. If steps must happen sequentially and share state, a single agent with a planning loop handles it cleanly. If independent subtasks can run concurrently, that's where multi-agent pays off."*

Smart AI's workflows at Stage 1 are almost entirely sequential: a formation moves through stages; an onboarding follows a sequence; a tax intake gathers data before routing. Multi-agent at Stage 1 would create coordination overhead (hand-offs, context sharing, disagreement resolution) for no parallelism benefit.

**Specialist agents emerge when:**
- A domain requires different model tier consistently (e.g., Tax/Compliance always benefits from Opus-level reasoning; Triage always benefits from Haiku-level speed).
- A domain has distinct tool sets that don't intersect with other domains.
- Concurrent workloads in different domains create queue contention in a single agent.

Expected Stage 1+ specialist split (not Stage 1):
1. **Triage Agent** — classify inbound emails, portal messages, documents; route to the right engagement. Cheap model (Haiku).
2. **Compliance Agent** — watches solver output for missing requirements, overdue items, approaching deadlines; generates proposals. Mixed tier.
3. **Communications Agent** — drafts messages (reminders, status updates, responses); reviews outgoing text for tone and accuracy. Mixed tier.
4. **Billing Agent** — watches payment events, invoice creation, overdue state; routine work on Haiku, anomalies on Opus.
5. **Tax Agent** — knows tax-return workflows, deadlines, India-routing rules. Opus-heavy for ambiguous returns.
6. **Portal-Support Agent** — handles client chat questions in the portal; cheap model with human escalation.

Stage 1 ships the single Ops Agent with all of these responsibilities combined. Specialization is promoted as Stage 1+ when operational signal justifies it.

### 8.2 Agent architecture

The Ops Agent is a stateless-per-invocation TypeScript function. Each invocation:

1. **Receives a trigger** — an Inngest event signaling "evaluate this engagement," "draft this communication," "respond to this chat message," etc.
2. **Loads the context bundle** for the relevant engagement (Section 8.3).
3. **Retrieves relevant scars and SOPs** via pgvector on the query signature.
4. **Calls Claude with structured output** — a Zod schema enforcing the response shape.
5. **Either proposes an action** (emits `proposal.created` event), **commits a decision** (emits `ai.decision` event for solver), **drafts a communication** (emits `communication.drafted`), or **responds to a chat message** (returns message body to the portal chat endpoint).
6. **Logs cost and telemetry** (tokens in/out, model used, cache hits, scar matches).

The agent never directly writes to core tables. It emits events. Events drive state changes via workflows. This keeps the agent auditable, reversible, and within the authority layer of the rest of the system.

### 8.3 Context bundle per invocation

A well-formed agent invocation receives:

```typescript
type OpsAgentContextBundle = {
  // Target
  engagement: EngagementRecord;
  account: AccountRecord | null;
  contact: ContactRecord;
  members: AccountMemberRecord[];        // if MMLLC or multi-member

  // Current state
  solver_report: StatusReport;           // latest from Layer 4
  recent_events: EventRecord[];          // last 50 events on this engagement/account
  active_exceptions: ExceptionRecord[];

  // Historical context
  past_proposals_for_engagement: ProposalRecord[];
  past_communications_to_contact: CommunicationEventRecord[];

  // Retrieval results
  relevant_sops: { title: string; excerpt: string; citation: string; }[];
  relevant_scars: ScarRecord[];          // from v1_scars via pgvector on query signature

  // Policy context
  applicable_rule_overrides: RuleOverrideRecord[];
  blast_radius_policy: BlastRadiusPolicy;  // what agent is allowed to auto-execute for this kind of action

  // Request
  task: {
    type: 'evaluate_requirement' | 'draft_communication' | 'respond_to_chat' | 'generate_proposal';
    requirement_key?: string;
    trigger_event_id: string;
    additional_context?: Record<string, unknown>;
  };
};
```

The bundle is assembled by `lib/agents/context.ts::buildContextBundle(engagement_id, task)`. It:

1. Parallelizes all reads (Supabase + pgvector).
2. Uses prompt caching: the context bundle format is stable; the outer prompt template + system instructions are cached, reducing cost by ~60-70% on input tokens on cache hits.
3. Is bounded in size — recent_events capped at 50, past_proposals capped at 10, relevant_sops/scars capped at 5 each.
4. Is deterministic given the same engagement state — same inputs produce the same bundle, enabling test replays and cache comparisons.

### 8.4 Retrieval architecture — pgvector

Smart AI uses pgvector (Postgres extension) as the vector store for retrieval over SOPs and the scar index. This avoids adding a new service (Pinecone, Turbopuffer) until volume justifies it.

**Indices:**

```sql
CREATE TABLE sop_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_id       UUID NOT NULL,               -- references sop_runbooks from v1 (read-only from Smart AI)
  section      TEXT NOT NULL,
  content      TEXT NOT NULL,
  embedding    VECTOR(1536),                -- OpenAI text-embedding-3-small
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sop_chunks_embedding ON sop_chunks USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE v1_scars (
  scar_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category           TEXT NOT NULL,
  what_broke_in_v1   TEXT NOT NULL,
  root_cause         TEXT NOT NULL,
  evidence_refs      TEXT[] NOT NULL,       -- dev_task IDs, commit SHAs, CLAUDE.md rule refs
  smart_ai_prevention TEXT NOT NULL,
  verification_path  TEXT NOT NULL,
  retrieval_tags     TEXT[] NOT NULL,
  embedding          VECTOR(1536),          -- on concatenation of retrieval_tags + what_broke_in_v1 + smart_ai_prevention
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  source             TEXT NOT NULL CHECK (source IN ('claude_md_rule','dev_task_bugfix','action_log_anomaly','planning_doc','session_captured'))
);
CREATE INDEX idx_v1_scars_embedding ON v1_scars USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_v1_scars_category ON v1_scars(category);
```

**Retrieval flow:**

1. The agent constructs a *query signature* from the task — typically `task.type + requirement_key + account.entity_type + contact.citizenship` plus any domain-specific tags.
2. Embed the query signature via OpenAI embeddings (or Claude embeddings when available).
3. Query pgvector for top-K similar chunks (default K=5 per source, SOPs and scars separately).
4. Include the retrieved chunks in the context bundle with citations.
5. The agent's system prompt requires it to cite sources when referencing retrieved content.

**SOP corpus sourcing:** `sop_runbooks` in v1 Supabase is the canonical SOP store (per v1 R060). Smart AI reads from v1 Supabase via a read-only replica connection, chunks the content, and embeds into `sop_chunks` on Smart AI Supabase. Re-embedding runs on a schedule (daily) to pick up SOP edits. No dual-authoring of SOPs — v1 remains the write side.

**Embeddings cost:** negligible. 225 × ~50 SOPs average × chunks × $0.02 per 1M tokens ≈ <$1 per full re-embed. Runs daily.

### 8.5 Structured outputs — preventing hallucination

Every agent response is constrained by a Zod schema. The model is instructed — and technically constrained via Anthropic's tool-use / structured-output API — to produce output that matches the schema. This eliminates the class of failures where the model "invents" a citation or produces malformed JSON.

Example schemas:

```typescript
// For requirement evaluation
const aiDecisionSchema = z.object({
  decision: z.enum(['eligible','not_eligible','requires_human_review']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(20),
  evidence_cited: z.array(z.object({
    source_type: z.enum(['sop_chunk','scar','event','document']),
    source_id: z.string(),       // UUID or structured ID
    excerpt: z.string(),
  })).min(1),
  recommendation: z.string(),
});

// For proposal generation
const proposalSchema = z.object({
  action_type: z.enum(['send_reminder','create_invoice','advance_stage','request_document','escalate','draft_communication']),
  parameters: z.record(z.unknown()),
  rationale: z.string().min(30),
  confidence: z.number().min(0).max(1),
  scar_matches: z.array(z.string()).optional(),
  blast_radius: z.enum(['client_visible','admin_only','internal_only']),
  alternative_considered: z.string(),   // R101 enforcement in agent output
  weakness_acknowledged: z.string(),    // R101 enforcement
});
```

The `alternative_considered` and `weakness_acknowledged` fields are R101's five-question discipline embedded in agent output. Every proposal the agent produces includes its own devil's-advocate check — surfaced to the admin reviewing the proposal, so the admin sees not just "what to do" but also "what else was considered" and "how this could be wrong."

### 8.6 Multi-model tiering

The agent routes to different Claude models based on task complexity:

| Task type | Default model | Why |
|---|---|---|
| Triage classification (inbound email/message to engagement) | Haiku 4.5 | Fast, cheap, high accuracy on classification |
| Requirement satisfaction check (solver-triggered) | Haiku 4.5 | Usually a simple lookup with light reasoning |
| Communication drafting (reminder, status update) | Sonnet 4.6 | Tone matters; needs nuance |
| Complex rule interpretation (post-September eligibility, treaty-based ITIN) | Opus 4.7 | Reasoning over multiple SOP sections |
| Client chat response (portal support) | Sonnet 4.6 | Client-facing; tone + accuracy both matter |
| Exception pattern detection (run weekly, batch) | Opus 4.7 via Batch API | Best reasoning on aggregated data, 50% discount via batch |

Tier selection is per-task, declarative in the agent's dispatch table, not hardcoded in each call site. Overrides possible per spec (a spec can mark a particular `ai_evaluable` requirement as "requires_opus" if the business determines it).

### 8.7 Prompt caching

Anthropic's prompt caching reduces cost on repeated input by up to 90%. Smart AI applies it aggressively:

**Cacheable content (always cached):**
- System prompt (agent instructions, R101 reminder, structured-output schema).
- Retrieved SOP chunks (if same chunks recur across invocations, they cache).
- Applicable rule overrides.

**Non-cacheable content (fresh per invocation):**
- The specific engagement state, recent events, solver output.
- The task description.

Practical cost impact: with prompt caching, input token cost drops roughly 60-70% on agent invocations (the system prompt and SOP corpus are large and stable). This is the primary reason estimated cost at 225 clients is $900-$1,400/month rather than $3,000.

### 8.8 Tools available to the agent

The agent has a narrow, typed tool set. Each tool is a TypeScript function exposed via Anthropic's tool-use API. The agent cannot execute arbitrary code — only call these tools.

**Read tools:**
- `query_events(engagement_id, event_types?, since?)` — fetch events for the target engagement.
- `query_solver(engagement_id)` — get the latest `StatusReport`.
- `read_document(document_id)` — fetch a document's metadata + extracted fields (not raw bytes).
- `get_contact(contact_id)` — fetch contact fields.
- `get_member(account_id, contact_id)` — fetch membership fields.
- `search_sops(query)` — pgvector search over SOPs; returns chunks with citations.
- `search_scars(query)` — pgvector search over v1_scars; returns matching scars with preventions.

**Write tools (all emit events; do not directly mutate entity tables):**
- `create_proposal(proposal)` — emits `proposal.created`.
- `draft_communication(draft)` — emits `communication.drafted`.
- `commit_decision(decision)` — emits `ai.decision` for a requirement (only when task.type = 'evaluate_requirement').
- `request_exception(exception)` — emits `exception.requested`. Human must approve; agent cannot self-approve.
- `send_via_safe_send(message, blast_radius_policy)` — escalates to safeSend path (v1 pattern preserved for outbound email, R037).

**Escalation tool:**
- `escalate_to_human(reason, urgency)` — if the agent cannot produce a confident response, it calls this to hand off. Emits a high-priority proposal or a task.

Tools are the agent's authority boundary. Adding new tools requires code change + review. Tools that mutate client-facing state (send emails, charge cards, change contracts) are fundamentally different from tools that read or propose — and the distinction is enforced at the tool-definition level, not at the prompt level.

### 8.9 Proposal workflow

When the agent generates a proposal:

1. **Emit `proposal.created`** with full payload (action_type, parameters, rationale, confidence, scar_matches, blast_radius, alternative_considered, weakness_acknowledged, evidence_events).
2. **Blast-radius gating:**
   - `internal_only` (create a dev_task, file a document, update an internal status): may auto-execute if confidence ≥ threshold AND historical approval rate ≥ threshold AND no scar match vetoes it.
   - `admin_only` (propose an admin task, surface an insight): always requires human review.
   - `client_visible` (send an email, create an invoice, charge a card, change a contract): **always** requires human review regardless of confidence or history.
3. **If auto-execution permitted:** emit `proposal.auto_executed` + trigger the action workflow.
4. **If human review required:** proposal lands in CRM inbox. Admin approves/rejects via UI. Emits `proposal.approved` or `proposal.rejected`.
5. **Rejections feed retrieval:** rejected proposals are indexed in pgvector alongside the rejection reason. Future proposals check "have similar proposals been rejected for this engagement or this category?" and either surface the rejection context or self-escalate.

### 8.10 Agent rationale and devil's-advocate flags

**[R101-FLAG on model calibration.]** Claude models — like all LLMs — have known calibration errors. A 0.91 confidence output is not statistically 91% correct. Thresholds tuned on raw confidence will fire incorrectly.

The resolution: the observability stack (Section 18) includes an active calibration plot. For each proposal type, we track `(AI confidence, admin decision)` pairs over time. Every week, we compute the actual accuracy-by-confidence-bucket. If the model reports 0.9+ confidence but actual accuracy is 0.75, we adjust the auto-execution threshold upward until observed accuracy hits the target. Calibration is empirical, not nominal.

**[R101-FLAG on retrieval noise.]** pgvector similarity can return loosely-relevant chunks that the model then treats as authoritative. The agent might cite a scar that is syntactically similar but semantically unrelated.

The resolution: retrieval results include a similarity score. The system prompt instructs the agent: "Only cite retrieval results with similarity ≥ 0.75. For lower similarity results, include them as context but do not cite them as evidence." Additionally, the structured output schema requires `source_id` to be a real UUID the system can validate — if the model invents an ID, the emit fails at Zod validation, and the proposal does not ship.

**[R101-FLAG on single-agent context window saturation.]** At high volume, a single agent processing many engagements per minute may run into Anthropic rate limits or context-window-exhaustion on large context bundles.

The resolution:
1. **Rate limiting at the Inngest layer:** per-agent concurrency cap (default 10 concurrent invocations), queuing beyond that.
2. **Context bundle size bounds:** hard-capped at ~30k input tokens. If a bundle exceeds, the agent's context loader summarizes older events before embedding.
3. **At observed saturation, promote specialist agents:** if the single agent is the bottleneck, split Triage off first (highest volume, simplest model). The architecture supports this without rewiring tools — only the agent dispatch table changes.

**[R101-FLAG on agent self-contradiction across sessions.]** An agent evaluating the same question at two different times might produce different outputs (model non-determinism, different retrieval results).

The resolution:
1. **Temperature = 0** for all deterministic tasks (requirement evaluation, proposal scoring).
2. **Cache AI decisions** in the event log. If solver needs a decision and one exists fresh, use it rather than re-invoking.
3. **Expected divergence** for creative tasks (draft communications, tone review): the diff between two invocations is rejected only if it materially changes business semantics, not if it's rephrased.

**[R101-FLAG on cost runaway.]** If the agent is triggered on every event, and some engagements have hundreds of events per day, costs spike unpredictably.

The resolution: Inngest workflows batch trigger events. Instead of "agent fires on every event," the pattern is "agent fires on an engagement-level signal at most once per hour" — unless the event is high-priority (payment.confirmed, document.uploaded for a blocking requirement). Signal debouncing at the workflow layer. Cost alerting at 80% of monthly cap. Per-invocation cost is logged in the event itself (`ai.decision.payload.tokens_input/output/cost_usd`) for after-the-fact analysis.

---

## 9. v1 Scar Index — The Learning Layer

The v1 Scar Index is the system's institutional memory of past failures, converted into structured guardrails. It is the direct answer to Antonio's observation: **"The smart system should learn from the dumb system using the dev_tasks or similar to see all the bugs and errors and limitations today are in place, to avoid and prevent them."**

### 9.1 Why a scar index is first-class architecture, not a document

A document of "past bugs" is a static artifact that drifts. The scar index is queryable at design time AND at runtime, and it feeds the Ops Agent's context bundle so the agent considers relevant scars in real time when proposing actions.

Without a scar index:
- Design decisions lose context — "why did we do it this way?" answers are in commit messages a year old.
- Agent proposals repeat known mistakes — a proposal to auto-send under a pattern that previously caused a client incident would pass undetected.
- New engineers (or new Claude sessions) re-discover solved problems.

With a scar index:
- Every design decision is accountable to relevant scars. "Why do we tokenize EIN in events?" — "SC-014: v1 had EIN numbers leak into logs." Checkable, citable.
- Agent proposals that match a failure pattern escalate automatically.
- Onboarding to the system is: read this doc + scan the scar index. Fast.

### 9.2 Scar schema

```sql
CREATE TABLE v1_scars (
  scar_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scar_number          TEXT NOT NULL UNIQUE,              -- human-readable: 'SC-001', 'SC-042'
  category             TEXT NOT NULL,                     -- see §9.3 taxonomy
  severity             TEXT NOT NULL CHECK (severity IN ('catastrophic','significant','operational','cosmetic')),

  -- What went wrong
  title                TEXT NOT NULL,                     -- short label
  what_broke_in_v1     TEXT NOT NULL,                     -- what happened, in prose
  root_cause           TEXT NOT NULL,                     -- why
  evidence_refs        JSONB NOT NULL,                    -- structured: { dev_tasks: [...], commits: [...], claude_md_rules: ['R037','R041'], action_log_entries: [...] }

  -- How Smart AI prevents it
  smart_ai_prevention  TEXT NOT NULL,                     -- the design decision that prevents this
  prevention_type      TEXT NOT NULL CHECK (prevention_type IN (
    'schema_constraint','type_invariant','rls_policy','test_case','workflow_gate','agent_retrieval','ui_pattern','none_yet'
  )),
  verification_path    TEXT NOT NULL,                     -- how we know the prevention works (test file + line, DB constraint, etc.)

  -- Retrieval
  retrieval_tags       TEXT[] NOT NULL,                   -- for vector search
  embedding            VECTOR(1536),

  -- Lifecycle
  source               TEXT NOT NULL CHECK (source IN (
    'claude_md_rule','dev_task_bugfix','action_log_anomaly','planning_doc','session_captured','post_cutover_incident'
  )),
  extracted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_validated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','no_longer_applicable'))
);

CREATE INDEX idx_scars_category ON v1_scars(category);
CREATE INDEX idx_scars_severity ON v1_scars(severity);
CREATE INDEX idx_scars_embedding ON v1_scars USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_scars_active ON v1_scars(scar_number) WHERE status = 'active';
```

### 9.3 Scar category taxonomy

Scars are categorized so retrieval and auditing are structured. The initial taxonomy:

- **`silent_write`** — state changed without a corresponding event or log. (v1 examples: 176 direct DB writes in the MCP tools pre-audit.)
- **`race_condition`** — concurrency bug. (v1 example: invoice number collision before R098's partial unique index.)
- **`rule_as_prose`** — business rule enforced only by prose in CLAUDE.md or SOPs, not by code or DB. (v1 example: R094 leads.status semantics.)
- **`hardcoded_value`** — string literal in code that should be config. (v1 example: 85 occurrences of `'Tax Return'` / `'Formation'` / etc.)
- **`pii_leak_risk`** — PII in event payloads, logs, or unscoped RLS. (Mitigated by design in Smart AI; any historical v1 case becomes a scar.)
- **`webhook_missing_signature`** — webhook endpoint accepts input without verifying signature. (v1: some endpoints; all tightened.)
- **`email_encoding_issue`** — subject lines rendering as mojibake. (v1 R041.)
- **`invoice_numbering_issue`** — race, gap, or collision. (v1 R098.)
- **`ui_error_swallowing`** — client-side fetch errors collapsing into generic toasts. (v1 R099.)
- **`hard_delete_client_visible`** — admin deletion of content the client has seen, without soft-delete. (v1 R100.)
- **`multi_machine_git_desync`** — iMac / Mac Mini / MacBook state drift. (v1 R070, R071, R076.)
- **`placeholder_data_entity`** — creating a real entity with fake data as a workaround. (v1 placeholder-account pattern; solved in Smart AI via `engagements`.)
- **`assumption_in_action`** — code or prompt acting on an assumed fact. (v1 R093.)
- **`lazy_plan`** — a plan proposed without devil's-advocate check. (v1 R101.)
- **`data_quality_drift`** — DB field meanings drift from documented meanings. (v1 example: `accounts.created_at` is import date, not business-relationship start.)
- **`cross_service_coordination_gap`** — no single place to see all services for a client. (From target-control-model-challenge doc.)
- **`other`** — catch-all; new categories are added as they emerge.

Every new scar is assigned a category. If none fits, a new category is added — via code change, so new taxonomy members are deliberate.

### 9.4 Population sources and process

The initial ≥50-scar target (Stage 0 S0.9 exit) is populated from:

**Source 1: CLAUDE.md R005-R101 (estimated ~30-50 scars).**
Each rule in v1 CLAUDE.md's Error-Magnet Rules section is a scar by construction — it was added because something broke or was at risk of breaking. The extraction process:

1. Parse CLAUDE.md R-rules into structured objects (regex on `- **R\d+**`).
2. For each rule, LLM-assisted extraction of the structured fields: `category`, `title`, `what_broke_in_v1`, `root_cause`, `smart_ai_prevention`, `verification_path`. The LLM is given the rule text + surrounding context.
3. Human review (Antonio + me) of each extracted scar before insertion.
4. Insert into `v1_scars` with `source: 'claude_md_rule'`, `evidence_refs: { claude_md_rules: ['R037'] }`, etc.

**Source 2: v1 `dev_tasks` with `type='bugfix'` (estimated 50-200 scars).**
Every bugfix task has a title, `progress_log` JSONB describing what was done, and often commit SHAs referenced. The extraction:

1. `SELECT * FROM dev_tasks WHERE type = 'bugfix' AND status = 'done'`.
2. For each task, LLM-assisted extraction of the structured fields, using the task title, description, and progress_log.
3. Human review.
4. Insert into `v1_scars` with `source: 'dev_task_bugfix'`, `evidence_refs: { dev_tasks: ['uuid'], commits: ['sha'] }`.

**Source 3: `action_log` anomalies.**
v1's P2.2 audit surfaced patterns of raw SQL writes bypassing `dbWrite`. Each distinct anti-pattern becomes a scar.

**Source 4: Planning docs in the working tree.**
Files like `target-control-model-challenge.md`, `sandbox-reality-assessment.md`, `operating-model-assessment.md` already identify failure modes. Each named failure mode becomes a scar if not already captured from another source.

**Source 5: Session-captured scars during Smart AI build.**
When a reviewer session (multi-session challenge) or a Stage 0/1 build step surfaces a v1 issue worth capturing, it is added to the scar index by the session that discovered it.

**Source 6: Post-cutover incidents.**
Once v2 is live, any production incident caused by a pattern v2 inherited or failed to prevent becomes a scar. This keeps the index growing and the system learning.

### 9.5 Build-time use — design guardrail

Before any new feature ships in Smart AI:

1. The developer (me, or a future engineer) queries `v1_scars` for categories related to the feature. Example: building the portal chat → query `category IN ('hard_delete_client_visible','rule_as_prose','ui_error_swallowing','pii_leak_risk')`.
2. For each matching scar, verify the feature's implementation provably prevents it. "Provably" = a DB constraint that would reject the scar's failure case, OR a type invariant, OR a specific test case, OR an RLS policy.
3. Mark each scar as "prevention verified" in the PR description with a pointer to the prevention evidence.
4. A reviewer (Antonio or another session) can challenge: "Does this prevention actually prevent the scar?"

If a relevant scar has no preventable mechanism in the current implementation, the feature does not ship. The scar becomes a design gate. This is a real constraint — it slows development — and that's the point. v1's accreted bugs happened because new features shipped without checking whether they re-enacted old mistakes.

### 9.6 Runtime use — agent retrieval

The Ops Agent's context bundle includes scars retrieved via pgvector on the query signature. Process:

1. Compute the query signature from the task (e.g., "proposal to send reminder email for missing document on MMLLC engagement").
2. Retrieve top-K scars by vector similarity (default K=5).
3. Include in the agent's system prompt with instructions: "Check whether the proposed action matches any of these known failure patterns. If it does, and the prevention condition is not clearly satisfied in current state, escalate to human review regardless of confidence."
4. The agent's structured output includes `scar_matches: [scar_numbers]` — every scar it considered and why it was / wasn't a blocker.
5. On proposal review in the CRM, the admin sees the scar matches and can attack the proposal's reasoning about why it's safe.

### 9.7 Scar maintenance

Scars are not write-once. They are maintained:

- **`status = 'superseded'`** — when a scar is replaced by a more precise version (e.g., a category is refined).
- **`status = 'no_longer_applicable'`** — when the underlying concern is genuinely resolved and no longer a risk (rare; most scars stay active).
- **`last_validated_at`** — updated whenever the prevention is re-verified (ideally annually, or when the verification_path changes).
- **`evidence_refs`** — appended to, never overwritten. If new evidence of the scar surfaces, it gets added.

A weekly cron runs: "For each active scar, is the verification_path still sound?" — it runs the specific check. If a DB constraint was the prevention and the constraint got dropped somehow, the cron alerts.

### 9.8 Scar index rationale and devil's-advocate flags

**[R101-FLAG on LLM-assisted extraction accuracy.]** LLMs extracting structured data from dev_task progress_log text will make mistakes. Hallucinated causes, miscategorized scars, oversimplified root causes.

The resolution: every extracted scar requires human review before insertion. The LLM is a *first draft* assistant, not the authority. Antonio or I look at each proposed scar, edit, approve or reject. The population effort is meaningful — 100+ scars reviewed manually — but it is bounded (done once in Stage 0), and the value is structural.

**[R101-FLAG on scar index bloat.]** If every tiny v1 issue becomes a scar, the index grows huge and retrieval becomes noisy.

The resolution: the `severity` field filters low-signal scars out of default retrieval. Default retrieval includes `severity IN ('catastrophic','significant')`; operational/cosmetic scars are available via explicit query but not part of the agent's default context. The taxonomy is also deliberately coarse — if two scars would end up identical under the category axis, they are merged.

**[R101-FLAG on false prevention claims.]** A developer writes "This feature prevents SC-042" in a PR without actually having evidence. The review passes because no one verifies the prevention claim.

The resolution: `verification_path` is a structured field that must point to a specific artifact — a test file + line number, a DB constraint name, an RLS policy name. The build process (future CI job) verifies that every scar's `verification_path` resolves to a real artifact and that the artifact exists in the current codebase. If a prevention's verification_path is `tests/unit/invoice-number.test.ts:42` and that file or line no longer exists, the CI fails and the scar moves to `status = 'prevention_lost'`.

**[R101-FLAG on retrieval drift as the system evolves.]** v1 scars describe v1 patterns. As Smart AI evolves, the scar index's relevance to Smart AI's own code drifts — Smart AI may produce its own new failure modes that aren't in the v1 index.

The resolution: post-cutover scar-source-6 (post-cutover incidents) explicitly opens the scar index to v2's own learning. Every production incident in v2 becomes a new scar, categorized appropriately. The index is living institutional memory, not a museum of v1 failures.

---

---

## 10. Client Portal Experience

The portal is a solver-driven interface. Every page, every card, every action item is computed from the solver's output for the logged-in contact's engagements. Nothing about what a client sees is hardcoded per-service; it all comes from spec + state → solver → render.

### 10.1 The core insight — portal is a rendering layer

The portal does not "know" what Formation looks like. It renders whatever the solver says the current requirements are, for the current engagements the contact is part of. When a spec is updated (new requirement added, reminder cadence changed), the portal updates automatically because its render source — the solver — updates.

This is the opposite of v1, where the portal has dedicated route handlers for each service type, each with its own logic for "what to show the client for a Formation engagement." Adding a new service type in v1 means: new routes, new components, new conditional branches. Adding a new service type in Smart AI means: new spec authored, seeded, solver evaluates it, portal renders its requirements — zero portal code changes.

### 10.2 Authentication and session model

The portal uses Supabase Auth. Contacts receive magic-link or email+password credentials. On successful auth:

- `auth.uid` is the Supabase auth user ID.
- The portal queries `contacts WHERE auth_user_id = $1` to find the contact.
- From the contact, the portal queries active memberships: `account_members WHERE contact_id = $1 AND left_at IS NULL`.
- From the memberships, the active engagements: `engagements WHERE account_id IN (...) AND status IN ('active','paused')`.
- The portal renders one page per engagement plus a unified dashboard.

RLS enforces at the DB level: the contact can only read rows for accounts they are an active member of. Policies detailed in Section 14.

### 10.3 The adaptive dashboard

When a client logs in, the landing page shows their engagement(s) at a glance. Layout:

**Top: progress header per engagement.**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Oh My Creatives LLC — Formation (MMLLC, New Mexico)                │
│  ▓▓▓▓▓▓░░░░ 60% complete — 4 of 7 requirements satisfied            │
│  Next: Upload passport for Marco Rossi                             │
└─────────────────────────────────────────────────────────────────────┘
```

**Middle: action items.** Ordered by priority from `solver.next_actions`.

```
┌─ Action items for you ─────────────────────────────────────────────┐
│                                                                    │
│  1. 📄 Upload passport — Marco Rossi                               │
│     Your MMLLC formation requires a passport for each member.     │
│     [ Upload passport ]                                            │
│                                                                    │
│  2. 📄 Upload proof of address — Marco Rossi                       │
│     A utility bill, bank statement, or government letter from     │
│     the last 3 months.                                             │
│     [ Upload document ]                                            │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Middle-lower: completed items.** Green checkmarks + dates.

```
┌─ Completed ────────────────────────────────────────────────────────┐
│  ✓ Payment confirmed (April 15, 2026 — Stripe)                    │
│  ✓ Company name: Oh My Creatives LLC                               │
│  ✓ State of formation: New Mexico                                  │
│  ✓ Passport uploaded — Giovanni Bianchi (April 18, 2026)          │
└────────────────────────────────────────────────────────────────────┘
```

**Bottom: blocked items with context.**

```
┌─ Waiting for us ───────────────────────────────────────────────────┐
│  ⏳ State filing                                                    │
│     We'll file with the New Mexico Secretary of State after we     │
│     have all member documents. Expected turnaround after filing:   │
│     5-10 business days.                                            │
│                                                                    │
│  ⏳ EIN application                                                 │
│     Starts after the LLC is registered with the state.             │
└────────────────────────────────────────────────────────────────────┘
```

**Every element is rendered from `solver.requirements[]`:**
- `status: 'missing'` + `type: 'document'` → action item with upload button.
- `status: 'satisfied'` → completed card with the satisfying event's timestamp.
- `status: 'blocked'` → waiting card with a plain-English "blocked_by" explanation derived from the blocking requirement's `display_name`.
- `status: 'satisfied_by_exception'` → completed card with a subtle "waived" badge and the exception's reason (if client-visible).

The spec's `follow_up_rules` and `action_hint` fields provide the plain-English text shown in each card. Rendering is a pure transformation: `StatusReport → React components`.

### 10.4 Adaptive wizards

When a client needs to provide data (onboarding fields, banking information, tax intake), the wizard is driven by the spec's requirements:

- The wizard knows what the system already has. If the offer carried the client's address, the wizard pre-fills it. If a member was added by an admin, the members step shows them already populated.
- The wizard only asks for what is actually missing per the solver.
- For MMLLC formations, the members step is dynamic: add a member, remove a member, change ownership percentages, designate signer — all inline. Each member added emits `member.added`; each change emits `member.role_changed` or similar.
- Per-member document sections appear automatically based on `per_member: true` requirements in the spec. Each member gets their own upload block.

Wizard state is persisted to `wizard_progress` (a small table keyed by engagement + contact) so a client can close the browser and come back to the same step. On close/refresh, the wizard reads the latest solver output and skips any step whose requirement is now satisfied.

### 10.5 Real-time updates

When an admin updates something in the CRM — approves an exception, marks a requirement satisfied manually, moves a stage — the portal updates immediately via Supabase Realtime.

Mechanism:
1. Admin action emits event (e.g., `exception.approved`).
2. Outbox drain publishes to Supabase Realtime on a channel keyed to the affected `(engagement_id, account_id)`.
3. Portal page for that engagement has subscribed to the channel on mount.
4. Portal receives the event, invalidates local solver cache, re-fetches solver output, re-renders.

Latency target: from admin click to portal update, < 3 seconds at p95. Realtime is not a hard dependency — if Realtime is down, the portal still works (30-second polling fallback). Realtime is the ideal; polling is the floor.

### 10.6 Unified timeline

Each client sees a complete chronological history of their engagement: documents uploaded, contracts signed, payments confirmed, messages exchanged, AI decisions (when client-visible), proposals approved, exceptions granted, deadlines met.

Source: the event log, filtered by subject scope (`subject_id IN (engagement_id, account_id, member_contact_ids)` AND visibility predicate).

Visibility predicate:
- Client-visible events: `payment.confirmed`, `document.uploaded`, `account.formation_confirmed`, `account.ein_received`, `communication.sent` (to this contact), `member.added`, `exception.approved` (when exception is client-visible), `engagement.started`, `engagement.completed`.
- Admin-only events (hidden from client timeline): `ai.decision`, `proposal.created/approved/rejected`, `webhook.received`, `agent.invoked`, some `exception.approved` (when the exception concerns internal policy the client need not see).

Each event in the timeline renders with:
- Icon by event type.
- Short description (from a mapping table keyed by event_type).
- Timestamp in the client's timezone.
- Optional expand for detail (e.g., which document was uploaded, which payment method).

### 10.7 Portal chat

The portal has an integrated chat interface for the client to communicate with TD (Antonio, Luca). Message history lives in `portal_messages` (carried forward from v1 with R100 soft-delete semantics preserved: `deleted_at`, `deleted_by`, server-filters non-admin queries).

Each inbound message emits `communication.received` with channel='portal_chat'. The Ops Agent (once Stage 1 adds Portal-Support responsibility) can draft suggested responses that Antonio/Luca review and send.

For first cutover, portal chat is routed to admin (no auto-response). Portal-Support agent responses are Stage 1+.

### 10.8 Portal rationale and devil's-advocate flags

**[R101-FLAG on solver latency on portal page load.]** If every portal page load calls the solver, and the solver is complex for a multi-engagement account, p95 latency suffers. Clients see spinners.

The resolution: solver cache hits are O(1) DB read. First-load latency may be 200-500ms (solver fresh run); subsequent loads should hit cache. Monitoring: p95 portal-page-load target is < 1 second; cache-hit-rate target is > 80% after 1 hour of activity per engagement.

**[R101-FLAG on Realtime connection limits at scale.]** Supabase Pro has connection limits. At 1,000 clients with potentially overlapping sessions (client + admin viewing the same engagement), total concurrent Realtime connections can spike.

The resolution: each page subscribes to a specific channel (engagement-scoped), not a global channel. Connection count is bounded by active UI sessions, not by total clients. Upgrade tier if needed; cost is small.

**[R101-FLAG on timeline PII.]** The timeline shows events, and events reference documents. If a member deletes a passport from their profile, the event `document.uploaded` remains in the timeline. Does the document's visibility need to be revocable?

The resolution: the timeline renders via a visibility join — the event references a document, the document has a `visibility` field (default: visible to all members of the account). If admin marks a document private, it disappears from the member timeline (but stays in admin view). Soft-delete semantics also apply. Timeline is a render projection, not a raw dump.

**[R101-FLAG on wizard progress when spec changes.]** A client is mid-wizard. An admin edits the spec (adds a new required document). What happens to the client's progress?

The resolution: the wizard's effective spec is pinned to `engagement.spec_version`. New spec versions do not affect in-progress wizards. If the admin wants to retroactively apply, the admin explicitly migrates the engagement (Section 6.6) — which emits a migration event and re-invalidates wizard progress.

---

## 11. Admin CRM Experience

The CRM is the internal operations dashboard for Antonio and Luca. It presents the same solver output as the portal but from the administrator's angle: across all clients, prioritized by what needs attention, surfaced with AI-generated context.

### 11.1 Intelligence-first dashboard

The CRM home page is organized by what needs attention, not by entity type. v1's CRM dashboard is organized by "Accounts | Contacts | Tasks | Deadlines" — useful when browsing, useless when acting. Smart AI inverts this:

```
┌─ Today, 22 April 2026 ─────────────────────────────────────────────┐
│                                                                    │
│  Needs Action (12)                                                 │
│  ├── 8 clients have missing documents over 3 days                 │
│  ├── 3 clients at payment-confirmed but not yet activated          │
│  └── 1 client exception awaiting your approval                    │
│                                                                    │
│  Proposals (7)                                                     │
│  ├── 4 reminder emails ready (high confidence, auto-approvable)    │
│  ├── 2 invoices to send (review recommended)                       │
│  └── 1 stage advance proposal (requires your review)               │
│                                                                    │
│  Blocked (6)                                                       │
│  ├── 4 clients waiting on state filing confirmation                │
│  ├── 2 clients waiting on IRS EIN                                  │
│  └── (Dependencies external; follow up via Harbor Compliance)      │
│                                                                    │
│  Anomalies (2)                                                     │
│  ├── FBC Consulting: exception rejected 3x, pattern forming       │
│  └── Integration alert: 1 webhook failing (Whop, 2 retries left)   │
│                                                                    │
│  Healthy (234)  — no action needed                                 │
└────────────────────────────────────────────────────────────────────┘
```

Each row is clickable, drills into a filtered list. Counts update in realtime.

This is powered entirely by solver output aggregated across engagements:
- **Needs Action**: engagements with `next_actions` targeting admin, ordered by how long they've been waiting.
- **Proposals**: `proposals` table filtered to `status='pending'`, sorted by confidence and blast_radius.
- **Blocked**: engagements with `requirements[].status='blocked'` by an external dependency.
- **Anomalies**: heuristic — exception-rejected patterns, stuck evaluations, failed webhooks, agent-cost spikes.
- **Healthy**: engagements where all requirements are `satisfied` or the next action is client-scoped (admin has no task).

### 11.2 Client 360 view

One screen per account with everything. The structure:

**Header**: company name, entity type, state, status badge, client health, portal tier, created date.

**Left sidebar**: tabs for All Engagements, All Members, All Documents, All Payments, Timeline, Chat, Notes, Audit.

**Main area** (depending on tab):

- **All Engagements**: list of engagements with each one's progress bar and current action. Click into an engagement for its full solver report.
- **All Members**: list of `account_members` (active and historical — with filters). Per-member document status, role, ownership. Add/remove/change.
- **All Documents**: filterable list with type, contact (if per-member), uploaded date, classification confidence.
- **All Payments**: full payment history with invoice numbers, status, method, amounts.
- **Timeline**: unified chronological event feed across all engagements for this account. Same event source as the portal timeline but with admin-visible events included (AI decisions, proposals, exceptions).
- **Chat**: portal messages from/to this account.
- **Notes**: free-text admin notes (preserved from v1 pattern).
- **Audit**: action log — every write that touched this account or its related entities, with timestamp + actor.

**Right sidebar** (always visible): **AI Context Panel.**

The AI Context Panel is the Ops Agent's live summary of what's happening with this client. It includes:

- **Plain-English state summary.** "Oh My Creatives is at 60% of MMLLC formation. Waiting for passports from 2 of 3 members. Last activity: passport uploaded for Giovanni Bianchi 3 days ago. No exceptions active."
- **Most recent activity** (last 5 events, summarized).
- **What needs attention.** "Marco Rossi's passport has been missing for 8 days. Reminder cadence says one was sent April 18; next reminder due April 25."
- **Anything unusual.** "This is the third MMLLC this quarter with member documents delayed >5 days. Pattern forming — consider adjusting onboarding flow."

The panel is refreshed via the solver cache + Realtime event subscription. Antonio does not ask the AI for this context — it's pre-computed and cached, visible the moment he opens the page.

### 11.3 Spec Editor

A dedicated page at `/admin/specs` where service specifications are viewed and edited.

**Specs list view:**
- Each spec with its current version, last edited, last edit by, active engagement count using this spec.
- Click to edit.

**Spec edit view (two tabs):**

**Tab: Values** — runtime-editable via `rule_overrides`.
- Pricing rules (base prices, per-state filing fees, per-member multipliers).
- Follow-up cadences (first reminder days, escalation days).
- Exception configurations (who can override what, with what alternative).
- Constants used in conditions.

Each editable value has: current effective value, current override (if any), proposed new value field, effective-from date, reason, save button. Saving emits `rule_override.created`; effective spec is re-resolved immediately.

**Preview dry-run:** before saving, the UI shows "if I save this, here's what changes in existing engagements." Example: "Raising base price of SMLLC from $999 to $1,199 will affect 0 existing engagements (all are version-pinned). Will affect new SMLLC offers from [effective_from date]." This confirms Antonio that his intent matches the system's interpretation.

**Tab: Structure** — read-only.
- Requirements tree with dependency graph.
- Each requirement: type, key, condition, scope, ai_evaluable flag.
- "Propose structural change" button creates a dev_task describing the desired change. Requires code change + deploy.

**Version history:** see what changed, when, who changed it. Full audit trail via `spec.updated` + `rule_override.created` events.

### 11.4 Proposal inbox

A dedicated page at `/admin/proposals` for AI-generated proposals.

**List view:**
- Sorted by priority, urgency, and age.
- Each proposal shows: action type, target account/engagement, rationale, confidence, evidence events (expandable), blast_radius, alternative considered, weakness acknowledged, scar matches.
- One-click approve or reject with optional reason.

**Batch operations:**
- Select all proposals of the same type (e.g., "send reminder email") with confidence ≥ threshold.
- Approve selected (batch) — emits `proposal.approved` for each + triggers each action workflow.

**History tab:**
- Past proposals with their disposition (approved, rejected, auto-executed, expired).
- Filter by type, account, outcome, agent.
- Analytics: approval rate per type, average review time, auto-approval candidates (types with high consistent approval that could move to auto-execute at higher threshold).

**Inline scar context:**
- Each proposal's detail view shows the scar matches the agent considered. If any scar was a potential blocker and the agent reasoned past it, that reasoning is visible. Admin can challenge: "is that reasoning valid?"

### 11.5 Exception handling UI

The exception flow is explicit, auditable, and fast — matching Antonio's vision that "exceptions are a core feature, not workarounds."

**On a client 360 view, for any requirement:**
- If `status: 'missing'` or `'blocked'`, admin clicks **Override**.
- Modal opens showing: requirement details, what would satisfy it normally, what exception types are allowed for this requirement (from `exceptions_config`), who is authorized, whether a reason is required, whether an alternative document/evidence is required.
- Admin selects exception type, enters reason, optionally attaches alternative evidence.
- Click **Grant Exception** → emits `exception.approved` with full payload. Solver re-evaluates immediately. Requirement status transitions to `satisfied_by_exception`. Downstream requirements unblock.

**Exception list view (at `/admin/exceptions`):**
- All active exceptions across all engagements.
- Filterable by requirement key, approved_by, date range.
- Each exception shows: which requirement, for which engagement, approved by whom, when, reason, expiry (if set), evidence.
- Revoke button — emits `exception.revoked`; solver re-evaluates; if the revocation unsatisfies the requirement, downstream requirements re-block.

**Pattern detection:**
- If the same requirement key is overridden for ≥5 engagements within the last 90 days with similar reasons (via pgvector similarity on reason text), a banner appears in the spec editor for that requirement: "Exception pattern forming. Consider updating the spec or exception config."
- Gives Antonio the signal to move the business logic from "we keep overriding" to "this isn't actually required here."

### 11.6 CRM rationale and devil's-advocate flags

**[R101-FLAG on AI Context Panel accuracy.]** The panel is LLM-summarized. If the summary misrepresents the state (says "waiting for passports" when actually all passports are in but there's a different blocker), Antonio acts on wrong information.

The resolution:
1. The panel's summary is structured — it doesn't just free-text summarize; it renders from a stable template populated by solver output. The LLM does not freely narrate; it fills slots.
2. Every claim in the panel is clickable — hover shows the underlying solver field; click opens the evidence.
3. The panel explicitly marks AI-generated parts vs deterministic parts.

**[R101-FLAG on batch-approving proposals.]** Admin clicks "approve all 4 reminder emails" — if one of them has a scar match that the admin missed, the bad proposal ships with the good ones.

The resolution: the batch approve UI requires a confirmation step showing all proposals with their scar_matches highlighted. If any proposal has a scar match, it is excluded from the batch by default — admin must explicitly re-include. One-click mass approval is for the clean cases; scar-flagged cases require individual review.

**[R101-FLAG on exception pattern detection.]** Detection is based on similarity, which can false-positive (different underlying reasons phrased similarly) or false-negative (same reason phrased differently).

The resolution: pattern detection surfaces a *signal*, not an automatic change. Antonio decides whether the pattern is real. The banner is informational; it doesn't auto-edit the spec. If false-positive, Antonio dismisses; if false-negative, a Stage 2+ improvement is to add explicit "reason tags" that admins select when granting exceptions, making patterns more discoverable.

**[R101-FLAG on spec editor preview accuracy.]** The "if I save this, here's what changes" preview is only as accurate as the system's knowledge of what depends on the spec value. If a downstream consumer reads the spec in a way the preview doesn't anticipate, the preview is wrong.

The resolution: the preview is generated by actually running the solver in dry-run mode against all active engagements using this spec, with the proposed override applied. The diff between current-solver-output and dry-run-solver-output is the preview. This is computed deterministically — no LLM involved — and uses the same solver code path that the live system uses. If the live system's dependency is captured in the solver (which it should be, because solver is the source of truth), the preview catches it. If there's a dependency outside the solver, that's a bug the scar index captures as `rule_as_prose`.

---

## 12. Exception Handling — The Heart of Flexibility

This is what makes the system fundamentally different from the original. Exceptions are not errors. They are not workarounds. They are a **core feature** of the system, recorded as first-class data with full audit.

### 12.1 The principle

Antonio's words: *"I want a system more flexible that can accept the exception instead of hardly demand to have, for example in this case a 'placeholder.' A lot of things in this system must follow an order according to the code. This is hard to manage and I feel like in a box where I can't move or decide something different if it doesn't reflect the code."*

The translation: the system should not fight Antonio's decisions. It should record them, respect them, and move on. But it should also remember.

### 12.2 Exception schema

```sql
CREATE TABLE exceptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id        UUID NOT NULL REFERENCES engagements(id),
  requirement_key      TEXT NOT NULL,                     -- which requirement is overridden
  requirement_scope    JSONB,                             -- for per_member requirements, the specific member contact_id
  exception_type       TEXT NOT NULL CHECK (exception_type IN ('skip','defer','substitute','override_value')),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  approved_by          UUID NOT NULL,                     -- auth.users.id
  approved_by_name     TEXT,                              -- denormalized for display
  reason               TEXT NOT NULL,                     -- free-form explanation
  evidence             UUID[] DEFAULT '{}',               -- referenced event IDs or document IDs
  alternative_value    JSONB,                             -- for 'substitute' and 'override_value' types
  expires_at           TIMESTAMPTZ,                       -- NULL = permanent
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at           TIMESTAMPTZ,
  revoked_by           UUID,
  revocation_reason    TEXT
);

CREATE INDEX idx_exceptions_active ON exceptions(engagement_id, requirement_key) WHERE status = 'active';
CREATE INDEX idx_exceptions_requirement_pattern ON exceptions(requirement_key, created_at DESC);
```

### 12.3 Exception types

- **`skip`** — the requirement doesn't apply to this engagement. Example: "This client is a returning client; welcome_package skipped."
- **`defer`** — the requirement will be met later, but shouldn't block downstream requirements now. Has `expires_at`; if not satisfied by the deadline, the exception auto-expires and the requirement becomes blocking again.
- **`substitute`** — the requirement can be satisfied by an alternative piece of evidence. Example: "Passport not available; driver's license + utility bill + sworn statement serve as alternative. alternative_value = { docs: [doc_id1, doc_id2, doc_id3] }."
- **`override_value`** — for `ReqData` requirements, provide an explicit value that bypasses the condition. Example: "account.state_of_formation is 'other' (spec condition: must be in supported states); override with alternative_value = 'Massachusetts' and accept manual handling."

### 12.4 Exception lifecycle

**Creation:**
1. Admin (or agent via `exception.requested`, which requires human approval) identifies a requirement that cannot be satisfied normally.
2. Admin clicks Override on the CRM requirement.
3. Selects exception_type from the spec's `exceptions_config` for this requirement (which types are allowed, by whom, with what alternative).
4. Enters reason. If spec requires alternative evidence, attaches it.
5. Save → emits `exception.approved` + inserts row in `exceptions` (status='active').
6. Solver cache invalidates for the affected engagement. Next solver call returns the requirement with `status='satisfied_by_exception'`. Downstream requirements unblock.

**Expiration:**
- Cron daily checks for `exceptions where status='active' and expires_at < now()`.
- Emits `exception.expired` for each; updates row to `status='expired'`.
- Solver re-evaluates; requirement reverts to previous status; downstream re-blocks.

**Revocation:**
- Admin manually revokes an active exception via UI.
- Emits `exception.revoked`; updates row to `status='revoked'` with `revoked_at`, `revoked_by`, `revocation_reason`.
- Solver re-evaluates.

### 12.5 Exception authorization

`exceptions_config` in the spec defines, per requirement:
- `overridable: true/false`
- `overridable_by`: array of roles or user identifiers (e.g., `['antonio']` for owner-only, `['antonio','luca']` for both admins).
- `requires_reason: true/false` (default true).
- `requires_alternative_document: true/false` (for `substitute` type).
- `max_defer_days`: if `defer` type, hard cap on how long an exception can be deferred.
- `prohibited_exception_types`: sometimes certain types aren't allowed for certain requirements (e.g., EIN cannot be `skip`; it can only be `defer` with evidence of alternative identification or legal justification).

At exception-creation time, the CRM validates the admin's user against the spec's `exceptions_config`. If not authorized, the UI prevents creation. The server-side API also validates. No way to create an exception that the spec didn't authorize.

### 12.6 Exception pattern detection

The system watches for exception patterns at two levels:

**Per-requirement frequency:** if `requirement_key=X` is overridden across ≥5 engagements in 90 days, surface a pattern banner in the spec editor. Antonio sees: "This requirement is being overridden often. Consider: (a) relaxing the spec, (b) requiring an alternative upfront instead of as exception, (c) investigating why clients can't satisfy this."

**Per-reason similarity:** via pgvector embedding on exception reasons. If ≥5 exceptions cluster on similar reason text, surface the pattern with the reason cluster as representative text. This catches cases like "this state doesn't support Single-Member LLC by default" being overridden multiple times with varying wording — the pattern is detectable via semantic similarity, not string match.

### 12.7 Exception rationale and devil's-advocate flags

**[R101-FLAG on exception abuse.]** If exceptions are easy to grant, admins will use them as the default workaround rather than fixing the underlying spec. The system ends up with spec requirements that exist on paper but are never enforced in practice.

The resolution:
1. **Pattern detection** (Section 12.6) surfaces this automatically.
2. **Exception weekly report** (in the admin dashboard) shows exception count per admin per week. If one admin is granting 30+ exceptions/week, that's a signal.
3. **Spec values are easier to change than exceptions are to grant.** The CRM spec editor is a faster path than the exception modal for values that should apply systemically. Training: "if you override X more than twice, it's probably a spec issue."

**[R101-FLAG on expired exceptions with live engagements.]** An exception expires while an engagement is mid-flight, re-blocking a downstream requirement the client thought was resolved.

The resolution:
1. Exception expiry fires an event → triggers a workflow → notifies admin (not client) immediately.
2. Admin sees: "Exception for X on engagement Y expired. Requirement is now re-blocking. Options: re-grant, accept block, investigate."
3. Client-side render: the portal doesn't re-expose the "you need this" message until admin decides. Dampening layer prevents client whiplash.

**[R101-FLAG on exception-generated false "satisfied" state.]** If an exception is granted, the requirement shows satisfied_by_exception. A naive consumer treating all satisfied statuses uniformly might miss that an exception is involved.

The resolution:
1. All downstream consumers (CRM panels, portal render, agent context) explicitly render exception-backed satisfaction differently from normal satisfaction. Visual marker. The agent's context bundle distinguishes them.
2. Reports and analytics treat them as distinct: "N requirements satisfied, of which M are by exception."

---

*(Plan continues. Remaining sections: Business Rules, Security/PII, Claude API, Inngest, Infrastructure, Observability, Build Stages, Migration, Governance, Cost Model, Appendices A-E.)*
