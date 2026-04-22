# Smart AI TD Operations — Architecture Plan

**Version:** 1.3 — Post-Round 4 adversarial review (final)
**Date:** 2026-04-22 (v1.3 revision); v1.2 same date; v1.1 same date; 2026-04-21 (v1.0)
**Status:** Pre-build. Four rounds of adversarial review complete. All identified flaws resolved. D1-D9 locked with named kill criteria. Ready for Stage 0.

## v1.2 Changelog — What Changed Since v1.0

### Round 1 (Round-1 reviewer-raised): 12 fixes accepted, revised, and re-evaluated

| Item | v1.0 | v1.1 |
|---|---|---|
| Solver purity | Claimed "pure function, no DB writes" | **Idempotent, event-driven, may queue side effects with dedup key** |
| emit() transaction size | Best-behavior guidance only | **Hard 5-write/200ms ceiling; overflow MUST decompose into Inngest steps** |
| idempotency_key | Optional, STRONGLY RECOMMENDED | **REQUIRED for actor_type IN ('webhook','cron','agent'), typed factories with namespace prefixes** |
| Cross-engagement cache invalidation | Subject_id-keyed; theoretical leak | **Spec DSL declares dependencies; invalidator walks graph transitively with depth-5 limit** |
| PII scrubbing | Post-hoc scheduled pass | **Structural: template-slot pattern in agent output; no free-form PII in event payloads** |
| Compound per-account state | Render-time composition | **`account_case` projection table with field-level source-of-truth rules** |
| 90/10 rule split | Asserted | **Empirical measurement in Stage 0 S0.0.5 with kill criteria on spec engine if ratio is wrong** |
| Calibration tempo | Weekly batch | **Bayesian sequential test; alerts within hours regardless of sample volume** |
| Shadow mode validation | Webhook-only | **Live pilot cohort added pre-cutover with per-client routing infrastructure** |
| Kill criteria | Mentioned | **Named numeric thresholds per D1-D9 (Appendix A)** |
| Hot-path handling | Everything through Inngest | **Direct handlers for hot paths (state+outbox atomic); Inngest reads outbox for side effects** |
| SLOs | Aspirational targets | **v1 baselines measured in Stage 0; SLOs = baseline ± 10% with vendor-p95 slack** |

### Round 2 (new reviewer, architecture-only): 3 load-bearing flaws + 5 significant + 7 minor

| Flaw | Consequence | Fix |
|---|---|---|
| 🔴 A. Rule overrides retroactively change pinned engagements | Silent pricing bug breaks contracted prices | **Spec resolution takes `pin_date`; engagement passes its `created_at`; override UI defaults to new-engagements-only** |
| 🔴 B. Agents see PII in context bundles (names, emails) | GDPR input-side gap survives deletion | **Extend tokenization to `contact_name_token` + `contact_email_token` in `sensitive_data`; agents operate on tokens; UI renders via template slots** |
| 🔴 C. D9 makes v1 an undecommissionable zombie | v1 can never shut down | **Migrate `knowledge_articles` + `sop_runbooks` to v2 at cutover; one-way sync during hybrid period; v1 archivable post-full-migration** |
| 🟠 D. Outbox drain SPOF | Silent degradation on drain stall | **Primary Inngest + fallback Vercel cron (60s) + external uptime monitor (Cloudflare Worker / Better Stack) on genuinely separate infrastructure** |
| 🟠 E. Stale-render → admin action race | Approval on stale evidence | **Optimistic concurrency: `evidence_event_hash` on proposals, rejected on mismatch** |
| 🟠 F. Multi-vendor simultaneous degradation | Unpredictable compound failure | **Designed degraded mode: ≥2 vendors slow → read-only mode with visible banner; circuit-breaker trigger and recovery criteria** |
| 🟠 G. User-name-based permissions | Admin changes = code deploys | **`user_roles` junction table; specs reference roles not usernames** |
| 🟠 H. account_case update strategy undesigned | Either hot-query bottleneck or stale dashboard | **Hybrid: incremental updates on cheap fields, scheduled recompute on engagement lifecycle events only** |
| 🟡 I. Solver-agent context staleness | Agent reasons over old state | **Solver re-run immediately before agent context bundle assembly** |
| 🟡 J. engagement.completed ambiguous semantics | Consumers disagree on meaning | **Precise emission condition documented and validator-enforced** |
| 🟡 K. spec_json SQL edit risk | Runtime drift from git source | **DB writes locked to migration role; CI hash check vs git** |
| 🟡 L. Agent schema coupled to spec evolution | Silent drift breaks runtime | **Code-gen: `lib/agents/schemas.generated.ts` from spec engine at build time** |
| 🟡 M. "Agents don't mutate" wording collides with auto-execute | Misleading contract | **Rewritten: agents emit; workflows execute; authority bounded by blast_radius_policy and tools** |
| 🟡 N. No surface for deprecated spec versions | Admins blind to flagged versions | **`spec_version_warnings` table; CRM banner on flagged engagements** |
| 🟡 O. Inngest abstraction layer implied | Vendor swap requires rewrites | **Explicit `lib/workflows/engine.ts` wrapper; all workflows route through it** |

### Round 3 (third reviewer, architecture-only): 6 load-bearing flaws + 3 significant

| Flaw | Consequence | Fix |
|---|---|---|
| 🔴 1. Fix E tautological — evidence_event_hash predicate `lte` returns same set always | Guard fires never; stale-evidence approvals happen at full rate | **Invert: query events with `created_at > proposal.generated_at`; include cross-engagement events matching solver invalidation graph** |
| 🔴 2. account_members UNIQUE constraint broken under Postgres NULL semantics | Two simultaneous active memberships allowed; solver double-counts per_member requirements | **Replace with partial unique index: `CREATE UNIQUE INDEX ON account_members(account_id, contact_id) WHERE left_at IS NULL`** |
| 🔴 3. emit() two atomicity contracts; unsafe default | Callers use RPC emit() outside a transaction by default; split-brain on any emit() failure | **Single export `withEmit(input)`; all logic moves into `emit_event_atomic()` Postgres function (v1.3 — see Round 4 Fix 1 for implementation correction); no public bare emit()** |
| 🔴 4. GDPR deletion contradicts FK schema — deleting sensitive_data rows throws FK violation | GDPR compliance blocked by database constraint on first attempt | **Soft-delete: set `encrypted_value = NULL` + `deleted_at`; resolver returns null; FK preserved** |
| 🔴 5. Outbox drain publishes to global `'events'` channel; portal subscribes to engagement-scoped channels | Portal receives nothing from drain; Realtime latency SLO permanently unmet | **Drain computes channel from `engagement_id`/`account_id`; publishes there; admin broadcast is separate** |
| 🔴 6. Agent dispatch idempotency key uses UTC day bucket with no context fingerprint | Context changes mid-day (new member, exception, payment) produce same key → Inngest dedupes → 24h staleness | **Key includes `hash(active_member_ids, max_event_id, active_exception_ids, spec_version)`; dispatch-throttle table for cost control** |
| 🟠 7. Exception expiry cron uses two transactions (UPDATE then emit()) | Split-brain: state updates without event or event without state depending on failure order | **All crons use `withEmit(tx, callback)`; §16.4 crons audited against this rule** |
| 🟠 8. "Different infrastructure" monitor is a Supabase Edge Function — same infra as what it monitors | Regional Supabase incident blinds the monitor simultaneously | **Move monitor to Cloudflare Worker cron or Better Stack — genuinely external to Supabase, Vercel, and Inngest** |
| 🟠 9. Calibration conflates admin approval with correctness | Batch-approve UX creates rubber-stamp feedback loop; thresholds drift down as quality degrades | **Separate `admin_approved` (immediate) from `outcome_correct` (materialized later); calibration runs on `outcome_correct` only** |

### Round 4 (fourth reviewer, architecture-only): 3 load-bearing flaws + 4 significant + 1 minor

| Flaw | Consequence | Fix |
|---|---|---|
| 🔴 1. `withEmit()` passes a JS callback to `supabase.rpc()` — technically impossible; `rpc()` sends an HTTP POST with JSON-serialized args; callbacks are not JSON-serializable; PgBouncer transaction mode breaks multi-statement BEGIN/COMMIT from serverless | Every atomicity guarantee introduced by Fix 3 fails to build; all nine previously closed split-brain findings re-open | **Replace JS callback with a parameterized `emit_event_atomic()` Postgres function (plpgsql) that handles entity write + events insert + outbox insert in one server-side transaction; `withEmit()` becomes a typed JS wrapper that calls it via single `rpc()` invocation** |
| 🔴 2. `canOverridePath()` does exact-match on glob-pattern strings; `'pricing_rules.base_price_usd'` never matches `'pricing_rules.*'`; every override permanently denied | CRM spec editor's Values tab broken on first use; "rules as data" promise fails at authorization layer | **Query uses `WHERE $rulePath LIKE path_prefix || '%'`; path prefixes stored without trailing `*` (e.g., `'pricing_rules.'`); data migration for existing rows** |
| 🔴 3. `step.waitForEvent(match: 'data.engagement_id')` references a field absent from both `engagement.started` and `requirement.satisfied` payloads; match either never resolves (7-day timeout) or resolves for wrong engagement | Formation pipeline core wait step silently fails on every real formation | **Drain injects `engagement_id: row.subject_id` into every Inngest event's `data` envelope when `subject_type === 'engagement'`; `data.engagement_id` becomes canonical correlation key across all `step.waitForEvent` calls** |
| 🟠 4. Solver evaluates `account.company_name` when `engagement.account_id IS NULL`; no account to dereference; undefined behavior (null-ref, always-missing, or wrong fallback) | Pre-formation engagement data model undefined for first 30-70% of formation lifecycle | **Add `when_account_null` fallback field to `ReqData` DSL; wizard writes pre-account data to `engagement.metadata`; solver reads metadata fallback when `account_id IS NULL`** |
| 🟠 5. Full PII tokenization (no raw names/emails in `contacts`) makes fuzzy CRM search (substring, prefix, domain) architecturally impossible with SHA-256 hash lookup | CRM admin search-by-name operationally broken; partial-match search requires decrypting all records in memory | **Accept as Stage 1 known constraint (225 clients, account search by plaintext company_name covers 95% of CRM lookups); document contact name search as exact-hash-only; blind-index approach (CipherSweet n-gram) deferred to Stage 2** |
| 🟠 6. `reasoning_template_id: z.enum([...generated...])` is built at compile time; adding a DB template at runtime leaves it outside the enum; agent cannot select it without a redeploy | Template catalog claims "no code change to add a template" but requires schema regeneration + deploy for every addition | **Change to `z.string().uuid()`; validate template ID against DB at agent invocation time (60s cache); CI check becomes "all pinned template references still exist in DB," not "DB state is in the enum"** |
| 🟠 7. `client_routing.contact_id REFERENCES contacts(id)` — FK across two Supabase projects is impossible; v1 and v2 are separate Postgres instances | Any single-database table placement leaves the other system without FK integrity or requires expensive cross-project HTTP on every offer | **Drop FK; use email hash as routing key (no referential integrity across projects — expected); table lives in v2; v1 reads via lightweight HTTP call to v2 routing endpoint** |
| 🟡 8. Batch API savings math double-counted; document subtracts full 10%-of-total as discount instead of 50%-of-10%-of-total | Cost estimate at 225 clients understated by ~$39/month; error compounds at scale | **Fix: savings = 10% × $785 × 50% = $39; correct total = $785 − $39 = **$746/month**; all downstream scale references updated** |

### What v1.3 adds by way of scar protection

Every flaw identified in Round 4 becomes a scar in `v1_scars`: `supabase.rpc()` callback impossibility, authorization prefix-match vs. exact-match distinction, Inngest `data` envelope canonical fields, solver null-entity evaluation rules, PII tokenization search constraints, schema code-gen vs. runtime validation boundary, cross-database FK impossibility, and cost model double-counting. Future designs check against these before shipping.

### What v1.2 does NOT change

- Five-layer architecture (conceded as correct decomposition, three rounds).
- Event sourcing as substrate (conceded as right tradeoff, three rounds).
- Engagements as primary commercial object (correct with `account_case` alongside it).
- TypeScript specs + runtime overrides (conditional on S0.0.5 measurement; kill-able if ratio wrong).
- Single Ops Agent at Stage 1 (conceded).
- Inngest as workflow engine (conceded; abstracted behind `lib/workflows/engine.ts`).
- Multi-model tiering (conceded; calibration now Bayesian sequential).
- Scope, timeline, build stages (owner's decision, not architectural).

### What v1.2 adds by way of scar protection

Every flaw identified in Rounds 2 and 3 becomes a scar in `v1_scars`. The category, what_broke_in_design_review, root_cause, and smart_ai_prevention are captured for each. Future designs (Stage 1+ spec evolution, new service types) must check against these scars before shipping.

---

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

**`contacts` (people) — REVISED v1.1 (names, emails, phones, DOB, address tokenized per 🔴 Fix B).** Every person in the system: clients, members, spouses, partners, signers. Each contact has:
- **Identity tokens** (raw values live in `sensitive_data` — Section 14): `name_token` (resolves to full legal name, first name, last name), `email_token`, `email_2_token` (nullable), `phone_token` (nullable), `phone_2_token` (nullable), `dob_token`, `address_token`.
- **Non-PII attributes** (stored in plaintext — not identifying in isolation): `citizenship`, `residency`, `gender`, `language`, `preferred_channel`.
- **Document status** (boolean flags for quick solver access; raw values tokenized): `passport_on_file` (boolean), `passport_expiry_date`, `passport_number_token` (references `sensitive_data`), `itin_number_token`, `itin_issue_date`, `itin_renewal_date`.
- **Portal**: `portal_tier` (text — `none` | `onboarding` | `active` | `suspended`), `portal_email_sent_at`, `portal_email_template`, `portal_role`, `kyc_status`.
- **Referral**: `referrer_type`, `referral_code`.
- **Relationships**: `primary_company_id` (weak signal for "which company is this contact most associated with" — authoritative member link lives in `account_members`).
- **Audit**: `created_at`, `updated_at`.
- **QuickBooks**: `qb_customer_id` (for eventual manual QB sync, R097).
- **Test flag**: `is_test` (boolean — keeps QA accounts out of production queries).

**Tokenization consequence:** the `contacts` table has no raw names, emails, phone numbers, addresses, or dates of birth. Any operation requiring those values resolves through `sensitive_data` via the token. The solver, agent context bundle, and event payloads all operate on tokens. The CRM and portal UIs resolve to display values at render time. GDPR deletion is structurally complete: nulling a `sensitive_data` row renders every field that referenced its token permanently opaque, across all events and logs. See Section 14.1 for the full tokenization model.

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
  -- NO table-level UNIQUE on left_at — NULL semantics in Postgres break it (NULL != NULL, allowing duplicate active rows)
  -- Enforced by partial unique index below instead
);

-- REVISED v1.2 (🔴 Fix 2): partial unique index enforces "one active membership per contact per account".
-- UNIQUE on (account_id, contact_id, left_at) at table level is broken: two rows with left_at=NULL are
-- treated as distinct by Postgres NULL semantics → both are inserted → solver double-counts per_member reqs.
CREATE UNIQUE INDEX uq_account_members_active
  ON account_members(account_id, contact_id) WHERE left_at IS NULL;

-- Historical memberships (left_at IS NOT NULL) may duplicate contact across time — intentional.
CREATE INDEX idx_account_members_contact ON account_members(contact_id);
CREATE INDEX idx_account_members_account ON account_members(account_id) WHERE left_at IS NULL;
```

**Key improvements over v1's `account_contacts`:**

1. **`is_signer` is explicit and changeable.** Changing the SS-4 signer in v1 is a multi-table update. Here it is one row update with an audit event.
2. **`left_at` supports member removal without data loss.** A member who leaves is still in the history; ownership_pct and role at time of departure are preserved. Historical queries can reconstruct the membership at any point in time.
3. **`added_by` tracks provenance.** You always know how a member got into the system — wizard-created, admin-added, agent-proposed-and-approved, bulk-imported, or migrated from v1.
4. **`role` is flexible.** Owner, member, manager, agent, signer, officer — any role the business defines. New roles are added as a CHECK constraint amendment (one migration). Not as a code refactor.
5. **Partial unique index on active memberships (REVISED v1.2, 🔴 Fix 2).** A table-level `UNIQUE (account_id, contact_id, left_at)` is broken under Postgres NULL semantics: two rows with `left_at = NULL` are considered distinct (NULL ≠ NULL in Postgres unique constraints), so both insert and duplicate active memberships exist. v1.2 uses a partial unique index `WHERE left_at IS NULL` instead — this physically prevents two active rows for the same (account, contact) pair while allowing multiple historical rows (with `left_at` set) for the same pair, supporting the rejoin pattern. The index name is `uq_account_members_active`. Any other table in the schema with a `UNIQUE (..., nullable_col)` pattern must be audited against the same defect.

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

**`account_case` (compound per-account state projection) — REVISED v1.1 (🟠 Fix H: hybrid update strategy).** A read-optimized projection table that answers "what's happening with this account right now across all services" without querying every engagement on every dashboard render. This is not a source of truth — the event log and solver are. It is a pre-aggregated view maintained by event handlers and scheduled jobs.

```sql
CREATE TABLE account_case (
  account_id              UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  current_phase           TEXT,             -- e.g., 'formation', 'onboarding', 'tax_season', 'steady_state'
  priority_focus          TEXT,             -- free-text slug of what most needs attention
  open_blocker_count      INTEGER NOT NULL DEFAULT 0,    -- incremental
  open_exception_count    INTEGER NOT NULL DEFAULT 0,    -- incremental
  active_engagement_count INTEGER NOT NULL DEFAULT 0,    -- incremental
  next_critical_deadline  TIMESTAMPTZ,                   -- scheduled recompute only
  health_signal           TEXT CHECK (health_signal IN ('green','yellow','red','unknown')) DEFAULT 'unknown',
  last_solver_run_at      TIMESTAMPTZ,
  last_updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  recompute_requested_at  TIMESTAMPTZ                    -- set when a lifecycle event requests full recompute
);
```

**Field-level update rules (the "hybrid" in Fix H):**

| Field | Update strategy | Trigger |
|---|---|---|
| `open_blocker_count` | Incremental delta | `requirement.status_changed` → blocked / unblocked |
| `open_exception_count` | Incremental delta | `exception.approved` / `exception.revoked` |
| `active_engagement_count` | Incremental delta | `engagement.created` / `engagement.completed` / `engagement.cancelled` |
| `next_critical_deadline` | Scheduled recompute | `engagement.status_changed`, `deadline.updated` — triggers Inngest recompute job |
| `current_phase` | Full recompute | Inngest job on `account_case.recompute_requested` event |
| `priority_focus` | Full recompute | Same Inngest job |
| `health_signal` | Full recompute | Same Inngest job |

**Rationale for hybrid over pure incremental or pure scheduled:** pure incremental collapses when events arrive out of order (which they do, under load). Pure scheduled recompute on all fields creates a hot query at each run. The hybrid separates cheap counter fields (safe for increment/decrement) from compound judgment fields (`current_phase`, `priority_focus`, `health_signal`) that require cross-engagement context. The expensive recompute runs on lifecycle events only (not on every emit), bounding the job frequency to O(engagement transitions), not O(events).

**Stale-read guarantee:** `last_updated_at` is visible on the CRM Intelligence Dashboard. If an admin sees a stale timestamp, they can manually trigger recompute. The dashboard never presents `account_case` data without surfacing its freshness.

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

**[R101-FLAG on engagements vs case-centric model — RESOLVED in v1.1.]** The 2026-04-18 `target-control-model-challenge.md` argued that the missing layer is a per-client-case aggregate — a client-centric view naming "what's happening with this account across all services right now." The Round 2 reviewer (🟠 Fix H) confirmed: pure render-time composition from solver output is insufficient once compound state must drive *operational decisions* (which reminder to send when blockers overlap, what the agent's priority_focus should be). Without pre-computed compound state, every decision logic that spans engagements must re-query every engagement at decision time — a query-time bottleneck at scale, and an agent context complexity problem.

**Decision (v1.1):** add `account_case` projection table (defined in Section 4.2 above). `account_case` is a pre-aggregated read-model, not a source of truth. It answers compound questions fast while the event log and solver remain the canonical layers.

**Why both engagements AND account_case rather than one or the other:**
- `engagements` are commercial contracts with version-pinned prices, lifecycles, and explicit statuses — they are the right home for commercial truth.
- `account_case` is a cross-engagement summary for operational dispatch — it answers "what's happening with this client right now" without querying every engagement on every render.
- They are complementary: one per commercial contract (many per account over time), one per account (always exactly one, always fresh).

**What this closes:** the agent's priority_focus query, the Intelligence Dashboard's per-account health signal, and the dunning/reminder trigger logic can all read from `account_case` first (fast, single row). Only when inspecting a specific engagement does the agent query engagement-level solver output. This is the right decomposition for both query performance and agent context size.

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

**Outbox drain is NOT a single point of failure in v1.2.** Three independent layers of resilience:

1. **Primary drain**: Inngest scheduled function, every 10 seconds (plus Realtime-triggered on insert for low-latency).
2. **Fallback drain**: Vercel cron function, every 60 seconds. Claims any outbox rows where `locked_at` is older than 60 seconds (primary crashed mid-batch).
3. **Monitoring path on genuinely separate infrastructure**: a **Cloudflare Worker cron** (or Better Stack uptime check) — NOT a Supabase Edge Function, because Supabase Edge Functions run on the same regional infrastructure as the Supabase database being monitored. A regional Supabase incident would simultaneously disable the database AND blind a Supabase Edge Function monitor. The Cloudflare Worker runs outside Supabase, Vercel, and Inngest. It polls a public health endpoint (`GET /api/health/outbox-depth`, protected by a secret header) every 30 seconds. If the endpoint reports `pending_stale_count > 100` (events pending for > 2 minutes), the Worker fires an SMS alert via Twilio.

A primary drain worker runs on Inngest (scheduled every 10 seconds, plus triggered on `outbox` insert via a Supabase Realtime subscription for low-latency):

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
          // Publish to Inngest event stream for downstream workflows.
          // 🔴 Fix 3/Round 4: inject engagement_id into every engagement-scoped event's
          // data envelope. Inngest step.waitForEvent(match: 'data.engagement_id') requires
          // this field to exist on both the triggering event AND the waited-for event.
          // Without injection, match never resolves (or resolves for wrong engagements).
          // engagement_id = row.subject_id when subject_type === 'engagement'.
          const inngestData = {
            ...row.payload,
            ...(row.subject_type === 'engagement' && { engagement_id: row.subject_id }),
            account_id: row.account_id,   // also inject for account-level correlation
          };
          await inngest.send({ id: row.event_id, name: row.event_type, data: inngestData });

          // 🔴 Fix 5 — Publish to engagement-scoped Realtime channels, not a global 'events' channel.
          // Portal pages subscribe per-engagement (e.g. channel `engagement:{id}`).
          // A global channel would require every portal session to receive every event — noise +
          // security leak. The drain computes the correct channel from subject_id / account_id.
          if (row.subject_type === 'engagement') {
            // Engagement-scoped channel: portal engagement detail page, CRM engagement view
            await supabase
              .channel(`engagement:${row.subject_id}`)
              .send({ type: 'broadcast', event: row.event_type, payload: row });
          }
          if (row.account_id) {
            // Account-scoped channel: CRM account 360 view, portal account dashboard
            await supabase
              .channel(`account:${row.account_id}`)
              .send({ type: 'broadcast', event: row.event_type, payload: row });
          }
          // Admin broadcast channel: CRM global activity feed (admin-only, no PII in payload)
          await supabase
            .channel('admin:broadcast')
            .send({ type: 'broadcast', event: row.event_type, payload: { event_id: row.event_id, event_type: row.event_type, account_id: row.account_id } });

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
- `engagement.completed` — **REVISED v1.1 (🟡 Fix J: precise emission condition).** Emitted when ALL of the following are true simultaneously: (a) all `required` requirements in the engagement's effective spec report `satisfied` or `satisfied_by_exception`, AND (b) `engagements.completed_at` is set to `now()`, AND (c) the solver confirms `overall_progress = 1.0`. This event is NOT emitted on cancellation (that fires `engagement.cancelled`) and NOT emitted on partial completion (partial is a state change, not a final event). The Zod schema for this event enforces the precondition: `{ completion_type: 'full' | 'exception_assisted', completed_requirement_count: number, spec_version: number }`. Any attempt to emit `engagement.completed` without `completion_type` and `completed_requirement_count` fails Zod validation before the outbox insert. Auto-execute threshold for agent: never — this event is emitted by the workflow after the admin confirms all requirements are satisfied, not by the agent autonomously.
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

### 5.4 emit() contract — REVISED v1.3 (🔴 Fix 1/Round 4: Postgres function replaces unimplementable JS callback; 🔴 Fix 3/Round 3: single `withEmit()` export)

`withEmit()` is the single exported entry point for writing to the event log. No other code writes directly to `events` or `outbox`.

**Why the v1.2 callback design was unimplementable.** v1.2 wrote `supabaseAdmin.rpc('run_in_transaction', async () => { ... })` — a JavaScript async callback passed to an RPC call. This is architecturally impossible: `supabase.rpc()` sends an HTTP POST with JSON-serialized arguments to a Postgres stored procedure. An async JS callback is not JSON-serializable. Postgres cannot receive or execute JavaScript. Additionally, Supabase's default connection pooler (PgBouncer in transaction mode) does not support multi-statement interactive transactions from serverless: each statement may be dispatched to a different connection from the pool, so a client-side `BEGIN` / entity write / `INSERT INTO events` / `INSERT INTO outbox` / `COMMIT` sequence is not guaranteed to be atomic.

**v1.3 fix: server-side Postgres function.** All entity write + event insert + outbox insert logic moves into a `plpgsql` function `emit_event_atomic()`. Postgres wraps the entire `plpgsql` function body in a transaction automatically — no client-side `BEGIN`/`COMMIT` is needed. The JS `withEmit()` wrapper validates the input with Zod and calls `rpc('emit_event_atomic', params)` as a single HTTP roundtrip. Everything is atomic inside the Postgres function.

```sql
-- Postgres function (runs entirely server-side in one implicit transaction)
CREATE OR REPLACE FUNCTION emit_event_atomic(
  p_entity_table  TEXT,           -- e.g., 'engagements'
  p_entity_pk     UUID,           -- the row to update
  p_entity_update JSONB,          -- { "status": "active", "started_at": "..." }
  p_event_type    TEXT,           -- e.g., 'engagement.started'
  p_actor_type    TEXT,           -- 'inngest' | 'cron' | 'webhook' | 'agent' | 'admin' | 'migration'
  p_subject_type  TEXT,           -- 'engagement' | 'account' | 'contact' | etc.
  p_subject_id    UUID,
  p_account_id    UUID,
  p_payload       JSONB,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_event_id UUID := gen_random_uuid();
BEGIN
  -- 1. Apply entity update (supported tables only — no dynamic SQL for security)
  IF p_entity_table = 'engagements' THEN
    UPDATE engagements
    SET status      = COALESCE((p_entity_update->>'status'), status),
        started_at  = COALESCE((p_entity_update->>'started_at')::TIMESTAMPTZ, started_at),
        completed_at = COALESCE((p_entity_update->>'completed_at')::TIMESTAMPTZ, completed_at)
        -- additional columns added as the schema grows
    WHERE id = p_entity_pk;
  ELSIF p_entity_table = 'exceptions' THEN
    UPDATE exceptions
    SET status     = COALESCE((p_entity_update->>'status'), status),
        expired_at = COALESCE((p_entity_update->>'expired_at')::TIMESTAMPTZ, expired_at)
    WHERE id = p_entity_pk;
  -- ELSIF p_entity_table = 'service_deliveries' THEN ...
  -- Additional tables registered here as Stage 0+ schemas are built.
  END IF;

  -- 2. Idempotency check: if this key already exists, return the existing event_id
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_event_id FROM events WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_event_id;
    END IF;
    v_event_id := gen_random_uuid();  -- fresh for new event
  END IF;

  -- 3. Insert event
  INSERT INTO events (id, event_type, actor_type, subject_type, subject_id, account_id, payload, idempotency_key)
  VALUES (v_event_id, p_event_type, p_actor_type, p_subject_type, p_subject_id, p_account_id, p_payload, p_idempotency_key);

  -- 4. Insert outbox (triggers drain)
  INSERT INTO outbox (event_id, status) VALUES (v_event_id, 'pending');

  RETURN v_event_id;
END;
$$;
```

The JS wrapper validates before calling:

```typescript
// lib/events/emit.ts — ONLY public export is withEmit()

export type EntityWrite = {
  table: SupportedEntityTable;   // 'engagements' | 'exceptions' | 'service_deliveries' | ...
  pk: string;
  update: Record<string, unknown>;
};

export type EmitInput = {
  entityWrite?: EntityWrite;     // optional — some events have no accompanying state write
  event_type: string;
  actor_type: ActorType;
  subject_type: string;
  subject_id: string;
  account_id?: string;
  payload: unknown;
  idempotency_key?: string;      // REQUIRED when actor_type in ('webhook','cron','agent','migration')
};

/**
 * The ONLY way to emit an event in Smart AI.
 * Validates with Zod, then calls emit_event_atomic() as a single Postgres RPC.
 * Entity write + events insert + outbox insert run in one server-side transaction.
 *
 * For operations touching more than one entity, decompose into multiple
 * Inngest steps — each step calls withEmit() for its own atomic unit.
 */
export async function withEmit(input: EmitInput): Promise<string> {
  if (requiresIdempotencyKey(input.actor_type) && !input.idempotency_key) {
    throw new EmitError(`idempotency_key required for actor_type=${input.actor_type}`);
  }

  const schema = eventSchemas[input.event_type];
  const validatedPayload = schema.parse(input.payload);  // Zod before any DB write

  const { data: eventId, error } = await supabaseAdmin.rpc('emit_event_atomic', {
    p_entity_table:   input.entityWrite?.table ?? null,
    p_entity_pk:      input.entityWrite?.pk ?? null,
    p_entity_update:  input.entityWrite?.update ?? null,
    p_event_type:     input.event_type,
    p_actor_type:     input.actor_type,
    p_subject_type:   input.subject_type,
    p_subject_id:     input.subject_id,
    p_account_id:     input.account_id ?? null,
    p_payload:        validatedPayload,
    p_idempotency_key: input.idempotency_key ?? null,
  });

  if (error) throw new EmitError(`emit_event_atomic failed: ${error.message}`);
  return eventId;
}

// ESLint rule prevents direct .from('events') and .from('outbox') writes outside this file.
// CI grep enforces the same. No escape hatch exists by construction.
```

**Constraint: one entity write per atomic unit.** Because `emit_event_atomic` handles one entity (one row, one table), each `withEmit()` call is scoped to one state change + one event. Operations spanning multiple entities decompose into chained Inngest steps — each step calls `withEmit()` for its own atomic unit. This is the Round 1 hot-path design. Inngest checkpoints between steps; no single transaction holds locks across multiple entity writes.

**Why the constraint is acceptable:** almost every real state change is one entity + one event. "Payment confirmed → activate engagement" is one write (engagements row) + one event (engagement.started). "Payment confirmed → generate invoice → activate services → queue welcome" is four steps, each one write + one event — and Inngest guarantees each step runs exactly once. The chaining is the feature; the decomposition is the safety property.

**Enforced by three layers:**
1. **Single public API:** `withEmit()` is the only export from `lib/events/emit.ts`.
2. **ESLint rule:** `no-restricted-syntax` targeting `.from('events')` and `.from('outbox')` outside `lib/events/emit.ts`.
3. **CI grep:** regex scan for `.from('events')`, `.from('outbox')` outside their permitted files. Build fails on match.

**The transaction ceiling rule applies inside each `withEmit` call:**

#### Transaction size ceiling (v1.1 HARD limit)

The calling transaction that wraps `emit()` MUST stay under:
- **5 write statements** (INSERT/UPDATE/DELETE on application tables, exclusive of the event + outbox writes).
- **200ms total wall-clock** (validated by query-plan review in CI for critical paths).

**Operations exceeding this ceiling MUST decompose into multiple Inngest steps, each with its own atomic `emit()`**. There is no "outbox-only escape hatch" in v1.1 — it was replaced because split-brain between state-writes and event-emission is exactly the class of bug the outbox pattern was designed to prevent. Inngest was chosen specifically to handle composition of larger workflows; use it.

**Example: payment confirmation (state changes span accounts + engagements + service_deliveries + members + notifications):**

```typescript
// lib/inngest/functions/payment-confirmed.ts — v1.3 using withEmit() (parameterized, not callback)
export const paymentConfirmedFlow = inngest.createFunction(
  { id: 'payment-confirmed-flow' },
  { event: 'payment.confirmed' },  // triggered by outbox drain
  async ({ event, step }) => {
    // Step 1: update engagement status (1 entity write + 1 event, atomic server-side)
    await step.run('activate-engagement', async () => {
      await withEmit({
        entityWrite: {
          table: 'engagements',
          pk: event.data.engagement_id,
          update: { status: 'active', started_at: new Date().toISOString() },
        },
        event_type: 'engagement.started',
        actor_type: 'inngest',
        subject_type: 'engagement',
        subject_id: event.data.engagement_id,
        account_id: event.data.account_id,
        payload: { trigger: 'payment_confirmed' },
        idempotency_key: `inngest:activate:${event.data.engagement_id}`,
      });
    });

    // Step 2: generate invoice (invoice insert + event, atomic)
    await step.run('generate-invoice', async () => {
      await withEmit({
        entityWrite: { table: 'payments', pk: newInvoiceId, update: { /* invoice fields */ } },
        event_type: 'payment.invoice_generated',
        actor_type: 'inngest',
        subject_type: 'engagement',
        subject_id: event.data.engagement_id,
        account_id: event.data.account_id,
        payload: { invoice_id: newInvoiceId },
        idempotency_key: `inngest:invoice:${event.data.engagement_id}`,
      });
    });

    // Step 3: activate services, queue welcome (each is its own step)
    // Each step = one entity write + one event, atomic.
  }
);
```

Each step is its own atomic unit. Inngest checkpoints between steps. No single transaction holds locks long enough to exhaust the connection pool.

#### Idempotency-key contract (REQUIRED for non-human actors)

The `EmitFn` inside `withEmit` enforces: if `actor_type` is `'webhook'`, `'cron'`, `'agent'`, or `'migration'`, the `idempotency_key` field is required at compile time (typed as non-optional for those actor types). Omitting it is a TypeScript error, not a runtime check.

#### Typed idempotency-key factories (namespace collision impossible)

Every idempotency-key-producing source has a typed factory function with a mandatory namespace prefix. Convention drift is impossible by construction.

```typescript
// lib/events/idempotency-keys.ts

/** Stripe / Whop / other webhooks — per provider + provider's event ID */
export function webhookIdempotencyKey(provider: 'stripe' | 'whop' | 'inngest' | 'hc', providerEventId: string): string {
  return `webhook:${provider}:${providerEventId}`;
}

/** Cron jobs — per job name + date bucket */
export function cronIdempotencyKey(jobName: string, dateBucket: string): string {
  return `cron:${jobName}:${dateBucket}`;
}

/**
 * Agent invocations — per engagement + requirement + CONTEXT FINGERPRINT (v1.2 🔴 Fix 6).
 *
 * v1.1 used a UTC day bucket: `agent:eval:ENG:req:2026-04-22`.
 * PROBLEM: if context changes mid-day (new member added, exception granted, payment confirmed,
 * spec override effective-from hit), the same key is generated → Inngest dedupes the dispatch
 * → no re-evaluation until midnight UTC → per-member requirements for the new member are silently
 * never computed for up to 24 hours.
 *
 * v1.2 fix: key includes a fingerprint of evaluation-relevant context. Any context change
 * generates a new key and forces a fresh dispatch. A separate dispatch-throttle table
 * (min N minutes between dispatches of the same fingerprint) controls cost without a blunt
 * 24h window.
 */
export function agentEvalIdempotencyKey(
  engagementId: string,
  requirementKey: string,
  contextFingerprint: string,  // hash(sorted active_member_ids + max_event_id + sorted active_exception_ids + spec_version)
): string {
  return `agent:eval:${engagementId}:${requirementKey}:${contextFingerprint}`;
}

/**
 * Compute the context fingerprint for an engagement's ai_evaluable requirement.
 * Called immediately before dispatch; any state change produces a new fingerprint.
 */
export async function computeEvalContextFingerprint(engagementId: string): Promise<string> {
  const [members, maxEvent, exceptions, engagement] = await Promise.all([
    db.account_members.findMany({ where: { account_id: '...', left_at: null }, select: { contact_id: true } }),
    db.events.aggregate({ _max: { id: true }, where: { subject_id: engagementId } }),
    db.exceptions.findMany({ where: { engagement_id: engagementId, status: 'active' }, select: { id: true } }),
    db.engagements.findUnique({ where: { id: engagementId }, select: { spec_version: true } }),
  ]);
  const raw = [
    members.map(m => m.contact_id).sort().join(','),
    maxEvent._max.id ?? '0',
    exceptions.map(e => e.id).sort().join(','),
    String(engagement.spec_version),
  ].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/** Agent proposals — per engagement + action_type + hash of parameters */
export function agentProposalIdempotencyKey(engagementId: string, actionType: string, paramsHash: string): string {
  return `agent:proposal:${engagementId}:${actionType}:${paramsHash}`;
}

/** Migration imports — per source system + source id */
export function migrationIdempotencyKey(sourceSystem: 'v1' | 'airtable' | 'hubspot', sourceId: string): string {
  return `migration:${sourceSystem}:${sourceId}`;
}
```

Usage is enforced: webhooks cannot construct a key with a non-webhook namespace because the factory function is typed. ESLint prohibits any string literal passed directly as `idempotency_key` — must come from a factory.

The `emit_event` Postgres function wraps both inserts in a single transaction and handles `idempotency_key` uniqueness gracefully — duplicate-key violations return the existing event_id instead of erroring, so retries are naturally idempotent.

### 5.5 What the event log is NOT

- **Not the solver's source of truth for "current state."** The solver reads the entity graph plus events as *evidence*. The entity graph tells you what is; the event log tells you how it came to be. They work together.
- **Not a message bus for inter-service communication.** Inngest is the message bus. Events are durable records; Inngest events (triggered from the outbox drain) are the execution signals.
- **Not a log of every read.** Only state changes are events. A user viewing a page does not produce an event. (Exception: security-sensitive reads might be logged to a separate `access_log` table in a future stage.)
- **Not a PII store.** PII (passport numbers, ITINs, EINs, DOBs, addresses) is tokenized in event payloads — the raw value is in `sensitive_data` and the payload holds a token. Section 14 details this.

### 5.6 Event log rationale and devil's-advocate flags

**[R101-FLAG on GDPR compatibility.]** Events are append-only. If a client requests GDPR deletion, and their PII sits in event payloads, you cannot comply without breaking the append-only invariant or leaving orphan tokens.

The resolution: PII in event payloads is always a token. Raw values live in `sensitive_data` with a per-row RLS policy and an explicit deletion path. GDPR deletion soft-deletes `sensitive_data` rows (sets `encrypted_value = NULL`, `deleted_at = now()` — hard-delete is impossible due to FK constraints from `contacts`). Event payloads retain tokens that now resolve to `(Deleted)` at render time. Audit trail is preserved; PII is unrecoverable. Section 14.4 details this. This pattern is implemented from day one.

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
    // REVISED v1.3 (🟠 Fix 4/Round 4): account_id is nullable pre-formation.
    // When account_id IS NULL, the solver falls back to engagement.metadata fields
    // collected by the wizard before account creation. The `when_account_null`
    // DSL field tells the solver which metadata key to read instead.
    // The wizard writes pre-account data to engagement.metadata at collection time.
    ReqData({
      key: 'company_name',
      condition: {
        field: 'account.company_name',
        not_null: true,
        when_account_null: 'engagement.metadata.company_name',  // fallback pre-account
      },
    }),
    ReqData({
      key: 'state',
      condition: {
        field: 'account.state_of_formation',
        not_null: true,
        in: ['New Mexico','Wyoming','Delaware','Florida','Nevada'],
        when_account_null: 'engagement.metadata.state_of_formation',  // fallback pre-account
      },
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
    // REVISED v1.1 (🟠 Fix G): roles, not usernames — 'antonio' / 'luca' become 'owner' / 'admin'
    'member_proof_of_address': { overridable_by_roles: ['owner', 'admin'], requires_reason: true },
    'member_passport': { overridable_by_roles: ['owner'], requires_reason: true, requires_alternative_document: true },
    'ein': { overridable_by_roles: ['owner'], requires_reason: true, note: 'EIN is legally required; override must include alternative evidence' },
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

### 6.3 The rule override layer — REVISED v1.1 (🔴 Fix A: pin_date; 🟠 Fix G: user_roles; 🟡 Fix N: spec_version_warnings)

Some values in a spec are inherently variable — pricing, reminder cadences, grace periods, exception configurations. Antonio wants to edit these without a deploy. The `rule_overrides` table is where runtime edits live:

```sql
CREATE TABLE rule_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_id         UUID NOT NULL REFERENCES service_specs(id),
  rule_path       TEXT NOT NULL,                  -- JSON path into the spec, e.g., 'pricing_rules.base_price_usd'
  override_value  JSONB NOT NULL,
  reason          TEXT NOT NULL,                  -- why this override exists
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),  -- KEY: engagements created before this date do NOT see this override
  effective_to    TIMESTAMPTZ,                    -- NULL = indefinite
  active          BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_rule_overrides_active ON rule_overrides(spec_id, rule_path) WHERE active = true;
```

**🔴 Fix A — `resolveSpec()` takes a `pin_date` parameter.** This is the mechanism that prevents rule overrides from retroactively mutating contracted prices on existing engagements:

```typescript
// lib/specs/resolver.ts
/**
 * Resolve the effective spec for a given spec_id as of a specific date.
 * Engagements MUST pass their own created_at as pin_date.
 * The CRM spec preview (what-if) passes null for pin_date (shows current effective spec).
 */
export async function resolveSpec(
  specId: string,
  pinDate?: Date | null,          // null = "as of now", used for preview and new engagements
): Promise<EffectiveSpec> {
  const [spec, overrides] = await Promise.all([
    db.service_specs.findUnique({ where: { id: specId } }),
    db.rule_overrides.findMany({
      where: {
        spec_id: specId,
        active: true,
        effective_from: { lte: pinDate ?? new Date() },  // 🔴 Fix A: override must predate engagement creation
        OR: [
          { effective_to: null },
          { effective_to: { gte: pinDate ?? new Date() } },
        ],
      },
    }),
  ]);
  return deepMergeOverrides(spec.spec_json, overrides);
}

// Usage by solver (always pin to engagement creation date):
const effectiveSpec = await resolveSpec(engagement.spec_id, engagement.created_at);

// Usage by CRM "what-if" preview (unpinned — shows current effective spec):
const previewSpec = await resolveSpec(specId, null);
```

**How this closes 🔴 Flaw A:** if Antonio raises MMLLC pricing by $200 today, `effective_from = now()`. An engagement created last month passes `pin_date = engagement.created_at` (last month). That pin_date is before `effective_from`, so the override is excluded. The old engagement keeps its contracted price. A new engagement created tomorrow sees the new price. The pricing mutation is forward-only. Contracted prices are immutable.

**CRM UI enforcement:** when creating a pricing override, the Spec Editor warns: "This override will apply to new engagements created after [effective_from]. Existing engagements are unaffected." If Antonio explicitly wants to apply a change to an existing engagement (rare — e.g., a corrective amendment), he uses the engagement-level override path (directly patching the engagement's `contracted_price` with a reason and an event emitted).

---

**🟠 Fix G — `user_roles` junction table (roles, not usernames).** Specs reference roles (`'owner'`, `'admin'`), not individual user names. Who holds which role is managed in the CRM, not in spec code.

```sql
CREATE TABLE user_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'reviewer', 'read_only')),
  granted_by  UUID REFERENCES auth.users(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  UNIQUE NULLS NOT DISTINCT (user_id, role, revoked_at)  -- allow one active row per user+role
);

CREATE INDEX idx_user_roles_active ON user_roles(user_id, role) WHERE revoked_at IS NULL;
```

Role semantics (first cutover):
- **`owner`** — Antonio. Can override any spec value, approve any exception, access all admin functions.
- **`admin`** — Luca (and future staff). Can override cadences, escalation thresholds, non-pricing exception configs. Cannot change pricing, cannot approve owner-only exceptions.
- **`reviewer`** — future read-only auditor role.
- **`read_only`** — service account or external integrations.

Role-checking at override time — REVISED v1.3 (🔴 Fix 2/Round 4: prefix match, not exact match):

```typescript
// lib/specs/permissions.ts
export async function canOverridePath(
  userId: string,
  rulePath: string,
): Promise<boolean> {
  // v1.2 BUG: findFirst({ where: { path_prefix: rulePath } }) does exact-match.
  // 'pricing_rules.base_price_usd' never matches stored prefix 'pricing_rules.'
  // — every override was permanently denied.
  //
  // v1.3 FIX: use a raw SQL LIKE query so any rule path starting with a stored
  // prefix matches. 'pricing_rules.base_price_usd' LIKE 'pricing_rules.' || '%' → true.
  const { data: policies } = await supabaseAdmin
    .rpc('find_path_policy', { p_rule_path: rulePath });
    // find_path_policy: SELECT * FROM rule_path_policy WHERE $1 LIKE path_prefix || '%'
    //                   ORDER BY length(path_prefix) DESC LIMIT 1  (most specific wins)

  if (!policies || policies.length === 0) return false;  // no matching prefix = not overridable
  const policy = policies[0];
  const userRoles = await getActiveRoles(userId);
  return policy.allowed_roles.some((r: string) => userRoles.includes(r));
}
```

```sql
CREATE OR REPLACE FUNCTION find_path_policy(p_rule_path TEXT)
RETURNS SETOF rule_path_policy
LANGUAGE sql STABLE AS $$
  SELECT * FROM rule_path_policy
  WHERE p_rule_path LIKE path_prefix || '%'
  ORDER BY length(path_prefix) DESC   -- most specific prefix wins on overlap
  LIMIT 1;
$$;

CREATE TABLE rule_path_policy (
  path_prefix   TEXT NOT NULL,    -- stored WITHOUT trailing '*', e.g., 'pricing_rules.'
  allowed_roles TEXT[] NOT NULL,  -- e.g., ['owner'], ['owner','admin']
  PRIMARY KEY (path_prefix)
);

-- Seed data (note: no '*' suffix — prefix match handles the wildcard):
-- 'pricing_rules.'      → ['owner']
-- 'follow_up_rules.'    → ['owner', 'admin']
-- 'exceptions_config.'  → ['owner', 'admin']
```

**Data migration from v1.2:** strip trailing `.*` from all existing `path_prefix` rows and append `.` instead. One-line SQL: `UPDATE rule_path_policy SET path_prefix = regexp_replace(path_prefix, '\.\*$', '.')`.

**Most-specific-wins ordering:** if both `'pricing_rules.'` and `'pricing_rules.base_price_usd'` exist as prefixes (for finer-grained control), the longer (more specific) match wins via `ORDER BY length(path_prefix) DESC`.

---

**🟡 Fix N — `spec_version_warnings` table.** Admins need visibility when an engagement is pinned to a deprecated or flagged spec version. Without this, they may wonder why behavior differs from current spec.

```sql
CREATE TABLE spec_version_warnings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_id     UUID NOT NULL REFERENCES service_specs(id),
  severity    TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  code        TEXT NOT NULL CHECK (code IN (
                'deprecated',          -- this version has been superseded; still functional
                'breaking_change_available',  -- new version has structural changes; manual migration needed
                'known_issue',         -- this version has a documented bug; describe in message
                'migration_recommended'       -- soft push to upgrade
              )),
  message     TEXT NOT NULL,           -- human-readable explanation for CRM banner
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id)
);
```

CRM behavior:
- Engagement detail view and Client 360 show a banner if any active warning exists for the engagement's `spec_id`.
- Banner severity color: `info` = blue, `warning` = amber, `error` = red.
- Admin can resolve a warning (marks `resolved_at`). Resolving is not the same as migrating — it's an acknowledgment.
- Warnings are created by the seeder when it detects a new version supersedes an old one.

---

**What can be overridden:**
- `pricing_rules.*` (all pricing values) — owner only.
- `follow_up_rules.*` (reminder cadences, escalation thresholds) — owner or admin.
- `exceptions_config.*` (who can override what, with what alternatives) — owner or admin.
- Constants in conditions (e.g., the minimum members count for MMLLC) — owner only.
- Grace periods, thresholds, cadences — owner or admin.

**What cannot be overridden (requires code change):**
- Requirement *structure* (adding a new requirement, changing `depends_on` topology, changing `per_member` or `per_account` scoping).
- Condition *shape* (e.g., switching from `field.not_null` to `event_type.exists` is a structural change).
- Requirement types (`ReqData` vs `ReqDocument` vs `ReqDeliverable` vs `ReqGate`).

This split is the honest version of Antonio's goal: "rules live as data." Value-level edits are data (editable via CRM with role-based authorization). Structural edits are code (require deploy). Most business rule changes are value-level — pricing, cadence, threshold.

### 6.4 Requirement structure — the four kinds

**`ReqGate`.** A hard prerequisite. Blocks all other requirements (or a named subset) until satisfied. Payment is the canonical gate.

**`ReqData`.** A field on an entity must have a value (optionally meeting a predicate). "Account has a company name." "Account's state is in the supported states list."

**`ReqDocument`.** A document of a specified type exists, attached to a specific entity, optionally meeting criteria (not expired, signed, etc.). Supports `per_member`, `per_account`, or scoped to the engagement.

**`ReqDeliverable`.** An event of the specified type has occurred for the subject, indicating TD has produced an output (filed something, received something, sent something).

Each requirement also carries:
- **`key`** — unique within the spec.
- **`depends_on`** — requirement keys that must be satisfied first (within this spec).
- **`blocks`** — requirement keys that this one blocks (inverse dependency, useful for gates).
- **`per_member`** / **`per_account`** — scope.
- **`requires_signer`** — special hint for EIN-like requirements that need the designated signer.
- **`ai_hint`** — free-text hint for the agent about what action to propose when this becomes `possible`.
- **`ai_evaluable`** — boolean. If true, the requirement's condition is evaluated by the agent rather than the solver directly. The solver does not call the AI inline; instead, it reads the most recent `ai.decision` event for this requirement. If no recent decision exists, it triggers an `agent.invoked` workflow and reports `evaluation_pending`.
- **`overridable`** — spec-level flag whether exceptions_config applies to this requirement.

**Cross-engagement dependencies — `dependsOnEngagement()` DSL.** Some requirements in one engagement legitimately depend on a condition in another engagement. Example: a Renewal engagement cannot begin billing until the prior Formation engagement is confirmed as `completed`. Without cross-engagement dependency syntax, this logic either lives as ad-hoc code or gets missed.

```typescript
import { ReqDeliverable, dependsOnEngagement } from '@/lib/specs/dsl';

// In the renewal spec:
ReqDeliverable({
  key: 'prior_formation_confirmed',
  condition: dependsOnEngagement({
    type: 'formation',                                // look for a completed engagement of this type
    for_same_account: true,
    condition: { status: 'completed' },
  }),
  blocks: ['billing_start'],                         // no billing until prior formation confirmed
  ai_hint: 'Verify prior formation engagement is closed before starting renewal billing',
}),
```

The solver evaluates `dependsOnEngagement()` by querying engagements for the same account with the specified type and checking the condition. The result is passed through the same satisfied/missing/blocked/exception pipeline as all other requirements. The cross-engagement dependency graph is registered at seeding time and drives the transitive invalidation logic in the solver cache (Section 7.3).

### 6.5 Seeding and versioning — REVISED v1.1 (🟡 Fix K: DB writes locked to migration role; CI hash check)

On every deploy:

1. The build process imports all TypeScript specs from `lib/specs/`.
2. Each spec is validated against its Zod schema.
3. The seeder computes the current content hash of each spec.
4. For each spec, the seeder checks: does the latest version in `service_specs` have the same content hash?
   - If yes: no-op.
   - If no: insert a new row with incremented version. Previous versions are marked `active = false`.
5. A seeding event is emitted: `spec.created` or `spec.updated` with payload `{ service_type, version, content_hash, git_sha }`.

**🟡 Fix K — spec_json drift prevention:**

**DB write lock (migration role only):** the `service_specs` table's `spec_json`, `requirements`, `pricing_rules`, `follow_up_rules`, and `exceptions_config` columns are writable ONLY by the `migration_role` Postgres role. This role is used exclusively by the seeder script during deploy. Regular app code (including the MCP server's `execute_sql` tool) runs as `authenticated` or `service_role` — neither can write to these columns.

```sql
-- In Supabase: revoke direct write on spec content columns from non-migration roles
REVOKE UPDATE (spec_json, requirements, pricing_rules, follow_up_rules, exceptions_config)
  ON service_specs FROM authenticated, service_role;
GRANT UPDATE (spec_json, requirements, pricing_rules, follow_up_rules, exceptions_config)
  ON service_specs TO migration_role;
-- Note: rule_overrides is writable by service_role (for CRM edit path) — only service_specs columns are locked
```

**CI hash check:** a CI step runs after every deploy and after every migration:
```bash
# scripts/verify-spec-hash.ts
# For each active spec in the DB:
#   1. Fetch spec_json and its stored content_hash
#   2. Recompute hash from spec_json
#   3. Also compute hash from the TypeScript source (compiled to the same JSON form)
#   4. Assert DB hash == recomputed hash == TypeScript source hash
# If any mismatch: fail the CI step and alert
```

This detects: (a) spec_json edited directly in the DB (hash mismatch between stored content_hash and recomputed), (b) TypeScript spec changed without re-seeding (hash mismatch between TypeScript source and DB). Either way, CI fails before the mismatch reaches production.

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

### 7.2 Design principles — REVISED v1.1

**The solver is deterministic.** Same inputs → same outputs. No randomness, no hidden state. Timestamps are inputs, not dependencies.

**The solver is idempotent and event-driven, and may queue agent work as a side effect.** (v1.0 claimed "pure" — this was dishonest design-marketing because `ai_evaluable` requirements always broke it. v1.1 states the honest contract.)

What the solver IS allowed to do:
- Read from `events`, `engagements`, `account_members`, `contacts`, `accounts`, `service_specs`, `rule_overrides`, `exceptions`, `ai_decisions`.
- Queue agent evaluation requests through a DEDUPLICATED side-channel (see "Agent dispatch idempotency" below).
- Cache its own output in `solver_cache`, invalidated by events (see §7.3).

What the solver is NOT allowed to do:
- Write to `events` directly (only `emit()` writes events).
- Call Claude or any external service synchronously (those are async through Inngest).
- Mutate `engagements`, `accounts`, or any state entity.

#### Agent dispatch idempotency (v1.1)

When the solver encounters an `ai_evaluable` requirement with no fresh `ai.decision` event, it queues the agent. This queuing MUST be idempotent — multiple concurrent solver calls for the same requirement must NOT fan out to multiple agent invocations.

**Mechanism:**

```typescript
// Inside solve():
if (req.ai_evaluable && !hasFreshDecision(req, engagement)) {
  const dayBucket = todayISO();  // UTC date for deduplication window
  const key = agentEvalIdempotencyKey(engagement.id, req.key, dayBucket);
  await inngest.send({
    id: key,  // Inngest-level deduplication; identical IDs collapse to single run
    name: 'agent/evaluate.requirement',
    data: { engagement_id: engagement.id, requirement_key: req.key },
  });
}
```

Inngest's event ID deduplication collapses identical events to a single workflow run within the event's lifetime. Multiple concurrent solver calls for the same `(engagement, requirement, day)` queue once — not N times.

**The solver is composable.** A client with Formation + Tax + RA Renewal engagements has the solver called independently per engagement. Each returns its own `StatusReport`. Compound rendering reads from `account_case` projection (§4.2.1) for per-account priority; the CRM Client 360 composes per-engagement solver outputs for drill-down. Cross-engagement dependencies are expressed DECLARATIVELY in specs via `dependsOnEngagement()` (see §6.4.1), and the solver resolves them through the event log.

**The solver handles `ai_evaluable` requirements via event references, not model calls:**

1. Reads the latest `ai.decision` event for this `(engagement_id, requirement_key)` pair.
2. If a decision exists and is fresh (within TTL — default 24 hours per requirement), uses it.
3. If missing or stale: solver returns `status: 'evaluation_pending'` AND queues agent via the deduplicated dispatch above.
4. Agent evaluates asynchronously, emits `ai.decision` event, outbox drain invalidates solver cache for this engagement, next solve picks up the fresh decision.

Portal and CRM renderers that encounter `evaluation_pending` show an honest loading state with expected-ready time ("checking — usually resolved in 10-30 seconds") instead of a raw spinner.

### 7.3 Solver caching — REVISED v1.1 with declarative cross-engagement invalidation

The solver is called frequently — every portal page load, every CRM client 360 render, every Inngest workflow step that needs to check status. Without caching, each call rebuilds the full status from events, which is unnecessary work for engagements whose state hasn't changed.

**Event-driven cache invalidation:**

```sql
CREATE TABLE solver_cache (
  engagement_id    UUID PRIMARY KEY REFERENCES engagements(id),
  status_report    JSONB NOT NULL,
  input_hash       TEXT NOT NULL,               -- hash of (spec_version, override_set_hash_at_engagement_pin_date, last_event_id_for_subject, active_exceptions_hash)
  computed_at      TIMESTAMPTZ NOT NULL,
  valid_until      TIMESTAMPTZ                  -- optional TTL for time-dependent requirements
);

CREATE INDEX idx_solver_cache_valid ON solver_cache(valid_until) WHERE valid_until IS NOT NULL;
```

#### Cross-engagement invalidation walks the dependency graph (v1.1)

On every `emit()` call, the outbox drain worker invalidates:

1. **Direct subject cache.** Events with `subject_type='engagement'` invalidate the engagement's cache. Events with `subject_type='account'` invalidate all engagements on that account. Events with `subject_type='contact'` invalidate all engagements on all accounts that contact is an active member of.
2. **Declarative cross-engagement dependencies.** Specs that declare `dependsOnEngagement({ contract_type: 'formation', account_id_match: 'self' })` create entries in a `spec_engagement_deps` table at seeding time. When an event fires for engagement A with spec-declared dependents, the invalidator JOINs against this table to find affected engagement Bs and invalidates them too.
3. **Transitive invalidation with depth cap.** If engagement C depends on B which depends on A, and A's cache invalidates, B invalidates, which invalidates C. Depth is capped at 5 (runtime assertion; alert fires if ever hit) to prevent runaway invalidation.

```sql
CREATE TABLE spec_engagement_deps (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dependent_spec_id           UUID NOT NULL REFERENCES service_specs(id),
  dependent_spec_version      INTEGER NOT NULL,
  dependency_contract_type    TEXT NOT NULL,      -- e.g., 'formation' — the spec that must be complete
  dependency_match            TEXT NOT NULL,      -- 'self' (same account), 'parent', etc.
  requirement_key             TEXT NOT NULL,      -- which requirement in dependent_spec carries this dep
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spec_engagement_deps_lookup
  ON spec_engagement_deps(dependency_contract_type, dependency_match);
```

**Invalidator query pattern** (simplified):

```sql
-- Given emit on engagement A, find all cached engagement Bs that depend on A
WITH affected AS (
  SELECT DISTINCT b.id AS engagement_id
  FROM engagements a
  JOIN spec_engagement_deps d ON d.dependency_contract_type = a.contract_type
  JOIN engagements b ON (
    d.dependency_match = 'self' AND b.account_id = a.account_id
    AND b.spec_id = d.dependent_spec_id
    AND b.spec_version = d.dependent_spec_version
  )
  WHERE a.id = $1
)
UPDATE solver_cache
SET valid_until = now()
WHERE engagement_id IN (SELECT engagement_id FROM affected);
```

The query is indexed. At 100 events/sec with typical dependency graphs (~2-3 deps per spec), invalidation overhead is <5ms per event. Benchmark tested in Stage 0 S0.5.

On solve request:
1. Compute current `input_hash` (includes override_set_hash filtered by engagement's pin_date).
2. Check cache: if `engagement_id` row exists AND `input_hash` matches AND `valid_until > now()`, return cached `status_report`.
3. Else, compute fresh. Write to cache. Return.

Cache fills gradually under load. First-request latency is unchanged; subsequent reads are O(1) until invalidation.

### 7.4 Solver evaluation logic

For each requirement in the spec, the solver runs:

**If `type: gate`:** evaluate condition. If met, `status: satisfied`. Gate requirements block everything else (or a specified subset via `blocks`).

**If `type: data`:** evaluate the field condition against the entity state (`account`, `contact`, `engagement`). Field not null / equals / in list / etc. If met, `status: satisfied`.

**Null-account handling — REVISED v1.3 (🟠 Fix 4/Round 4).** When `engagement.account_id IS NULL` (pre-formation — the account does not exist yet), any `account.*` field reference would null-dereference. The solver MUST NOT crash or silently treat all account requirements as `missing` without attempting the fallback. Resolution:
- If the requirement's condition specifies `when_account_null: 'engagement.metadata.X'`, the solver reads `engagement.metadata.X` instead of `account.X` when `account_id IS NULL`.
- If `when_account_null` is not specified and `account_id IS NULL`, the requirement status is `pending_account` — a new status meaning "this requirement cannot be evaluated until the account exists; it does not block downstream requirements that don't depend on it."
- The wizard writes all pre-account data (company name, state, member list) to `engagement.metadata` at collection time. These values migrate to the account record when `account.formation_confirmed` fires.
- The `pending_account` status is distinct from `missing` — the CRM renders it as "Account not yet created; requirement will auto-evaluate on formation confirmation" rather than "Action required."

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

### 8.3 Context bundle per invocation — REVISED v1.1 (tokenized PII, fresh solver, no free-form names)

#### PII posture: agents operate on tokens, not raw values (v1.1 fix for 🔴 Flaw B)

v1.0 claimed agents don't see PII but the context bundle in v1.0 included full `ContactRecord` with raw names and emails. v1.1 fixes this at the source: contact names and emails are tokenized in `sensitive_data` (§14.1), and the agent's context bundle contains only tokens.

```typescript
type TokenizedContactRecord = {
  id: string;
  name_token: string;              // resolves to full_name via sensitive_data for UI
  email_token: string;             // same for primary email
  phone_token: string | null;
  language: string;                // not PII
  preferred_channel: 'email' | 'portal' | 'sms';
  citizenship: string | null;      // relevant for ITIN / tax decisions, not PII per se
  residency: string | null;
  portal_tier: PortalTier;
  kyc_status: string;
  // structured PII tokens
  passport_token: string | null;
  itin_token: string | null;
  dob_token: string | null;
  address_token: string | null;
  // no raw names, emails, phone numbers, or addresses
};

type OpsAgentContextBundle = {
  // Target (tokenized)
  engagement: EngagementRecord;
  account: AccountRecord | null;            // company name is NOT PII (business entity public)
  contact: TokenizedContactRecord;
  members: TokenizedMemberRecord[];

  // Current state — SOLVER RE-RUN IMMEDIATELY BEFORE BUNDLE (v1.1 fix for 🟡 Flaw I)
  solver_report: StatusReport;              // freshly computed; not stale cached
  recent_events: EventRecord[];             // last 50; payloads already tokenized
  active_exceptions: ExceptionRecord[];     // reason text scrubbed of PII at emit (§14)

  // Historical context (tokenized)
  past_proposals_for_engagement: ProposalRecord[];
  past_communications_to_contact: CommunicationEventRecord[];

  // Retrieval results (SOP chunks and scars do not contain client PII)
  relevant_sops: { title: string; excerpt: string; citation: string; }[];
  relevant_scars: ScarRecord[];

  // Policy context
  applicable_rule_overrides: RuleOverrideRecord[];
  blast_radius_policy: BlastRadiusPolicy;

  // Request
  task: {
    type: 'evaluate_requirement' | 'draft_communication' | 'respond_to_chat' | 'generate_proposal';
    requirement_key?: string;
    trigger_event_id: string;
    additional_context?: Record<string, unknown>;
  };
};
```

#### The agent sees tokens, the UI sees names

The agent's output is structured template-slot format (§8.5 REVISED). When the output is rendered for an admin or client, a thin rendering layer joins tokens to current values from `sensitive_data`. If the contact has been GDPR-deleted, tokens resolve to `(deleted)` and the UI displays redacted placeholder. Audit trail preserved; PII gone.

#### Bundle assembly contract (v1.1)

The bundle is assembled by `lib/agents/context.ts::buildContextBundle(engagement_id, task)`. It:

1. **Re-runs solver immediately before assembly** (v1.1 fix for 🟡 Flaw I). Never uses cached solver output that's been invalidated between agent-dispatch time and bundle-assembly time.
2. Parallelizes all reads (Supabase + pgvector).
3. Uses prompt caching on the stable portions (system prompt, SOP corpus excerpts, scar retrieval results). Cache hit rate target >60%.
4. Is bounded in size — recent_events capped at 50, past_proposals capped at 10, relevant_sops/scars capped at 5 each.
5. Is deterministic given the same engagement state — same inputs produce the same bundle.
6. **All free-form text fields in the bundle have been pre-emit scrubbed** (§14.1 REVISED) — the bundle cannot contain raw client names/emails even transiently.

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

### 8.5 Structured outputs — REVISED v1.1 (template-slot pattern prevents PII in free-form text)

Every agent response is constrained by a Zod schema generated at build time from the spec engine (§8.5.1 — code-gen fix for 🟡 Flaw L). The model is technically constrained via Anthropic's tool-use API to produce output that matches the schema. This eliminates two classes of failure: (a) model invents a citation or produces malformed JSON; (b) model writes a client's name into a reasoning field that survives GDPR deletion.

#### The template-slot contract — no free-form PII in any agent output

v1.0 had `rationale: z.string().min(30)` and `reasoning: z.string().min(20)` as free-form text fields. In v1.0, the model would routinely write "Marco Rossi has been missing his passport for 10 days, send reminder" — which survives the event log forever and breaks GDPR on deletion.

v1.1 replaces free-form text with **template references + typed slot arguments**:

```typescript
// For requirement evaluation
const aiDecisionSchema = z.object({
  decision: z.enum(['eligible','not_eligible','requires_human_review']),
  confidence: z.number().min(0).max(1),

  // Reasoning template — the agent selects from a finite set of templates in the `reasoning_templates` DB table.
  // Templates are authored with slot placeholders: {{days_pending}}, {{requirement_key}}, {{contact_token}}
  // Slots are filled with values the schema validates as non-PII (tokens or typed non-identifying fields).
  //
  // REVISED v1.3 (🟠 Fix 6/Round 4): z.string().uuid() replaces z.enum([...generated...]).
  // Reason: z.enum values are fixed at build time from the code-gen script. Adding a new template
  // to the DB at runtime would leave it outside the enum — the agent cannot select it without a redeploy.
  // The fix: validate the template ID against the DB at invocation time (60s LRU cache).
  // A template added via CRM is immediately available to the agent. No code change, no redeploy.
  reasoning_template_id: z.string().uuid(),  // validated against reasoning_templates at invocation time
  reasoning_slots: z.record(z.union([z.string().uuid(), z.number(), z.string().regex(/^token:/)])),

  // Evidence must reference structured records, not contain narrative text
  evidence_cited: z.array(z.object({
    source_type: z.enum(['sop_chunk','scar','event','document']),
    source_id: z.string().uuid(),
    excerpt_token: z.string().regex(/^excerpt:/),  // token resolving to SOP text (not client PII)
  })).min(1),

  recommendation_template_id: z.enum(['file_ss4','send_reminder','escalate_for_review','grant_exception','await_client_action', /* ... */]),
  recommendation_slots: z.record(z.union([z.string().uuid(), z.number(), z.string().regex(/^token:/)])),
});

// For proposal generation — same pattern
const proposalSchema = z.object({
  action_type: z.enum(['send_reminder','create_invoice','advance_stage','request_document','escalate','draft_communication']),

  // Parameters are structured with typed fields; no free-form text that could carry PII
  parameters: z.object({
    template_id: z.string(),                 // which communication template (for send_reminder, draft_communication)
    slots: z.record(z.union([z.string().uuid(), z.number(), z.string().regex(/^token:/)])),
    target_contact_token: z.string().regex(/^token:contact:/),
    target_channel: z.enum(['email','portal_notification','sms']),
  }),

  // Rationale is a template + slots, same as decision reasoning
  rationale_template_id: z.string().uuid(),  // validated against proposal_templates at invocation time
  rationale_slots: z.record(z.union([z.string().uuid(), z.number(), z.string().regex(/^token:/)])),

  confidence: z.number().min(0).max(1),
  scar_matches: z.array(z.string()).optional(),
  blast_radius: z.enum(['client_visible','admin_only','internal_only']),

  // R101 devil's-advocate discipline — also template-based
  alternative_considered_template_id: z.string(),
  alternative_considered_slots: z.record(z.unknown()),
  weakness_acknowledged_template_id: z.string(),
  weakness_acknowledged_slots: z.record(z.unknown()),
});
```

**Rendering:**

- Admin UI, portal, and audit reports join `template_id + slots` against `reasoning_templates` table plus resolve any tokens via `sensitive_data` for display. Rendered text shown to admin.
- Event log payload contains `template_id + slots` only — no resolved text. GDPR-safe.
- If a template requires text not currently expressible as a slot (genuinely new business language), the admin adds the template to `reasoning_templates` (CRM-editable); NOT the LLM inventing it inline.

#### What this costs

- **Template catalog maintenance.** `reasoning_templates` starts with ~50 templates covering common decision shapes. Grows to ~200-300 at steady state. Manageable.
- **Model expressiveness narrowed slightly.** The model cannot invent a new way to explain something; it picks from the catalog. For novel situations, it uses `ambiguous_edge_case` template and explicit slot `escalate_reason_token: 'escalation:novel'` with a standardized escalation template that a human interprets.
- **Build complexity.** Adding a new template = row + slot type. No code change unless the slot type is genuinely new (rare).

#### Enforcement

- **Zod schema validation** on every agent response (structure, slot types, non-PII). Mismatch = retry with guidance (up to 2 retries); then escalate.
- **Runtime template ID validation**: on every agent invocation, the dispatch layer checks that the `reasoning_template_id` and `recommendation_template_id` values the model returned exist in the DB (60s LRU cache of valid IDs). Unknown ID = retry with error injection ("template_id X does not exist; choose from the current catalog"); then escalate.
- **CI check (v1.3 revised):** CI no longer checks that DB template state is encoded in `z.enum`. Instead, it checks: (a) all template IDs referenced in pinned configs (e.g., default templates in `agent_dispatch` table) still exist in the DB seed file; (b) the seed file compiles without missing references. This catches "someone deleted a template that's still configured as a default" without blocking template additions. Orphan default references fail build; new templates don't.
- **Pre-emit scrubber** (§14.1 REVISED) is a belt-and-suspenders secondary control on any free-form field that still exists in the system (e.g., exception reasons typed by humans).

### 8.5.1 Agent schema code-gen — REVISED v1.3 (🟠 Fix 6: runtime template validation replaces build-time enum)

The structural Zod schemas (slot types, action_type enum, evidence_cited shape) are generated at build time from the spec engine. The template ID fields are NOT generated enums — they are `z.string().uuid()` validated at runtime.

- `lib/specs/*.ts` — specs declare what their requirements' evaluation contracts look like.
- `lib/agents/reasoning-templates.ts` — seed file for initial ~50 templates (committed to git; mirrors DB `reasoning_templates` table at deploy time).
- `scripts/generate-agent-schemas.ts` — reads specs at build time, emits structural Zod schemas for action types, slot shapes, evidence types. Does NOT emit template ID enums.
- `lib/agents/template-cache.ts` — 60s LRU cache of valid template IDs, hydrated from `reasoning_templates` + `proposal_templates` at invocation time. Adding a DB row immediately makes the template available without a redeploy.
- CI fails if the structural schema (action_type, slot types, evidence_cited) is out of sync with spec source. CI does NOT fail when new templates are added to the DB.

**What this enables:** Antonio adds a new reasoning template via the CRM UI (new row in `reasoning_templates`) → template is immediately selectable by the agent on the next invocation after the 60s cache TTL. No code change. No deploy. No PR. The original claim ("adding a template = no code change") is now true.

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

### 11.4 Proposal inbox — REVISED v1.2 (🔴 Fix 1: evidence_event_hash inverted predicate)

A dedicated page at `/admin/proposals` for AI-generated proposals.

**List view:**
- Sorted by priority, urgency, and age.
- Each proposal shows: action type, target account/engagement, rationale, confidence, evidence events (expandable), blast_radius, alternative considered, weakness acknowledged, scar matches.
- One-click approve or reject with optional reason.

**🔴 Fix 1 — Stale-render guard (`evidence_event_hash`).** Every proposal is generated from a snapshot of the engagement's event history. If that history changes between proposal generation and admin approval (a new event arrives — payment confirmed, document uploaded, exception granted — that would have changed what the agent proposed), the admin is acting on stale evidence. This is a known failure mode in any human-in-the-loop system: the supervisor approves an action based on state that has already changed.

**v1.1 had a tautological bug.** The original check queried events with `created_at ≤ proposal.generated_at` — identical to the event set used when the proposal was generated. The hash therefore always matched. The guard never fired. Fix: check for the existence of any events with `created_at > proposal.generated_at`. If any exist, the proposal is stale — regardless of whether those events affect this engagement directly (a shared spec change or a linked contact event can invalidate solver output across engagements). The guard now correctly detects state change, not same-state recomputation.

```typescript
type AIProposal = {
  id: string;
  engagement_id: string;
  // ... other fields
  evidence_event_hash: string;  // SHA-256 of sorted IDs of events that formed the evidence bundle
  generated_at: TIMESTAMPTZ;
};

// On admin approval — CORRECTED v1.2: check for NEW events after proposal.generated_at
async function approveProposal(proposalId: string, adminUserId: string) {
  const proposal = await db.proposals.findUnique({ where: { id: proposalId } });

  // Fetch any events that arrived AFTER proposal generation.
  // Includes: (a) direct engagement events, and (b) events in the solver invalidation
  // scope (e.g., spec change on a shared contract type, exception on a linked contact).
  const invalidationScope = await getSolverInvalidationScope(proposal.engagement_id);

  const newEvents = await db.events.findMany({
    where: {
      created_at: { gt: proposal.generated_at },  // INVERTED from v1.1 lte → v1.2 gt
      OR: [
        { subject_id: proposal.engagement_id },
        { subject_id: { in: invalidationScope } },  // cross-engagement scope
      ],
    },
    select: { id: true },
    take: 1,  // existence check only — no need to load all
  });

  if (newEvents.length > 0) {
    throw new StaleProposalError(
      'New events arrived since this proposal was generated. Refresh the page to see the updated state before approving.'
    );
  }
  // proceed with approval
}

// getSolverInvalidationScope returns IDs of entities whose state changes
// can affect this engagement's solver output: shared spec versions, contact IDs
// with active memberships, any linked engagement sharing the same contact.
async function getSolverInvalidationScope(engagementId: string): Promise<string[]> {
  const engagement = await db.engagements.findUnique({
    where: { id: engagementId },
    include: { account: { include: { members: { where: { left_at: null } } } } },
  });
  return [
    engagement.spec_id,          // spec updates invalidate
    engagement.account_id,       // account-level events invalidate
    ...engagement.account.members.map(m => m.contact_id),  // member events invalidate
  ];
}
```

The UI renders the staleness check result before showing the Approve button:
- If hash matches: green badge "Evidence current as of [timestamp]". Approve available.
- If hash differs: amber banner "Evidence changed — [N new events since proposal was generated]. Review updated state before approving." Approve is blocked until admin clicks "I've reviewed the updated state" — which re-reads the current solver output inline and regenerates the approval context.

This does not block all concurrent approvals — only approvals where evidence actually changed. Clean proposals approve instantly.

**Batch operations:**
- Select all proposals of the same type (e.g., "send reminder email") with confidence ≥ threshold.
- Approve selected (batch) — emits `proposal.approved` for each + triggers each action workflow.
- Batch approval **excludes proposals with stale evidence by default**. Any proposal where the hash check fails is pulled from the batch and shown as "requires individual review." The admin approves the clean ones, then reviews stale ones one at a time.

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

**Expiration — REVISED v1.2 (🟠 Fix 7: split-brain prevention):**

The cron must update the row status AND emit `exception.expired` atomically. If the two operations are in separate transactions, a crash between them produces either: (a) the row marked expired but no event → solver does not re-evaluate → expired exception still treated as active → silent mis-state; or (b) the event emitted but the row not updated → event consumers see an expiry that the DB doesn't reflect → inconsistency.

```typescript
// All §16.4 crons use withEmit() (parameterized, v1.3) — same atomicity contract as any state change.
// lib/workflows/exception-expirer.ts
export const exceptionExpirer = inngest.createFunction(
  { id: 'exception-expirer' },
  { cron: '30 0 * * *' },  // daily 00:30 UTC
  async ({ step }) => {
    const expiredExceptions = await step.run('find-expired', async () => {
      const { data } = await supabaseAdmin
        .from('exceptions')
        .select('id, engagement_id')
        .eq('status', 'active')
        .lt('expires_at', new Date().toISOString());
      return data ?? [];
    });

    for (const exc of expiredExceptions) {
      await step.run(`expire-${exc.id}`, async () => {
        // withEmit() (v1.3 parameterized) — entity update + event insert + outbox insert
        // run in a single server-side Postgres transaction via emit_event_atomic().
        await withEmit({
          entityWrite: {
            table: 'exceptions',
            pk: exc.id,
            update: { status: 'expired', expired_at: new Date().toISOString() },
          },
          event_type: 'exception.expired',
          actor_type: 'inngest',
          subject_type: 'exception',
          subject_id: exc.id,
          account_id: exc.account_id,
          payload: { exception_id: exc.id, engagement_id: exc.engagement_id },
          idempotency_key: `inngest:exception.expired:${exc.id}`,
        });
      });
    }
  }
);
```

Solver re-evaluates on `exception.expired`; requirement reverts to previous status; downstream re-blocks.

**Rule:** All §16.4 cron functions (exceptionExpirer, reminderCadenceRunner, any future periodic state-changing crons) MUST use `withEmit()` for any operation that both changes state and emits an event. The pattern is not optional for these functions.

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

---

## 13. Business Rules — The Honest Split

Not all rules can be data. Not all rules should be code. Smart AI makes the split explicit. There are three buckets, in descending order of editability and ascending order of expressive power.

### 13.1 Rules as data (90% of rules) — REVISED v1.1 (empirical measurement + role-based permissions)

**Empirical measurement of the 90/10 split (Stage 0 S0.0.5).** The 90/10 claim is asserted based on Antonio's description of his business rules. It has not been measured. The Stage 0 S0.0.5 task is to extract and classify every known rule from v1 (`knowledge_articles`, `sop_runbooks`, CLAUDE.md R005-R101, v1 dev_task bugfix history) and count what tier each falls into:
- Data rule (editable value in spec or override)
- Code rule (TypeScript function in `lib/rules/`)
- AI rule (`ai_evaluable` flag)
- Unknown / ambiguous

**Kill criterion:** if the actual ratio is worse than 70/30 (fewer than 70% of rules are data-editable), the spec engine's editorial claim breaks down — most edits require code — and the "rules as data" architecture cannot deliver its core promise. This triggers review per D2. The measurement result is documented in the Stage 0 exit report before Stage 1 begins.

**Role-based access for spec editing (🟠 Fix G).** The rules in this section are editable via the CRM Spec Editor. What "editable" means depends on the admin's role:
- **`owner` (Antonio):** can edit any value in any spec, including pricing.
- **`admin` (Luca):** can edit cadences, escalation thresholds, exception configurations. Cannot change pricing_rules.* (pricing changes require `owner` role).
- Authorization check calls `canOverridePath(userId, rulePath)` (Section 6.3) before every save.

These rules live in database tables and are editable through the CRM without a deploy. The canonical buckets:

**Pricing rules** (in `service_specs.pricing_rules` + `rule_overrides`):
- Base price by entity type (SMLLC, MMLLC, C-Corp Elected).
- Filing fees by state.
- Per-member multipliers for MMLLC.
- Partner code discounts.
- Setup fees.
- Installment schedules (2-payment, 4-payment) with per-installment amounts and due-date cadence.

**Document requirements** (in `service_specs.requirements[]`, each `ReqDocument`):
- Which documents are needed per entity type.
- Which are per-member vs per-account.
- Conditional requirements (e.g., "proof of income required only for specific states").

**Follow-up cadences** (in `service_specs.follow_up_rules`):
- First-reminder days (e.g., send reminder 3 days after requirement detected missing).
- Subsequent-reminder cadence (e.g., every 7 days).
- Maximum reminders before escalation.
- Escalation-to-admin thresholds.

**Gating rules** (in spec requirements via `depends_on` and `blocks`):
- Which requirements block which.
- Which are hard gates (payment blocks everything) vs soft dependencies.

**Communication templates** (in `communication_templates` table):
- Language (en, it, es, etc.).
- Event type (which event triggers this template).
- Channel (email, portal_notification).
- Subject + body with interpolation markers.
- Soft-delete semantics (templates can be archived without losing historical sends).

**Exception configurations** (in spec + `rule_overrides`):
- Which requirements are overridable.
- By whom.
- With what alternative.
- Max defer period.

All of the above are editable in the CRM by Antonio. Changes are audited (`rule_override.created` events), versioned, and pinned where they should be (pricing pins to engagement at creation; reminder cadences apply prospectively).

### 13.2 Rules as named TypeScript functions (10% of rules)

Some rules genuinely require code because they involve non-trivial computation or reach beyond data the CRM can sensibly represent. These are small, well-defined TypeScript functions in `lib/rules/`. Each has:
- A clear input/output type contract.
- A test file with edge case coverage.
- A registry entry so it's discoverable.
- A limit of ~50 lines per function.

Examples:

```typescript
// lib/rules/extension-deadline.ts
/**
 * Computes the IRS extension deadline for a given entity and tax year.
 * - SMLLC (disregarded, Schedule C): extension to October 15.
 * - MMLLC (1065 partnership): extension to September 15.
 * - C-Corp Elected (1120): extension to October 15.
 */
export function computeExtensionDeadline(entityType: EntityType, taxYear: number): Date {
  const monthDay = {
    'Single Member LLC': { month: 10, day: 15 },
    'Multi Member LLC': { month: 9, day: 15 },
    'C-Corp Elected': { month: 10, day: 15 },
  }[entityType];
  if (!monthDay) throw new RulesError(`No extension rule for entity type ${entityType}`);
  return new Date(taxYear + 1, monthDay.month - 1, monthDay.day);
}
```

```typescript
// lib/rules/post-september.ts
/**
 * Determines if a formation signed after Sep 1 qualifies for the
 * first-year-skip on the January installment (SOP rule P5).
 */
export function appliesPostSeptemberRule(contractSignedDate: Date, year: number): boolean {
  const cutoff = new Date(year, 8, 1);  // Sep 1 of the same year
  return contractSignedDate >= cutoff;
}
```

```typescript
// lib/rules/installment-amounts.ts
/**
 * Splits an annual fee into installment amounts given a schedule.
 */
export function computeInstallmentAmounts(
  annualFee: number,
  schedule: InstallmentSchedule
): InstallmentAmount[] { /* ... */ }
```

**These functions are the escape hatch for logic that genuinely needs code.** They are:
- Named (not anonymous, not scattered).
- Bounded (each < 50 lines; if longer, decompose).
- Registered (imported in `lib/rules/index.ts` which exports a registry consumed by the spec engine).
- Testable in isolation.

When a rule needs to change, you know exactly where. When a new rule is needed, you add a function + test + registry entry; no sprawl.

### 13.3 Rules interpreted by AI (the remaining edge cases)

For rules too context-dependent for data tables and too varied for small TypeScript functions, the Ops Agent interprets relevant SOPs at runtime. These are exceptional and require review to flag `ai_evaluable`. Candidates:

- **Eligibility determinations with multiple conditional branches.** Example: "Is this client eligible for the treaty-based ITIN fast-track?" — depends on citizenship, tax residency, prior year returns, visa status, case-specific context.
- **Prioritization decisions across clients with competing deadlines.** Example: "Given 5 clients with tax returns due in 10 days and 3 awaiting extension filing, which should the team work first?" — depends on complexity, client health, payment status, size of tax exposure.
- **Exception-pattern evaluation.** "Should this exception request be granted based on precedent from similar clients?" — LLM reasons over the reason text + historical pattern.

The agent's interpretation is always:
- **Recorded as an event** (`ai.decision`).
- **Auditable** — the full context bundle hash, retrieved SOP citations, output reasoning are stored.
- **Subject to approval when confidence is below threshold**.
- **Calibrated over time** — the observability stack tracks (AI confidence, actual accuracy) pairs to adjust thresholds.

### 13.4 The rules-architecture contract

The three-tier split is not a gradient; it's a strict hierarchy enforced in code:

1. **Data rules** are the default. If a rule can be represented as editable values in a spec, it must be.
2. **Code rules** require explicit registration. A function in `lib/rules/` is reviewed; the PR author justifies why data isn't sufficient.
3. **AI rules** require explicit `ai_evaluable` flag on a spec requirement. The PR author justifies why neither data nor code is sufficient, provides at least 5 example cases with expected AI outputs, and sets an acceptable confidence threshold.

The scar index tracks cases where the wrong tier was chosen and surfaces them. If an AI-interpreted rule's admin-approval rate is below 90% consistently, that's a signal the rule should move to code (if the logic is determinable) or to data (if it's really a configurable value). The tier choice is reviewable evidence, not a one-time decision.

### 13.5 Specific rules carried forward from v1

These v1 rules have business-level force and must exist in v2 in some tier. Listed with their target tier:

- **R094** (leads.status='Converted' means payment confirmed, not offer signed): **data** — enforced by the event-emission path (`lead.converted` fires only from payment webhooks, not offer-signing). Becomes a structural invariant, not a prose rule.
- **R097** (QB sync manual-only): **data** — QB sync is a separate button in CRM; no automatic triggers. The invoice-number generator (R098) produces canonical numbers; any QB sync consumes them without minting.
- **R098** (invoice-number race safety via unique constraint, not code retry loop): **schema** — DB unique constraint + caller retry on conflict. Same pattern as v1.
- **R099** (surface server errors on client fetch): **code pattern** — every client-side `fetch` to own APIs must parse error body and surface. Linted.
- **R100** (client-visible deletion = soft-delete): **schema + code pattern** — `deleted_at`, `deleted_by` columns + server-side filtering. Linted.
- **R037** (MCP send tools use safeSend): **code pattern** — still applies to outbound email via the agent. The `send_via_safe_send` tool wraps idempotency check + send + post-send tracking in one atomic path.
- **R041** (RFC 2047 email subject encoding): **code pattern** — every email send path uses a typed helper that base64-encodes non-ASCII. Enforced by unit test: any direct MIME assembly without the helper fails.

Each of these becomes a scar with its prevention captured. v2 doesn't "follow R037 because we wrote it"; v2 makes R037 impossible to violate via the type system and the enforced helper.

### 13.6 Rules rationale and devil's-advocate flags

**[R101-FLAG on spec editor access control.]** Antonio can edit any rule value. What about Luca? The business may need finer-grained permissions — some values Luca can edit (cadences), some he can't (pricing).

The resolution: every `rule_overrides` insert is authorized against a `rule_path_policy` table that says "path X is editable by role Y." Default: pricing paths require owner role; cadence paths allow admin role. Configurable per-deployment. First cutover has Antonio as owner, Luca as admin; extensions are a Stage 3+ feature.

**[R101-FLAG on migration of v1 rules.]** v1 has rules in CLAUDE.md, sop_runbooks, knowledge_articles, and scattered code. v2 needs to decide, for each rule, what tier it lands in and who owns that placement.

The resolution: the scar index population process (Section 9.4) is also the rule-mapping process. Each v1 rule, as it becomes a scar, is classified by the target tier. The resulting spreadsheet (effectively, the scar table with additional columns) is the migration checklist.

**[R101-FLAG on ai_evaluable rule quality over time.]** AI rules are the most expensive tier (model cost + review cost + calibration complexity). They also have the worst worst-case (hallucination, bias, drift). If the system tends to add more `ai_evaluable` rules over time, complexity spirals.

The resolution: the auto-approval threshold measurement is the governor. When an `ai_evaluable` rule's admin approval rate falls below 90% and stays there, a dev_task is created: "Review whether this rule should move to code or data." The rule isn't removed, but the question is raised. This is institutional hygiene.

---

## 14. Security, PII, Compliance

Designed upfront, not retrofitted. PII tokenization is a line-one decision; RLS policies are specified before any table seeding; webhook signatures are verified on every inbound call. The system assumes adversarial conditions and defends explicitly.

### 14.1 PII tokenization model — REVISED v1.1 (names and emails also tokenized)

Raw PII never lives in event payloads, log lines, or most application tables. Instead, PII is stored in `sensitive_data` and referenced via opaque tokens everywhere else.

**v1.1 expansion (fix for 🔴 Flaw B):** tokenization covers `contact_name`, `contact_email`, and `contact_phone` in addition to the structured identifiers. v1.0 treated names/emails as "normal columns" — that was a GDPR gap on the input side of agents (agents saw raw names in context bundles).

```sql
-- REVISED v1.2 (🔴 Fix 4): encrypted_value is NULLABLE to support GDPR soft-delete.
-- Rows are NEVER hard-deleted (FK integrity from contacts.name_token etc. would throw).
-- GDPR deletion sets encrypted_value = NULL + deleted_at = now(). Token stays valid.
-- get_sensitive_value() returns NULL when encrypted_value IS NULL; callers display '(Deleted)'.
CREATE TABLE sensitive_data (
  token             TEXT PRIMARY KEY,                     -- opaque, e.g., 'token:contact:name:a7f8c2b1' or 'token:passport:f3a9...'
  subject_type      TEXT NOT NULL,                        -- 'contact' | 'account' | 'engagement'
  subject_id        UUID NOT NULL,
  data_type         TEXT NOT NULL CHECK (data_type IN (
    'contact_full_name','contact_first_name','contact_last_name','contact_email','contact_email_2','contact_phone','contact_phone_2',
    'passport_number','itin','ein','ssn','dob','address','bank_account'
  )),
  encrypted_value   TEXT,                                 -- pgcrypto AES-256 encrypted; NULL = GDPR-deleted
  value_hash        TEXT,                                 -- SHA-256 hash for lookup; NULL after deletion
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,                          -- GDPR deletion timestamp; NULL = live
  deleted_by        UUID REFERENCES auth.users(id),       -- who triggered GDPR deletion
  last_accessed_at  TIMESTAMPTZ,
  access_count      INTEGER NOT NULL DEFAULT 0,
  created_by        UUID NOT NULL
);

CREATE INDEX idx_sensitive_data_subject ON sensitive_data(subject_type, subject_id, data_type);
CREATE INDEX idx_sensitive_data_hash ON sensitive_data(value_hash);
```

Tables that reference PII hold the token, not the value. The `contacts` table schema (updated from §4.1):

```sql
-- v1.1 — all PII columns are tokens, not raw values
CREATE TABLE contacts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name_token           TEXT NOT NULL REFERENCES sensitive_data(token),
  first_name_token          TEXT REFERENCES sensitive_data(token),
  last_name_token           TEXT REFERENCES sensitive_data(token),
  email_token               TEXT NOT NULL REFERENCES sensitive_data(token),
  email_2_token             TEXT REFERENCES sensitive_data(token),
  phone_token               TEXT REFERENCES sensitive_data(token),
  phone_2_token             TEXT REFERENCES sensitive_data(token),
  passport_token            TEXT REFERENCES sensitive_data(token),
  itin_token                TEXT REFERENCES sensitive_data(token),
  dob_token                 TEXT REFERENCES sensitive_data(token),
  address_token             TEXT REFERENCES sensitive_data(token),

  -- Non-PII fields (stay as-is)
  language                  TEXT,
  preferred_channel         TEXT,
  citizenship               TEXT,
  residency                 TEXT,
  portal_tier               TEXT,
  kyc_status                TEXT,
  -- ... operational fields
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_test                   BOOLEAN NOT NULL DEFAULT false
);
```

**Event payloads always use tokens.** Example `account.ein_received`:

```json
{
  "ein_token": "token:ein:f3a9b2c1",
  "received_date": "2026-04-15"
}
```

Not `{ "ein_number": "12-3456789" }`. Never.

**Agent context bundles always use tokens.** `TokenizedContactRecord` (§8.3) replaces raw `ContactRecord`. Agents NEVER see decrypted PII.

**Reading PII (the narrow authorized path):**
- `get_sensitive_value(token, purpose)` Postgres function — takes a token + a documented purpose string, checks the caller's role, logs the access (`access_count++`, `last_accessed_at`), decrypts and returns. **v1.2:** if `encrypted_value IS NULL` (GDPR-deleted), returns `NULL` without logging an access (nothing to log). Callers treat a `NULL` return as `'(Deleted)'` at the display layer.
- Application code uses this function ONLY when PII is actually needed:
  - **UI rendering** (admin sees "Marco Rossi" on a client page; portal sees the client's own name).
  - **Signed document generation** (SS-4, OA, Lease embed the real name).
  - **External API calls** that require raw value (Harbor Compliance, Stripe Customer creation).
- Every other code path passes tokens. Agents receive tokens. Event log stores tokens. Logs (Sentry) receive tokens — the UI only decrypts at render time.

**Rendering layer: tokens → display strings**

```typescript
// lib/rendering/pii.ts
export async function renderTemplateWithSlots(
  templateId: string,
  slots: Record<string, string | number>,
  viewer: AuthContext
): Promise<string> {
  const template = await getTemplate(templateId);  // from reasoning_templates or proposal_templates
  const resolvedSlots: Record<string, string> = {};
  for (const [key, value] of Object.entries(slots)) {
    if (typeof value === 'string' && value.startsWith('token:')) {
      resolvedSlots[key] = await resolveToken(value, viewer, 'display');  // authorized read
    } else {
      resolvedSlots[key] = String(value);
    }
  }
  return interpolate(template.text, resolvedSlots);
}
```

If a contact is GDPR-deleted, tokens resolve to `(deleted)` and the UI displays redacted placeholder. Audit trail preserved; PII gone.

#### CRM search capability — known constraint from tokenization (🟠 Fix 5/Round 4)

Full tokenization (no raw names or emails in `contacts`) means SHA-256 hash lookup is the only available search mechanism within the `sensitive_data` table. SHA-256 lookup supports exact-match only: `SELECT token FROM sensitive_data WHERE value_hash = sha256('exact@email.com')`. Fuzzy, prefix, substring, and domain-suffix searches (e.g., "all clients named Marco" or "all clients from gmail.com") are not possible with this approach without either: (a) decrypting all values in application memory — O(N × fields), unsustainable at scale, or (b) a separate blind-index table using n-gram hashes (the CipherSweet pattern).

**Accepted Stage 1 constraint:** at 225 clients, 95%+ of CRM lookups go through `accounts.company_name` (stored in plaintext — company names are public business entities, not personal PII). The CRM search bar searches `accounts.company_name`, `engagements.contract_type`, status fields, and creation date. Contact search by name is available as exact SHA-256 hash only (the admin types the full name or email and the system looks up whether that exact value exists). This covers "is this person already a contact?" but not "show me all contacts with the last name Rossi."

**Stage 2 path:** a `contact_search_tokens` table using n-gram hashes (2-grams of the lowercased first/last name) enables prefix-match search without decrypting. Each name generates ~6-10 n-gram hashes; the search query hashes the prefix and looks for matches. This is a separate build not in Stage 0 scope.

**This constraint is intentional, not an oversight.** The alternative — storing plaintext names in `contacts` for searchability and relying on encryption-at-rest only — would mean GDPR deletion requires rewriting the `contacts` row itself (leaking the name in undo logs, replication slots, and backups). Full tokenization achieves structural GDPR deletion. The search constraint is the cost of that guarantee.

### 14.2 RLS (Row-Level Security) policies

Every client-facing table has explicit RLS policies. Portal (client-facing) access is scoped through an auth chain:

```
auth.uid → contacts.auth_user_id → account_members.contact_id (where left_at IS NULL) → account_id
```

Policies for key tables:

```sql
-- Engagements: portal contact sees engagements for accounts they actively belong to
CREATE POLICY engagements_portal_select ON engagements
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM contacts c
    JOIN account_members am ON am.contact_id = c.id AND am.left_at IS NULL
    WHERE c.auth_user_id = auth.uid() AND am.account_id = engagements.account_id
  )
  OR engagements.contact_id IN (
    SELECT c.id FROM contacts c WHERE c.auth_user_id = auth.uid()
  )
);

-- Events: portal contact sees events where the subject is an entity they have access to
CREATE POLICY events_portal_select ON events
FOR SELECT USING (
  CASE events.subject_type
    WHEN 'engagement' THEN events.subject_id IN (
      SELECT e.id FROM engagements e
      JOIN account_members am ON am.account_id = e.account_id AND am.left_at IS NULL
      JOIN contacts c ON c.id = am.contact_id
      WHERE c.auth_user_id = auth.uid()
    )
    WHEN 'account' THEN events.subject_id IN (
      SELECT am.account_id FROM account_members am
      JOIN contacts c ON c.id = am.contact_id
      WHERE c.auth_user_id = auth.uid() AND am.left_at IS NULL
    )
    ELSE false
  END
);

-- And so on for documents, payments, members, invoices, etc.
```

Admin access bypasses RLS via a service-role key that is only used in admin API endpoints. A separate `admin_users` table + JWT claim identifies admins at the application layer; RLS is additive security, not the primary gate.

**The policy design is documented as a spec** in `supabase/migrations/rls-policies.sql` — every table with RLS has its policy enumerated there, with rationale comments. Reviewers can attack policies individually.

### 14.3 Webhook signature verification

Every inbound webhook endpoint verifies signature before touching the database:

- **Stripe**: `stripe-signature` header + `STRIPE_WEBHOOK_SECRET` + the standard Stripe library's `constructEvent` verification.
- **Whop**: `whop-signature` HMAC with `WHOP_WEBHOOK_SECRET`.
- **Inngest**: Inngest SDK verifies the signature internally — no custom logic.
- **Harbor Compliance**: custom HMAC validation.

A forged webhook is rejected *before* any `emit()` call. Rejection logs with `webhook.rejected` event. No event log pollution from malicious input.

Secret rotation: each secret is stored in Supabase Vault (not .env). Rotation is an ops task with a documented procedure. Stripe and Whop support webhook secret rotation with grace periods; we use the grace period to rotate without downtime.

### 14.4 GDPR deletion — REVISED v1.2 (soft-delete on sensitive_data, not hard-delete; 🔴 Fix 4)

**Why hard-delete is impossible:** `contacts.full_name_token TEXT NOT NULL REFERENCES sensitive_data(token)`. Attempting to `DELETE FROM sensitive_data` where that token is referenced throws a FK violation under `ON DELETE NO ACTION` (Postgres default). The contacts row stays; the FK is live; the delete is blocked. GDPR compliance would fail on the first attempt.

**v1.2 fix — soft-delete:** GDPR deletion sets `encrypted_value = NULL` and `deleted_at = now()` on each targeted `sensitive_data` row. The row stays (FK integrity preserved). The token stays valid. `get_sensitive_value(token)` returns `NULL` when `encrypted_value IS NULL`. Display layer renders `(Deleted)` or equivalent. The value is permanently unrecoverable — the encryption key is discarded and the plaintext is gone — but the row exists as a tombstone, keeping all FKs valid.

When a contact requests GDPR deletion:

1. Admin initiates the deletion workflow via CRM (not exposed to clients directly — verify identity first).
2. A workflow (Inngest) runs:
   a. Identify all `sensitive_data` rows for the contact (`subject_id = contact.id`). Set `encrypted_value = NULL`, `value_hash = NULL`, `deleted_at = now()`, `deleted_by = admin_user_id`.
   b. `contacts` row stays — tokens still reference `sensitive_data` rows (FK valid); `get_sensitive_value()` returns `NULL`; display shows `(Deleted)`.
   c. Emit `contact.gdpr_deleted` event. The token references in the event payload now resolve to `(Deleted)` at render time. Audit trail preserved; raw PII gone.
   d. Notify downstream systems (QuickBooks, Stripe, Whop); initiate per-provider deletion via their APIs.
3. Downstream: event payloads referencing this contact via tokens still exist. All tokens resolve to `(Deleted)` at render time. No event is mutated; the append-only invariant holds.

**Why v1.2's structural tokenization makes this clean:** free-form agent reasoning ("Marco Rossi has been waiting 10 days") would survive deletion as orphan PII. v1.1+ template-slot outputs contain only tokens, so soft-nulling the `sensitive_data` rows automatically redacts all rendered forms — admin views, portal views, archived proposals, and historical event audit pages all show `(Deleted)` for deleted contacts. No post-hoc scrubbing of event payloads is required.

**Secondary control for any remaining free-form fields** (e.g., exception reasons typed by admins, chat messages): pre-emit NER + regex scrubber runs at `emit()` entry. Detected names, emails, phone numbers, addresses in free-form fields are replaced with tokens before the event is written. This catches the residual gap that structure alone doesn't close.

```typescript
// lib/events/emit.ts (excerpt)
async function scrubPayloadForPII(eventType: string, payload: unknown): Promise<unknown> {
  const freeFormFields = getFreeFormFieldsForEvent(eventType);  // declared per event type
  for (const field of freeFormFields) {
    const text = getField(payload, field);
    if (text) {
      const scrubbed = await scrubText(text);  // NER + regex
      setField(payload, field, scrubbed.text);
      if (scrubbed.replacements.length) {
        // Log for audit + allow retrieval through sensitive_data
        await storeScrubRecord(eventType, field, scrubbed.replacements);
      }
    }
  }
  return payload;
}
```

Scrubber caught tokens still resolve via `sensitive_data` at render time (admins see original, clients see what they're authorized to see). GDPR deletion wipes the sensitive_data rows; scrubbed tokens in historical payloads resolve to `(deleted)`.

Document retention policies (per applicable jurisdiction — we follow the more conservative US-state and EU-resident rules):
- Financial records (invoices, payments): 7 years minimum retention.
- Contracts and identifying documents: 7 years.
- Communication history: 3 years default, longer if legally required.

Automatic deletion cron: runs monthly, deletes data past retention thresholds. Soft-deleted first (`status='pending_purge'`), then hard-deleted after 30-day grace.

### 14.5 Authentication, authorization, sessions

**Authentication**: Supabase Auth. Magic-link or email+password for portal contacts. TOTP 2FA for admins (enforced, not optional).

**Authorization**: admin role checked via JWT claim (`role: 'admin'`) issued by a custom JWT enrichment function at login. Cell-level authz (row-level) is RLS. API-level authz (route handler) checks JWT claim.

**Sessions**: JWT expires in 1 hour; refresh token expires in 30 days. Refresh tokens are rotated on use (each refresh issues a new one, old becomes invalid).

**Password policy**: min 12 characters, complexity rules, breach check via HIBP (optional, config-gated).

**Logout**: invalidates the refresh token server-side; JWTs expire naturally.

### 14.6 Rate limiting and abuse prevention

- **API endpoint rate limiting** via Vercel middleware. Per-IP and per-authenticated-user limits; aggressive on public endpoints (offer signing, chat message post), lenient on authenticated admin endpoints.
- **Webhook rate limiting** via the outbox drain worker — if a webhook provider is flooding us, the outbox queue grows; monitoring alerts; we can throttle downstream without losing events.
- **Agent invocation rate limiting** via Inngest concurrency + the cost cap (Section 22). Soft cap at monthly-budget-on-track; hard cap at 100% of budget.

### 14.7 Security rationale and devil's-advocate flags

**[R101-FLAG on PII tokenization overhead.]** Every read of a passport number requires decryption + audit log write. At high volume this is measurable latency.

The resolution: for admin UI reads, decryption is per-view, which is low volume. For agent reads, tokens are not decrypted — agents work with tokens, never raw values. For template generation (signed PDFs, SS-4 forms), decryption is per-document-generation, acceptable batch.

**[R101-FLAG on RLS complexity.]** Deep RLS chains (auth.uid → contact → member → account → engagement → event subject) are expensive and hard to maintain.

The resolution:
1. Materialized indexes — for portal hot paths, we can add a materialized `portal_engagement_access` view per contact that pre-joins the access chain. Refreshed on membership change.
2. Policies are tested — every policy has a test case in `tests/rls/` that seeds a user, attempts access, asserts outcome. Policy changes break tests if the intended access model shifts.
3. Admin bypass is explicit via service-role, not via policy tricks. Service-role usage is audited.

**[R101-FLAG on GDPR deletion completeness.]** Events referencing a deleted contact still exist. If the event payload includes contextual text that names the contact ("Send welcome email to Mario Rossi..."), that text is not a structured PII token — it's free-form and might survive deletion.

The resolution: event payloads are generated with tokens in place of names wherever possible. Free-form text in payloads is scanned for potential PII leakage in a pre-emit validator — if the validator detects name-like patterns in contextual fields, the emit fails with a warning. This is imperfect (detection can miss); the fallback is a GDPR deletion scrubbing pass that replaces detected PII patterns in historical event payloads with tokens. Scheduled, audited.

**[R101-FLAG on Supabase Vault key rotation.]** Encryption keys rotate periodically. All encrypted values must be re-encrypted with new keys.

The resolution: Supabase Vault supports this natively. Rotation is a documented ops procedure: generate new key, re-encrypt all rows (batch job), verify, deprecate old key. Scheduled annually or on suspected compromise.

---

## 15. Claude API and Model Strategy

The AI layer runs on Anthropic's Claude API. Model choice, optimization, and integration pattern are not detail — they directly affect cost, quality, and whether the system delivers on its vision.

### 15.1 Model mix

Expected distribution of API calls across models:

| Model | Share | Use cases |
|---|---|---|
| Claude Haiku 4.5 | ~70% | Triage classification, simple requirement checks, routine summaries, bulk categorization, first-draft communication |
| Claude Sonnet 4.6 | ~25% | Communication drafting (tone matters), solver consults (light reasoning), non-trivial proposal scoring, complex classifications |
| Claude Opus 4.7 | ~5% | Ambiguous rule interpretation, complex eligibility determinations, cross-engagement reasoning, exception pattern analysis |

Model pricing (Anthropic, 2026):
- Haiku 4.5: $1 per 1M input tokens / $5 per 1M output tokens
- Sonnet 4.6: $3 per 1M input tokens / $15 per 1M output tokens
- Opus 4.7: $5 per 1M input tokens / $25 per 1M output tokens

Model selection is per-task, declared in the agent's dispatch table (`lib/agents/dispatch.ts`). The default for each task type can be overridden per-spec (e.g., a spec's `ai_evaluable` requirement can specify `model: 'opus'`).

### 15.2 Prompt caching

Anthropic's prompt caching discounts cached input tokens by up to 90%. Smart AI applies caching aggressively to the parts of the context bundle that are stable across invocations:

- **System prompt** (agent instructions, R101 reminder, structured-output schema hints): always cached.
- **Retrieved SOP chunks** where the same chunks appear across invocations: cached for 5+ minutes on first hit.
- **Applicable rule overrides** (stable for most invocations): cached.
- **Scar index retrievals** when similar queries return similar results: cached.

**Dynamic content is not cached:**
- Engagement-specific state.
- Recent events.
- Task description.
- Per-invocation unique context.

Net cost impact: ~60-70% reduction in input token cost. Without caching, 225 clients → ~$3,000/month. With caching, 225 clients → ~$900-1,400/month.

### 15.3 Batch API

Anthropic's Batch API offers a flat 50% discount on all token costs for asynchronous workloads that complete within 24 hours. Smart AI uses Batch API for:

- **Nightly exception pattern analysis** (run weekly, analyze all exceptions from prior week).
- **Nightly scar-matching recomputation** (run weekly, ensure agent retrieval is current).
- **Periodic calibration analysis** (monthly, compute AI confidence vs actual accuracy per task type).
- **Bulk classification backfills** (e.g., when a new service type is added and historical documents need classification against it).

Interactive (synchronous) workloads — agent proposals, real-time chat responses, requirement evaluations during active user sessions — do not use Batch API. They run at full price because latency matters.

### 15.4 Structured outputs

Every Claude invocation uses the Anthropic tool-use API with a strict JSON schema. This constrains the model to produce valid output that the application can deserialize without a parser.

Example for requirement evaluation:

```typescript
const aiDecisionTool = {
  name: 'commit_requirement_decision',
  input_schema: {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['eligible','not_eligible','requires_human_review'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reasoning: { type: 'string', minLength: 20 },
      evidence_cited: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_type: { type: 'string', enum: ['sop_chunk','scar','event','document'] },
            source_id: { type: 'string' },
            excerpt: { type: 'string' }
          },
          required: ['source_type','source_id','excerpt']
        },
        minItems: 1
      },
      recommendation: { type: 'string' },
      alternative_considered: { type: 'string', minLength: 20 },
      weakness_acknowledged: { type: 'string', minLength: 20 }
    },
    required: ['decision','confidence','reasoning','evidence_cited','recommendation','alternative_considered','weakness_acknowledged']
  }
};
```

If the model tries to emit output that doesn't match the schema, Anthropic's API rejects the output and the call retries (with guidance). If it consistently fails, the agent escalates to human review.

### 15.5 Response validation post-API

Beyond structured output, every response is validated in application code:

1. **Zod schema validation** (redundant with Anthropic's enforcement but defensive — we catch API regressions and malformed edge cases).
2. **Semantic validation**:
   - `source_id` values are checked against the database — if the model invented an ID, fail.
   - `confidence` is clamped to [0, 1].
   - `reasoning` length is enforced.
3. **Scar cross-check**: if the proposal's scar_matches reference scars with preventions that the current state doesn't satisfy, the proposal is flagged for human review regardless of confidence.

### 15.6 Calibration loop — REVISED v1.2 (🟠 Fix 9: admin_approved ≠ outcome_correct)

Model confidence is notoriously miscalibrated (reported 0.9 ≠ actual 0.9 accuracy). The calibration loop measures and corrects. **v1.1 replaced weekly batch analysis with a Bayesian sequential test.** **v1.2 fixes the feedback signal**: v1.1 conflated `admin_approved` with correctness, creating a rubber-stamp loop — if admins routinely approve proposals without scrutiny, the model learns "approved = correct" and thresholds drift downward as quality silently degrades.

**Two distinct signals — never conflated:**

| Signal | What it means | When available | Used for |
|--------|--------------|----------------|---------|
| `admin_approved` | Admin clicked Approve | Immediately on approval | Workflow trigger only — does NOT feed calibration |
| `outcome_correct` | The action produced the intended outcome | Materialized later (hours to days) | Calibration input — only signal that feeds Beta update |

`outcome_correct` is set by domain logic, not admin opinion:
- For email reminders: did the client respond or complete the action within the expected window? (set by a Inngest follow-up step N days later)
- For document request proposals: did the submitted document satisfy the requirement? (set when solver transitions requirement to `satisfied`)
- For exception recommendations: did the engagement proceed without a re-block? (set 30 days post-exception)
- For triage / classification: did the engagement follow the predicted path? (set at engagement.completed or first manual re-classification)

Until `outcome_correct` is materialized, the observation is pending and does not update any Beta distribution. An observation that never resolves (e.g. engagement still open after 6 months) is excluded from calibration permanently.

**Data collection:** for each proposal or AI decision, we record:
- The confidence the model reported.
- `admin_approved` (boolean) — records the human action, not the correctness.
- `outcome_correct` (boolean | null) — null until materialized by domain logic.
- Task type, model used, context bundle size, scar matches.

**Bayesian sequential calibration (runs on `outcome_correct` observations only):**

For each `(task_type, model, confidence_bucket)` tuple, maintain a Beta distribution `Beta(α, β)` where:
- `α` = outcomes correct + 1 (uninformative prior)
- `β` = outcomes incorrect + 1 (uninformative prior)

On each new `outcome_correct` observation, update `α` or `β`. After each update:
1. Compute posterior mean accuracy: `α / (α + β)`.
2. Compute the 95% credible interval.
3. **If** posterior mean diverges from target by > 10% **AND** credible interval width < 0.15: fire an alert and adjust the auto-execution threshold incrementally.

This alerts within hours of sufficient evidence accumulating — not after a weekly batch. At low volumes, the credible interval is wide and no adjustment fires; the prior dominates safely. As volume grows, the CI narrows and adjustments become precise.

**Minimum evidence before any threshold adjustment:** 20 resolved `outcome_correct` observations per bucket. Below 20, the prior dominates and the estimate is conservative by design.

**Why this matters:** if admins batch-approve 40 proposals at once ("the rubber-stamp session"), all 40 fire `admin_approved=true`. Under v1.1, all 40 would immediately update the Beta distribution toward "correct." Under v1.2, those 40 are pending until their domain outcomes resolve — some may set `outcome_correct=false` when clients don't respond or requirements re-block. The calibration reflects actual effectiveness, not admin approval behavior.

**Example outcome:**
- Task: "Classify inbound email to engagement", Model: Haiku 4.5.
- Initial auto-route threshold: 0.9 reported confidence.
- After 150 resolved outcomes (not approvals): 102 correct, 48 incorrect.
- Posterior mean = 0.68. 95% CI width = 0.14 → drift confirmed. Alert fires within hours of the 150th resolved outcome.
- Threshold adjusted to 0.95 reported confidence to achieve target 0.68+ actual.

**Schema addition (v1.2):**
```sql
ALTER TABLE calibration_observations
  ADD COLUMN admin_approved    BOOLEAN,
  ADD COLUMN admin_approved_at TIMESTAMPTZ,
  ADD COLUMN outcome_correct   BOOLEAN,          -- NULL until materialized
  ADD COLUMN outcome_set_at    TIMESTAMPTZ,
  ADD COLUMN outcome_set_by    TEXT;             -- which domain logic set it (e.g. 'solver:requirement_satisfied')

-- Partial index: calibration queries only resolved observations
CREATE INDEX idx_calibration_resolved
  ON calibration_observations(task_type, model, confidence_bucket)
  WHERE outcome_correct IS NOT NULL;
```

This calibration data is stored in `calibration_metrics` table (with per-bucket Beta parameters) and drives `calibrated_threshold_per_task` config that the agent dispatch reads on every call.

### 15.7 Cost monitoring

Every agent invocation logs its cost to the `ai.decision` or `agent.invoked` event payload:

```typescript
{
  model: 'claude-haiku-4.5-20260210',
  tokens_input: 4200,
  tokens_input_cached: 3800,
  tokens_output: 450,
  cost_usd: 0.0028,
  cached: true,
  batch: false
}
```

Aggregated via materialized views:
- Cost per day, by task type.
- Cost per engagement (attribution).
- Cost per admin action (if admin-triggered).
- Cost per client tier (One-Time vs Client vs Partner).

**Monthly cap**: hard ceiling at $4,000 initially. Alert at 80% of monthly projection. At 100%, non-critical agent invocations are throttled (e.g., nightly pattern analyses deferred; routine reminders queued); critical paths (requirement evaluation on active engagement, client-facing chat response) continue.

Raising the cap is Antonio's decision, triggered by observed volume trending past the ceiling.

### 15.8 Model upgrade strategy

New Claude models ship periodically (Anthropic released Opus 4.7 on 2026-04-16, for example). Smart AI's upgrade policy:

1. **Do not upgrade production agents automatically.** Model versions are pinned per task_type in the dispatch table.
2. **Shadow-test new models** for 2-4 weeks on non-interactive workloads (Batch API analyses, nightly exception pattern detection). Compare output quality and cost.
3. **Run a calibration rebuild** if the new model's confidence calibration differs materially.
4. **Gradual rollout**: move easiest task types to the new model first (Triage), measure, then more complex (Communications, Tax). High-risk types (Exception reasoning) are last.

Model versions are part of the `ai.decision` event payload for forensic traceability: if a decision is later challenged, we know which model produced it.

### 15.9 Claude API rationale and devil's-advocate flags

**[R101-FLAG on multi-model complexity.]** Three models, per-task dispatch, calibration per (task, model), cache tuning per model — this is operationally complex.

The resolution: the dispatch table is small and declarative. Calibration is automated weekly. Caching is handled by Anthropic. The complexity is real but bounded by a few config files, not spread across the codebase.

**[R101-FLAG on Anthropic dependency.]** Single vendor. If Anthropic raises prices, changes APIs, or has extended outages, Smart AI is affected directly.

The resolution:
1. **Abstraction layer**: `lib/agents/llm.ts` wraps Anthropic calls behind a provider-neutral interface. Swapping in OpenAI or another provider is a file-level change, not a system-level change.
2. **Fallback provider**: at Stage 2+, add OpenAI as a secondary provider. Dispatch can route to it on Anthropic errors or cost spikes.
3. **Model variety within vendor**: Haiku, Sonnet, Opus are distinct enough that partial-outage resilience exists (if Opus is degraded, fall back to Sonnet for ambiguous reasoning with lower confidence).

**[R101-FLAG on prompt cache TTL.]** Cached content expires. If an invocation happens just after expiry, cost jumps.

The resolution: the cache is a cost optimization, not a correctness feature. Expiry means full-price input tokens; no functional issue. We size the cost budget with cache-miss factored in.

**[R101-FLAG on calibration overfitting.]** With small N (few hundred invocations per task type early on), even Bayesian estimates can be gamed by early observations if the prior is too informative.

The resolution (v1.1): the prior `Beta(1,1)` is uninformative — it assumes no knowledge of accuracy. Adjustments require both posterior-mean divergence (> 10%) AND credible interval width (< 0.15). Both conditions together resist overfitting at low N: the CI cannot be narrow enough to trigger an adjustment until real data has accumulated. Initial thresholds are conservative; they loosen only when the CI narrows from actual data, not from assumed accuracy. Minimum 20 observations per bucket before any adjustment — so a bad first 5 observations don't flip the threshold.

---

## 16. Workflow Engine — Inngest

Inngest is the durable workflow engine for Smart AI. All long-running work, scheduled work, retry-requiring work, and workflow coordination runs here.

### 16.1 Why Inngest (not Temporal, not homemade)

Already detailed in the Architecture Overview (Section 3.4), but the summary:

| Criterion | Inngest | Temporal | Homemade |
|---|---|---|---|
| Managed | Yes | Temporal Cloud yes, self-host possible | You operate it |
| Vercel-native | Yes (SDK, adapter) | No (requires worker tier) | N/A |
| Ready in | Days | Weeks | Months |
| LLM-heavy workload fit | Excellent | Payload saturation issues (documented) | Depends on design |
| Observability built-in | Yes | Needs external wiring | You build it |
| Cost at Smart AI's scale | $75-300/mo | $200-600/mo+ worker tier cost | "Free" but ops-heavy |
| Community/maturity | 3+ years, growing | 9+ years, very mature | — |

For Smart AI's workload (~225 clients, hundreds of workflows per day, agent-heavy with large prompts in event payloads), Inngest is the right fit.

### 16.2 Integration pattern

Inngest is integrated via Next.js API route + SDK:

```typescript
// app/api/inngest/route.ts
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import * as functions from '@/lib/inngest/functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: Object.values(functions),
});
```

Functions are defined as typed step functions:

```typescript
// lib/inngest/functions/formation-pipeline.ts — REVISED v1.3 (🔴 Fix 3/Round 4)
export const formationPipeline = inngest.createFunction(
  { id: 'formation-pipeline', name: 'Formation Pipeline' },
  { event: 'engagement.started' },
  async ({ event, step }) => {
    // engagement_id is now present on every engagement-scoped Inngest event
    // because the drain injects it from row.subject_id (Fix 3).
    const engagementId = event.data.engagement_id;

    await step.run('verify-payment', async () => {
      const solver = await solve(engagementId);
      const payment = solver.requirements.find(r => r.key === 'payment');
      if (payment?.status !== 'satisfied') {
        throw new Error('Payment not confirmed; formation cannot proceed');
      }
    });

    // step.waitForEvent now resolves correctly because:
    // (a) the triggering event (engagement.started) has data.engagement_id (injected by drain)
    // (b) the waited-for event (requirement.satisfied) also has data.engagement_id (injected by drain)
    // Both fields exist in the Inngest event data envelope; match works as intended.
    await step.waitForEvent('member-documents-received', {
      event: 'requirement.satisfied',
      match: 'data.engagement_id',   // ✅ field now present on both sides
      timeout: '7d',
      if: `event.data.requirement_key == 'member_passport'`,
    });

    await step.run('file-with-state', async () => {
      // Invoke Harbor Compliance or direct state filing.
      // Uses withEmit() (parameterized) — no bare emit() calls exist in v1.3.
      await withEmit({
        event_type: 'state_filing.submitted',
        actor_type: 'inngest',
        subject_type: 'engagement',
        subject_id: engagementId,
        account_id: event.data.account_id,
        payload: { filed_at: new Date().toISOString(), filing_id: '...' },
        idempotency_key: `inngest:state-filing:${engagementId}`,
      });
    });

    // Continue through EIN, OA, etc. — each step uses withEmit().
  }
);
```

Each `step.run` is a durable checkpoint — if the function fails mid-execution, it resumes from the last completed step on retry. Each `step.waitForEvent` blocks execution until the event arrives or timeout hits. The engine handles persistence, retry, and coordination.

### 16.3 Event-triggered workflows

Smart AI uses Inngest's event-driven pattern. Events from the outbox drain trigger workflows matched by name + filters:

- `engagement.started` → `formationPipeline` (if contract_type='formation'), `onboardingPipeline` (if 'onboarding'), `taxIntakePipeline` (if 'tax').
- `payment.confirmed` → `paymentConfirmedHandler` (activates services, triggers notifications).
- `document.uploaded` → `documentProcessingWorkflow` (classify, extract, satisfy requirements).
- `requirement.satisfied` → `agentTriggerWorkflow` (decide if agent should act on the updated state).

Each workflow is narrow and testable. Composition happens via event chaining, not nested calls.

### 16.4 Scheduled workflows

Cron-triggered functions for periodic work:

- **`outboxDrain`** — every 10 seconds (also triggered by Realtime on insert).
- **`exceptionExpirer`** — daily at 00:30 UTC.
- **`reminderCadenceRunner`** — daily at 14:00 UTC (per-client timezone adjusted).
- **`calibrationAnalyzer`** — weekly Sunday 02:00 UTC (uses Batch API).
- **`scarReembedder`** — daily at 03:00 UTC (refreshes pgvector embeddings if scar content changed).
- **`sopReembedder`** — daily at 03:30 UTC (reads v1 sop_runbooks, chunks, embeds).
- **`shadowDiffSampler`** — hourly (reads v1 webhooks, tees into v2 shadow mode).
- **`dailyDigest`** — daily at 08:00 Antonio's timezone (summarizes new proposals, unresolved items).

All scheduled functions use Inngest's cron expressions plus concurrency limits to prevent overlapping executions.

### 16.5 Retry and failure handling

Inngest handles retries automatically with configurable policies:

- **Default retry**: exponential backoff, 3 retries, max 10 minutes between attempts.
- **Custom retry** per function for cases requiring different behavior (e.g., external API with known flaky periods → more retries with longer backoff).
- **Step-level granularity**: a failing step retries independently of the rest of the function.
- **Dead letter queue**: after max retries, the function is marked `failed`. Inngest dashboard shows failures; alerts fire.
- **Manual replay**: failed functions can be replayed from the dashboard or via API.

### 16.6 Observability within Inngest

- **Run history**: every function execution is logged with input, output per step, timing.
- **Cost attribution**: Inngest dashboard shows execution count per function; we map this to our own cost model.
- **Alerts**: email/Slack on failure after N retries, or on cron drift.

Augmented in Smart AI's own observability (Section 18): Inngest run IDs are logged in `ai.decision` / `agent.invoked` events, creating cross-reference between Inngest history and Smart AI's event log.

### 16.7 Inngest rationale and devil's-advocate flags

**[R101-FLAG on vendor dependency.]** Inngest is 3 years old. If it folds or degrades, we're affected.

The resolution:
1. The workflow functions are plain TypeScript. Migration to Temporal, Trigger.dev, or a homemade queue is a wrapper-layer change, not a business-logic rewrite.
2. Inngest has VC backing and growing adoption. Near-term vendor risk is low.
3. If we outgrow Vercel + Inngest, Temporal becomes viable — we'll have validated workflow logic to port.

**[R101-FLAG on pricing scale.]** Inngest's Pro tier starts at $75/mo with execution-based billing. At high event volume (1,000 clients with 100 events/day), executions can rack up.

The resolution: cost at 1,000 clients is estimated at $300/mo Inngest. Proactive monitoring catches cost overruns before they're material. Critical workflows always run; non-critical batch operations can be deferred if hitting limits.

**[R101-FLAG on cold starts.]** Inngest functions run on serverless infrastructure. Cold starts can add latency.

The resolution: for time-sensitive workflows (chat responses, auth checks), cold starts are a concern. Solutions: dedicated Vercel instances for hot paths, or move interactive latency-sensitive workflows out of Inngest entirely and into direct API routes. Most of Smart AI's Inngest usage is async (outbox drain, formation pipeline, scheduled jobs) where a 100ms cold start is invisible.

---

---

## 17. Infrastructure and Environments

Smart AI TD Operations runs on the same providers as v1 plus Inngest. Every piece of infrastructure is named, isolated, and accounted for here. Nothing is assumed; every reference below is something a reviewer can look up directly.

### 17.1 Environment topology

Three distinct environments exist across v1 and Smart AI. They never share env vars, database connections, webhook destinations, or domains.

**v1 Production**
- Supabase ref: `ydzipybqeebtpcvsbtvs`
- Vercel project: `td-operations` (production)
- Domains: `app.tonydurante.us` (client-facing), `portal.tonydurante.us` (portal), `td-operations.vercel.app` (internal OAuth issuer / CRM admin), `offerte.tonydurante.us` (legacy offer links)
- Purpose: serves the existing 253 Active accounts and all in-flight engagements.
- Owner: v1 CLAUDE.md.

**v1 Sandbox**
- Supabase ref: `xjcxlmlpeywtwkhstjlw`
- Vercel project: `td-operations-sandbox`
- URL: `td-operations-sandbox.vercel.app`
- Purpose: v1 feature testing, QA, destructive-test-friendly. Antonio and Luca validate v1 changes here before production deploy.
- Owner: v1 CLAUDE.md (section: Sandbox Environment).

**Smart AI (v2)**
- Supabase ref: `tapbgvbglqacamhayfel` (verified alive via REST probe 2026-04-21 at 23:30 UTC; owner confirmed by Antonio)
- Vercel project: `td-operations-v2` (to be created at Stage 0 S0.1)
- Domain: `v2.tonydurante.us` (to be provisioned at Stage 0 S0.1)
- Purpose: greenfield rebuild. Shadow-consumes v1 webhooks read-only; at cutover, new clients land here.
- Owner: this plan + Smart AI CLAUDE.md.

**Cross-environment rules:**
- No env var from one environment appears in another.
- No webhook destination of one environment is registered with any provider in the context of another.
- `EXPECTED_SUPABASE_REF` middleware assertion in each environment refuses to boot if the connected Supabase ref doesn't match the expected value. Fatal error on mismatch.
- Domains are fully separated. `v2.tonydurante.us` never resolves to the v1 production Vercel project.

### 17.2 Supabase (data, auth, realtime, storage)

**Usage by layer:**
- **Data** — Postgres with pgvector extension. All core tables (`accounts`, `contacts`, `account_members`, `engagements`, `events`, `outbox`, `sensitive_data`, `service_specs`, `rule_overrides`, `exceptions`, `proposals`, `ai_decisions`, `v1_scars`, `shadow_diffs`, etc.).
- **Auth** — Supabase Auth for portal contacts (magic link + password); admin auth via the same but with TOTP 2FA required.
- **Realtime** — channel subscriptions for portal page live updates (event-scoped channels).
- **Storage** — client documents go here (NOT Google Drive for v2 at first cutover; see "Storage strategy" below).
- **Edge Functions** — used for webhook receivers (Stripe, Whop, Inngest signature verification entry points), specifically so webhook verification runs close to Postgres with low latency.
- **Vault** — secrets (webhook signing keys, encryption keys). Not in env vars beyond bootstrap.

**Storage strategy for v2:**
- v1 uses Google Drive Shared Drive (`0AOLZHXSfKUMHUk9PVA`) for client documents. That setup stays for v1.
- For Smart AI, we start with Supabase Storage as the document repository (first cutover). Supabase Storage is S3-compatible, has direct RLS integration, is cheaper to operate (no Drive service account / DWD configuration), and is simpler to audit.
- Drive integration becomes a Stage 2+ add-on if document-sharing workflows with non-portal parties (accountants, legal counsel) require it. Not Stage 1 scope.

**Postgres extensions to enable on Smart AI ref:**
- `uuid-ossp` or `pgcrypto` (for `gen_random_uuid`, already standard).
- `pgvector` (for embeddings, retrieval).
- `pg_cron` (optional; most scheduling via Inngest).
- `pg_net` (optional; HTTP calls from functions).

### 17.3 Vercel (hosting, edge, domain, env management)

**Vercel projects:**
- `td-operations` — v1 production, existing, untouched.
- `td-operations-sandbox` — v1 sandbox, existing, untouched.
- `td-operations-v2` — Smart AI, **to be created at Stage 0 S0.1**.

**Project configuration for `td-operations-v2`:**
- Framework: Next.js 14+ (same as v1).
- Region: primary US East (co-located with Supabase Smart AI region for low latency).
- Build command: `npm run build` (Next.js default + type checking).
- Output: server-rendered + edge middleware.
- Deployment: Git-connected to `TonyDuranteSystem/td-operations-smart-ai` → auto-deploy on push to `main`.
- Preview deployments: per-branch for PR review.

**Required environment variables (Smart AI project):**
- `NEXT_PUBLIC_SUPABASE_URL` — Smart AI Supabase REST URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Smart AI anon key.
- `SUPABASE_SERVICE_ROLE_KEY` — Smart AI service role key (admin API paths only).
- `EXPECTED_SUPABASE_REF` — `tapbgvbglqacamhayfel` (middleware trip wire).
- `ANTHROPIC_API_KEY` — Claude API key (separate from v1's key; attribution clean).
- `INNGEST_EVENT_KEY` — Inngest event ingestion key.
- `INNGEST_SIGNING_KEY` — Inngest webhook signature verification.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — only when we wire Stripe to v2 (post Stage 1).
- `WHOP_API_KEY` / `WHOP_WEBHOOK_SECRET` — same.
- `OPENAI_API_KEY` — for embeddings only (until Anthropic embeddings GA).
- `SENTRY_DSN` — error tracking.

**Vercel 60-second timeout:** mitigated by offloading all long work to Inngest. API routes that might exceed 60s instead emit an event and let Inngest handle the actual work.

**Middleware:**
- `middleware.ts` at project root.
- Asserts `EXPECTED_SUPABASE_REF` vs connected ref on cold start; 500s if mismatched.
- Enforces auth on portal and admin paths.
- Blocks webhook routes if `SANDBOX_MODE=1` is set (safety).
- Blocks any reference to v1 Supabase URL (regex check on config); fatal.

### 17.4 Inngest (workflow engine) — REVISED v1.1 (🟡 Fix O: explicit engine.ts wrapper; direct handler pattern)

**Inngest account setup:**
- Create a new Inngest organization (or use existing if Antonio has one).
- Create a new app within the org: `td-operations-v2`.
- Link to the Vercel project via the Vercel + Inngest integration (one-click).
- Generate event key and signing key; inject as env vars.
- Configure notification channel (email or Slack) for function failures.

**Pricing tier:** start at Pro ($75/mo). Monitor usage; upgrade if needed. Expected usage 50k-200k executions/month at 225-500 clients, well within Pro limits.

**🟡 Fix O — `lib/workflows/engine.ts` abstraction wrapper.** All workflow invocations in Smart AI route through a single abstraction layer, not directly against the Inngest client. This means a future vendor swap (Temporal, homemade, whatever Antonio approves) is a single-file change, not a codebase-wide search-and-replace.

```typescript
// lib/workflows/engine.ts
// The ONLY place in the codebase that imports from 'inngest'.
// All other code calls this module.

import { inngest } from './inngest-client';

export const workflows = {
  /**
   * Trigger an event-driven workflow.
   * Called from API routes and event handlers.
   */
  trigger: async (eventName: string, data: unknown): Promise<void> => {
    await inngest.send({ name: eventName, data });
  },

  /**
   * Register a function that Inngest will invoke.
   * Called in lib/inngest/ — never directly in business logic.
   */
  createFunction: inngest.createFunction.bind(inngest),

  /**
   * Schedule a cron-based workflow.
   */
  schedule: (cronExpression: string, id: string, handler: InngestFunction) =>
    inngest.createFunction({ id, name: id }, { cron: cronExpression }, handler),
};
```

Every file in `lib/` that triggers a workflow imports from `lib/workflows/engine.ts`. The Inngest client (`lib/workflows/inngest-client.ts`) is the only file that touches `inngest` directly.

**Direct handler pattern (infrastructure implications).** Section 5.4 (emit() contract) describes the direct handler pattern in detail. The infrastructure consequence: hot-path handlers (the sync DB operations: entity write + outbox insert) run inside Vercel serverless functions within a single transaction. Inngest reads the outbox for side effects (sending emails, triggering sub-workflows, calling external APIs). This means:

- **Vercel handles the hot path** (fast, < 200ms, within the 60s timeout easily).
- **Inngest handles the cold path** (durable, retryable, no timeout concern).
- The separation is enforced by convention: any code that calls `workflows.trigger()` is side-effecting (cold path). Any code that calls `emit()` and returns is hot-path. Cold-path code never happens synchronously inside a hot-path handler.

### 17.5 Anthropic (Claude API)

**Account:**
- Use Antonio's Anthropic org. Create a new project within the org: "Smart AI TD Operations".
- Issue a separate API key for this project (separates billing from any other workloads on the org).
- Set workspace-level spend limits if the Anthropic console supports them (it does as of 2026).

**Prompt caching:** automatic via the API (no setup needed beyond passing `cache_control` parameters on cached sections of the prompt). Monitor cache hit rate via the response headers + dashboard.

**Batch API:** opt-in per call. Agent dispatch marks tasks eligible for batching (nightly analyses); interactive tasks stay real-time.

### 17.6 OpenAI (embeddings only, interim)

**Why OpenAI embeddings, not Anthropic:**
- As of plan-write date, Anthropic's embeddings API is in beta/limited. OpenAI's `text-embedding-3-small` (1536 dim, $0.02 per 1M tokens) is stable, cheap, sufficient.
- pgvector stores the embeddings; we're not locked into the provider — we can re-embed if Anthropic ships GA embeddings later.
- Embedding cost is negligible (<$5/mo at 225 clients even with daily re-embeds).

**Migration path:** when Anthropic ships embeddings GA with comparable cost/quality, add a flag in the embedding helper to switch providers. Re-embed existing pgvector rows in a Batch API job. No application code changes.

### 17.7 GitHub repository

**Repo:** `TonyDuranteSystem/td-operations-smart-ai`
- Created: 2026-04-21 (commit `baa4c5e`).
- Visibility: private.
- Branch protection on `main`: require PR, require passing CI, require at least one approving review (future — currently Antonio approves in the conversation).
- Husky pre-commit hooks: lint-staged runs ESLint on staged TS/TSX.
- Husky pre-push hooks: remote-sync check, hardcoded-domain check, ESLint on changed files vs origin/main, unit tests (Vitest), full `next build`.

**Directory structure (bootstrapped):**
- `lib/specs/` — TypeScript spec authoring (DSL, seed, resolver with pin_date)
- `lib/agents/` — agent dispatch, tools, context builder, schemas.generated.ts
- `lib/rules/` — named TypeScript rule functions (< 50 lines each, registered)
- `lib/scars/` — scar extraction scripts and seed helpers
- `lib/events/` — emit(), event type definitions, Zod schemas, outbox
- `lib/solver/` — solver logic (pure function, no DB writes)
- `lib/workflows/` — engine.ts abstraction wrapper + inngest-client.ts (ONLY Inngest import point)
- `lib/inngest/` — Inngest function definitions (registered via workflows.createFunction)
- `app/` — Next.js routes (portal, CRM, admin, API)
- `tests/unit/` — unit tests
- `tests/integration/` — integration tests
- `supabase/migrations/` — SQL migrations
- `docs/` — this plan, ADRs, operational runbooks

### 17.8 MCP server (for Claude Code development)

**v1 MCP:** `af7d85f2-3684-4443-8eac-bb32d00e32be` — 206 tools, all pointing at v1 Supabase production. Stays pointed at v1 for v1 development.

**Smart AI MCP (to be created):**
- Clone of v1 MCP codebase (same repo or a new one; decided at Stage 0 S0.1).
- Repointed at Smart AI Supabase (`tapbgvbglqacamhayfel`).
- Tool surface trimmed to greenfield-only tools:
  - `execute_sql` (scoped to Smart AI DB)
  - `session_checkpoint` (against Smart AI's own session_checkpoints table)
  - `sysdoc_*` (Smart AI's own sysdocs, or a thin adapter to v1 sysdocs during the build period)
  - `dev_task_*` (Smart AI's own dev_tasks table post-Stage 0; for now, dev_tasks live in v1 sysdocs for single-read-surface convenience)
  - New Smart AI-specific tools: `event_inspector`, `scar_search`, `scar_create`, `proposal_inspector`, `spec_editor_dryrun`.
- Bearer-token + OAuth 2.1 dual auth (same pattern as v1).

Until the Smart AI MCP is up (Stage 0 S0.1 completes), Claude Code development sessions on the Smart AI repo use the v1 MCP for cross-reference queries (reading v1 sop_runbooks for scar population, querying v1 data for panel verification) but not for Smart AI writes. Smart AI writes happen via direct Supabase admin client in code or via Supabase CLI for migrations.

### 17.9 Claude Code (development tool)

The system is built by Claude Code (Opus 4.7, 1M context) running locally on Antonio's MacBook. Session discipline (Section 21) governs how Claude operates.

**Per-session setup:**
- Read `sysdoc_read('smart-ai-td-ops-architecture')` — this plan + decision record.
- Read `sysdoc_read('smart-ai-td-ops-stage-0-worklist')` — current stage worklist.
- `git pull origin main` — sync with other machines (if any are working on Smart AI; MacBook is lead but others may eventually contribute).
- Confirm which Supabase ref is being operated against.

**Not in scope:** Claude.ai sessions (web-based) work for *reviewing* the plan and *challenging* it (Section 21.4 — multi-session challenge protocol), but *building* is done in Claude Code with MCP tools. Web sessions do not have the tool surface to commit code.

### 17.10 Monitoring and error tracking

- **Sentry** — error tracking (client-side, server-side, edge). Same pattern as v1 (R060 mentions it). Separate Sentry project for Smart AI; separate DSN.
- **Inngest dashboard** — workflow run history, failures, alerts.
- **Supabase dashboard** — DB queries, performance, connection usage.
- **Vercel dashboard** — deployment status, analytics, function invocations, cold start metrics.
- **Custom observability sysdocs and dashboards** — see Section 18.

### 17.11 Infrastructure rationale and devil's-advocate flags

**[R101-FLAG on Supabase as single data vendor.]** All data is in Supabase. A Supabase outage affects the entire system. Pro tier SLA is 99.9% (about 8.7 hours downtime/year).

The resolution:
1. Accept this. Multi-vendor data is complex, and at Antonio's scale the operational overhead isn't justified.
2. Backups: Supabase provides point-in-time recovery (PITR) on Pro+ plans. Test restore procedure documented; practiced quarterly.
3. Read replica for analytics (Stage 2+) reduces load on primary.

**[R101-FLAG on Vercel 60s timeout still biting somewhere.]** Most long work goes to Inngest, but some paths (document upload with inline virus scan, large file processing, synchronous OAuth flows) might hit the limit.

The resolution: explicit time budget per path. If any path approaches 30s in testing, it's refactored to the Inngest pattern (emit event, return immediately, let Inngest complete the work async, poll or WebSocket the client for status).

**[R101-FLAG on multi-provider billing coordination.]** Vercel, Supabase, Inngest, Anthropic, OpenAI, Sentry — five billing relationships. Cost tracking across them is manual.

The resolution: a single "Smart AI cost dashboard" sysdoc (and eventually a CRM page) aggregates monthly spend per provider. Antonio reviews monthly. Individual bills stay with each provider; the dashboard is summary.

**[R101-FLAG on the MCP server being stood up before Stage 0 S0.2 schema.]** The MCP server points at the Smart AI Supabase, but the Smart AI tables don't exist yet at the start of Stage 0. The MCP's tool schemas assume certain tables.

The resolution: MCP tools are parameterized by schema introspection at start-up. If a table doesn't exist, the relevant tool returns a clear "not yet available" error rather than crashing. The MCP works progressively as tables come online during Stage 0.

---

## 18. Observability

Observability is not optional. It is built into Stage 0 before the first `emit()` call, because the system cannot be operated safely without it. Without observability, silent failures become invisible failures become business incidents.

### 18.1 SLOs — REVISED v1.1 (v1 baselines measured in Stage 0 S0.0.5)

**v1 baseline measurement (Stage 0 S0.0.5).** The SLOs below are informed by v1 production performance. Stage 0 S0.0.5 measures v1's actual p95 for each surface over 2 weeks of production traffic. Smart AI SLOs = v1_baseline ± 10%, with vendor-p95 slack added for Vercel/Supabase/Inngest cold-start scenarios. If v1 currently delivers portal page load at p95 = 2.2s, Smart AI's target is ≤ 2.0s (10% improvement) not some aspirational 1.5s. Aspirational targets that don't ground in baseline create false pass gates.

Service-level objectives for first cutover:

| Surface | SLO | Measurement | Baseline source |
|---|---|---|---|
| Portal page load (p95) | ≤ v1_baseline - 10% | Vercel analytics + custom timing | Stage 0 S0.0.5 measurement |
| CRM client-360 load (p95) | ≤ v1_baseline - 10% | same | same |
| Solver `solve()` call (p95) | < 500ms with cache hit, < 2s cache miss | custom timing in solve() | New metric (v2 only) |
| `emit()` call (p95) | < 100ms | custom | New metric (v2 only) |
| Outbox drain lag (p95) | < 10 seconds from `emit()` to `published` | drain worker telemetry | New metric (v2 only) |
| Agent invocation (p95) | < 3 seconds | `ai.decision.duration_ms` | New metric (v2 only) |
| Webhook signature verification | < 50ms | webhook endpoint timing | Same as v1 target |
| Availability (per endpoint class) | 99.5% first 90 days, 99.8% after stabilization | Sentry + Vercel + synthetic checks | v1 actual ≈ 99.7% |

SLO dashboards surface these weekly. Breaches are investigated per-incident with root-cause analysis added to the scar index.

### 18.2 Metrics taxonomy

Four metric families:

**Business metrics** (feed the Intelligence-First Dashboard in CRM):
- Engagement count by status.
- Requirement-satisfaction distribution per spec.
- Time-to-satisfy per requirement type (median, p95).
- Exception rate per requirement.
- Agent approval rate per proposal type.
- Cost per engagement (compute + agent + infrastructure).

**Operational metrics** (feed admin dashboards):
- `emit()` rate (events/sec, events/minute).
- Outbox depth (pending count).
- Drain worker latency.
- Inngest function run counts per function.
- Inngest failure rate per function.
- Realtime connection count.

**AI metrics** (feed calibration + cost dashboards):
- Agent invocations per task type.
- Tokens in / out per model per task type.
- Cache hit rate.
- Batch API usage.
- Calibration curves (reported confidence vs actual accuracy, per task type and model).
- Hallucination flag rate (structured output validation failures).

**Infrastructure metrics**:
- Vercel function invocation counts + durations.
- Supabase connection pool utilization.
- Postgres slow query log.
- pgvector query latency.

### 18.3 Shadow mode

Shadow mode is the mechanism by which we validate v2 against v1's production traffic without any client-facing effect.

**Setup (Stage 0 S0.7):**
- A read-only tap on v1 production webhooks (Stripe, Whop, etc.) tees the webhook payload into Smart AI's event log as `subject_type='v1_shadow'`.
- Smart AI's solver runs on the shadow events — computes what its requirements would show — and logs the output to `shadow_diffs`.
- v1's actual current state for the same subject is queried (via the shared `knowledge_articles` access to v1 Supabase, or a scheduled poll).
- Diff recorded: Smart AI's status vs v1's status per requirement.

**Shadow metrics:**
- Diff rate per spec (how often v2 differs from v1's current state).
- Diff category breakdown (spec bug, import bug, v1 data issue, expected difference).
- Evolution over time — as we fix diff causes, the rate should trend down.

**Shadow mode dashboards** surface diffs per account for investigation. This is how we grind out confidence before cutover. Stage 0 S0.8 (30-client verification panel) is the explicit exit gate for shadow-mode diff.

### 18.4 Alerting

Alerts fire on specific conditions with structured escalation:

**Critical (page immediately):**
- Any endpoint returning 500s at > 1% rate for > 5 minutes.
- Outbox depth > 1,000 for > 5 minutes.
- Calibration curve regression > 20% (model quality collapsed).
- Webhook signature failures > 10 in 10 minutes (possible attack).
- `EXPECTED_SUPABASE_REF` mismatch (boot failure).
- Cost projection exceeds monthly cap.

**Warning (email daily digest):**
- p95 slower than SLO for any surface for 24 hours.
- Agent proposal rejection rate > 30% for any task type (calibration drift).
- Scar index pattern match fires on > 5 proposals in 24 hours (possible systemic issue).
- Sentry error rate spike.

**Info (weekly digest):**
- Cost week-over-week change > 10%.
- New exception pattern detected.
- Calibration adjustment made.
- Feature usage summary.

Alerts route to Antonio's email / Slack. Non-critical alerts batch into daily / weekly digests to avoid alert fatigue.

### 18.5 Audit trail

Separate from metrics but critical: every action is auditable.

- **Event log** — every state change.
- **`action_log`** (new table, separate from events) — API-level audit: which admin made which call at what time, with what payload.
- **`agent.invoked` events** — every agent call.
- **Sentry breadcrumbs** — error context.

Audit retention: 7 years minimum (matches US financial-records retention).

### 18.6 Observability rationale and devil's-advocate flags — REVISED v1.1 (🟠 Fix F: multi-vendor degraded mode)

**[R101-FLAG on multi-vendor simultaneous degradation (🟠 Fix F).]** Supabase, Inngest, and Anthropic are all critical vendors. If two or more degrade simultaneously — not full outage, just slow (p95 × 3) — the system is in an unpredictable compound failure state. No individual vendor's dashboard shows the problem; only compound monitoring detects it.

The resolution: **designed degraded mode** with a circuit-breaker trigger.

**Degraded mode trigger criteria (vendor health check runs every 30 seconds):**
- Supabase: DB query p95 > 3× trailing 10-minute average, sustained 2 minutes.
- Inngest: event dispatch latency p95 > 5× trailing 10-minute average, or function failure rate > 20%, sustained 2 minutes.
- Anthropic: API p95 > 5× trailing average, or error rate > 10%, sustained 2 minutes.

**Trigger:** any 2 of the 3 vendors simultaneously in degraded state → system enters degraded mode.

**Degraded mode behavior:**
- **Portal:** serves cached read-only views. Portal chat disabled (requires DB write). Upload disabled. Badge shown: "System is in maintenance mode. Your data is safe. Actions will resume shortly."
- **Admin CRM:** read-only. New events are queued to a fallback buffer (Redis-backed or Supabase RPC with retry). AI proposals suspended. Badge shown: "Degraded mode active — [vendors]. Admin reads available; writes queued."
- **Webhooks:** continue accepting (signature verified, acknowledged 200). Events are queued; drain deferred until recovery.
- **Agent invocations:** non-critical (nightly analyses, pattern detection) suspended. Critical (response to admin action, portal chat reply) attempted with explicit timeout + fallback message.

**Recovery criteria:** all degraded vendors return to ≤ 1.5× trailing average for ≥ 1 minute → exit degraded mode, drain queued events, resume normal operation.

**Recovery alerting:** page on degraded mode entry, page on recovery. Daily digest if degraded mode recurred > 2 times in 24h.

**[R101-FLAG on observability cost.]** Telemetry infrastructure (Sentry, custom metrics, dashboards) has a cost. Some dashboards may not be used after initial build.

The resolution: minimum viable observability first (Sentry + the weekly dashboard of key metrics). Build additional dashboards reactively — when a question is asked and the answer isn't easy, that's a dashboard candidate. Don't build 30 dashboards speculatively.

**[R101-FLAG on SLO calibration early on.]** The SLOs above are targets for cutover. During Stage 0 and shadow mode, we don't have production traffic; SLO compliance is hypothetical.

The resolution: Stage 0 uses synthetic load tests (scripted requests with a fixed pattern) to validate SLOs. Shadow mode uses real v1 traffic shape (v1 baseline measurement in Stage 0 S0.0.5). Both approaches give early signal without risk. Post-cutover, real traffic sets real SLOs and we adjust targets if the first-draft numbers were wrong.

**[R101-FLAG on alert fatigue.]** Too many alerts and nobody reads them. Not enough alerts and incidents are invisible.

The resolution: the three tiers above (critical / warning / info) plus a strict rule — Critical alerts are pageable; Warning and Info are never paged. Every Critical alert that fires and is dismissed without action triggers a review: was this a false positive? If yes, tune the threshold. This keeps the Critical channel trusted.

---

## 19. Build Stages

The full build is divided into stages, each with a clear entry condition, exit criteria, and deliverable. Stage 0 is detailed; Stages 1-7 are outlined; the plan will expand a stage only when the prior exits.

### 19.1 Stage 0 — Foundation

**Goal:** build the infrastructure, schema, and learning substrate every later stage depends on.

**Duration:** 3-4 weeks (2026-04-21 → ~2026-05-19).

**Worklist** (see `sysdoc_read('smart-ai-td-ops-stage-0-worklist')` for the live-maintained version):

- **S0.0 — Repo + environment isolation.** Create GitHub repo, clone to MacBook, bootstrap CLAUDE.md + directory skeleton, configure new MCP server. (Partially complete; MCP server blocked on S0.1 Supabase ref.)
- **S0.1 — Confirm infrastructure.** Verify Supabase ref, create Vercel project, create Inngest account, set env vars, provision staging domain, commit isolation middleware.
- **S0.2 — Core schema.** Apply all Stage 0 tables (entity graph, event log, outbox, sensitive_data, service_specs, rule_overrides, exceptions, proposals, ai_decisions, v1_scars, shadow_diffs) plus RLS policies to Smart AI Supabase.
- **S0.3 — emit() + outbox mechanism.** Ship `emit(event)` Postgres function + TypeScript wrapper, outbox drain worker (Inngest scheduled + Realtime-triggered), first event types implemented, unit tests (atomicity, idempotency, drain backlog handling).
- **S0.4 — First spec: SMLLC Formation.** Author in TypeScript, strict schema, seeded to `service_specs`, unit tests using fixture event lists.
- **S0.5 — Solver skeleton.** Pure function, deterministic, no DB writes, cache layer, unit tests with v1-anonymized fixtures.
- **S0.6 — Event inspector admin page.** `/admin/events` with browse/search/filter/chain-tree, not client-visible.
- **S0.7 — Shadow-mode infrastructure.** Read-only tap on v1 webhooks, shadow solver runs, shadow_diffs table + dashboard.
- **S0.8 — Verification milestone: import + diff (exit gate).** All 30 panel clients imported from v1 (see Appendix B). Solver run against all. Diffs triaged by root cause. Zero-or-explained diff across unique root causes.
- **S0.9 — v1 Scar Index population (exit gate companion).** ≥50 scars extracted from CLAUDE.md R005-R101 + v1 bugfix dev_tasks + planning docs. Each with category, root cause, Smart AI prevention, verification path. Embeddings generated. Agent retrieval wired (for Stage 1).

**Exit criteria:**
- Full 30-client panel imported, solver diff clean or documented.
- ≥50 scars in `v1_scars` with preventions.
- All Stage 0 tasks complete or explicitly deferred with rationale.
- Architecture sysdoc re-read and reaffirmed by Antonio.

**What Stage 0 does NOT produce:**
- No Ops Agent (Stage 1).
- No portal or CRM beyond admin event inspector.
- No spec beyond SMLLC Formation.
- No payment integration.
- No cutover.

### 19.2 Stage 1 — First Complete Flow: MMLLC Formation

**Goal:** prove the entire architecture on a real service end-to-end, with MMLLC Formation as the pilot (picked for variety — per-member requirements surface more edge cases than SMLLC).

**Duration:** 3-4 weeks (~2026-05-19 → ~2026-06-16).

**Deliverables:**
- **MMLLC Formation spec** authored in TypeScript, seeded to `service_specs`.
- **Solver handles all formation requirements** including per-member documents, signer designation, cross-state variations.
- **Portal v2 pages for formation:** adaptive dashboard driven by solver, dynamic members step in wizard, per-member document upload, unified timeline.
- **CRM v2 client 360:** solver-driven checklist, member management UI, exception handling UI, AI Context Panel.
- **Ops Agent v1 launch:** single agent, core tools, context bundle, scar retrieval, proposal inbox. Initial supported task types: `evaluate_requirement`, `generate_proposal` (reminder emails), `draft_communication`.
- **Inngest workflows:** formation pipeline (payment → member documents → state filing → EIN → OA).
- **Payment integration:** Stripe webhooks → `payment.confirmed` events. Invoice generation with version-pinned pricing.
- **Verification:** run 5 real MMLLC formations through v2 in shadow mode for 2 weeks. Compare with v1 production outcomes.

**Exit criteria:**
- End-to-end MMLLC formation runs without admin intervention on happy path.
- Exception handling demonstrated for at least 3 real edge cases.
- Agent proposals generated at least 10, reviewed by Antonio, approval rate recorded.
- Shadow diff vs v1 for 5 test formations is clean.

### 19.3 Stage 2 — Expand Service Types

**Goal:** add specs for remaining in-cutover-scope service types, validating each in shadow mode before cutover.

**Duration:** 4-6 weeks (~2026-06-16 → ~2026-07-28).

**Deliverables** (in order; each validated before moving to next):
- SMLLC Formation (adapted from Stage 1 generalizations; simpler variant).
- Client Onboarding (wizard auto-generates account, OA + Lease templates).
- Tax Return intake + routing (not full India filing handoff — intake only).
- Payment handling hardened: Whop webhook, wire transfer (manual entry), currency conversion, refunds, disputes.
- Ops Agent task types added: `evaluate_requirement` for tax-evaluable rules, complex classification for inbound documents.
- CRM proposal inbox batch operations.
- Spec editor Values tab production-ready (not just MVP).

**Exit criteria:**
- Each service type passes shadow-mode validation on ≥3 real engagement imports.
- Agent approval rates by task type meet or exceed initial targets (80%+ for reminders, 90%+ for classifications).
- No P0/P1 incidents in 2 weeks of shadow operation.

### 19.4 Stage 3 — Payment Unification + Invoice Hardening

**Goal:** one payment event flow, one handler, all methods. Invoice generation hardened for production.

**Duration:** 2-3 weeks (~2026-07-28 → ~2026-08-18).

**Deliverables:**
- Unified `MoneyMovement` entity (payment + refund + dispute treated uniformly).
- All payment sources → `payment.confirmed` / `payment.failed` / `payment.refunded` / `payment.disputed` events.
- Installment schedule driven entirely by rules, not hardcoded in handlers.
- Invoice-number generator with R098 semantics preserved (DB unique + retry on conflict).
- QB integration: manual-only push button in CRM (R097 preserved). No automatic QB sync anywhere.
- Invoice PDFs generated from templates (first version; basic layout).

**Exit criteria:**
- 20 payment events (across methods) flow correctly through v2 in shadow mode.
- QB sync tested on 5 sandbox invoices.
- No PII in payment event payloads (tokens only).

### 19.5 Stage 4 — AI Layer Expansion + Auto-Approval

**Goal:** move from "agent proposes, human reviews all" to "agent proposes, human reviews where it matters, internal-only actions auto-execute."

**Duration:** 3 weeks (~2026-08-18 → ~2026-09-08).

**Deliverables:**
- Blast-radius-gated auto-execution for internal_only proposals.
- Calibration loop in production (Bayesian sequential, threshold adjustments within hours of drift detection).
- Proposal approval thresholds tuned per task type per model.
- Scar-match-as-veto: any proposal matching a scar with unsatisfied prevention requires human review.
- Communication drafting Phase 2: drafts scored for tone/accuracy, admin can edit inline before send.
- Multi-model tiering fully enabled (Haiku/Sonnet/Opus dispatch).

**Exit criteria:**
- Auto-execution rate for internal_only proposals: 30-50% (conservative start).
- Client-facing proposals: 100% human-reviewed. No exception.
- Calibration dashboards show convergence (actual accuracy ≈ reported confidence within ±5%).

### 19.6 Stage 5 — Unified Communications + Inbox

**Goal:** one timeline per client, all channels. Unified inbox in CRM.

**Duration:** 2-3 weeks (~2026-09-08 → ~2026-09-29).

**Deliverables:**
- Communication entity unifying email (inbound + outbound), portal chat, notifications.
- AI-powered message classification on inbound email (routing to engagements).
- Unified inbox in CRM: priority-ordered, filtered, searchable.
- Portal chat integrated with event log (R100 preserved — soft-delete on chat messages).
- Ops Agent task type: Portal-Support (draft responses to client chat; Antonio/Luca approve).

**Exit criteria:**
- Inbound email classification accuracy ≥ 90%.
- Portal chat response time (admin-approved) ≤ 2 hours during business hours.
- Unified timeline renders cleanly across 10 complex (multi-engagement) accounts.

### 19.7 Stage 6 — Rules Editor + Exception Patterns + Spec Editor Structure Tab

**Goal:** close the loop. The system learns from how it's used; Antonio edits what he needs without developer involvement.

**Duration:** 2 weeks (~2026-09-29 → ~2026-10-13).

**Deliverables:**
- Spec Editor Values tab: production-ready with preview dry-run.
- Spec Editor Structure tab: read-only view + "propose structural change" → dev_task.
- Pricing rules editor with version pinning honored.
- Exception pattern detection + banner in Spec Editor.
- Rule change events surfacing in audit timeline.
- Documentation for Antonio on how to edit rules (sysdoc).

**Exit criteria:**
- Antonio edits at least 3 rule values during this stage to validate the flow.
- No unintended production changes from the edits.
- Exception pattern detection fires at least once (natural or simulated).

### 19.8 Stage 7 — Production Cutover Preparation and Go-Live

**Goal:** move from sandbox to production. First new client lands on v2.

**Duration:** 1 week ramp + go-live (~2026-10-13 → 2026-10-21).

**Deliverables:**
- Final shadow-mode run on all 30 panel clients for 1 week, zero diff required.
- Cutover runbook: exact sequence of DNS changes, webhook re-registration, environment variable updates.
- Rollback plan: if issues surface within 72 hours post-cutover, how to route new client to v1 temporarily while we fix v2.
- Communication plan: new clients onboarding after cutover get v2; existing clients stay on v1; no client confusion.
- Post-cutover monitoring: hourly check for first 72 hours, then daily for 30 days.

**Exit criteria:**
- 2026-10-21: first new client's payment → engagement → portal → wizard → formation completes on v2 with no admin intervention on happy path.
- Monitoring dashboards green for 72 hours post-cutover.
- Scar index expanded with any post-cutover lessons.

### 19.9 Post-cutover (Stages 8+): feature-by-feature migration

Detailed separately — see Section 20.

---

## 20. Migration Strategy

Migration is where greenfield rewrites die. This section is intentionally explicit. No cutover is a "flip the switch" event; it's a staged process with rollback capability at every step.

### 20.1 Pre-cutover: shadow mode (Stages 0-7)

Shadow mode runs throughout Stages 0-7. Key pieces:

- **Read-only tap on v1 production webhooks.** Stripe, Whop, Inngest (once added on v1 side, which won't happen — v1 stays as is), and any other inbound webhook sources are configured with a secondary URL: Smart AI's shadow endpoint. Smart AI validates signatures, receives payloads, tees into the shadow event log with `subject_type='v1_shadow'`.
- **Imported v1 engagements.** For the 30 panel clients (Appendix B), we import their current v1 state into Smart AI: contacts, accounts, members, documents, payments, service deliveries. We synthesize events (since v1 didn't record them event-first) by reading current state and producing a reasonable historical event chain.
- **Solver runs.** For each imported engagement, the Smart AI solver runs and produces a `StatusReport`. Cached + served to `shadow_diffs`.
- **Periodic diff.** A scheduled job reads v1's current state for the same engagement (via read-only replica or polling) and diffs against Smart AI's solver output. Diff rows go to `shadow_diffs`.
- **Dashboard.** Displays diff counts per spec, per root cause. Trends over time. The target is diff count → 0 or fully documented.

Shadow mode validates v2 without any production effect. If v2 says "requirement missing" and v1 says "satisfied," we investigate (spec bug? import bug? data-quality issue?). We fix. We re-import. We re-diff. We iterate until confident.

### 20.2 Pilot clients (Stage 6-7) — REVISED v1.1 (live pilot cohort routing infrastructure)

Before opening v2 to "all new clients," a pilot runs with 2-5 real new clients hand-picked by Antonio:

- These clients onboard on v2 from day one.
- Antonio monitors their progression personally, with higher attention than normal.
- Any v2 issue surfaced from a pilot client → dev_task + fix + scar.
- Pilot runs 2 weeks minimum. If zero P0/P1 issues, broader cutover proceeds. If issues, delay.

**Per-client routing infrastructure.** During the pilot period, specific new clients are routed to v2 while all other new clients still route to v1. This requires routing to be deterministic and explicit — not "if date > X use v2" (which would route all clients at once) but "if contact.id IN pilot_list use v2."

**REVISED v1.3 (🟠 Fix 7/Round 4): cross-database FK is impossible; email hash is the routing key.**

v1.2 defined `client_routing.contact_id UUID REFERENCES contacts(id)`. This FK cannot exist: v1 and v2 are separate Supabase projects (separate Postgres instances). Postgres FKs do not span database instances. A v2 table cannot have a FK referencing v1's `contacts`, and a v1 table cannot reference v2's `contacts`. Any single-project placement leaves the other system without FK integrity or requires an expensive cross-project HTTP lookup on every offer.

Fix: use email hash as the routing key. Email is known at lead-capture time (before a `contacts` row may exist in either system). No FK required — the routing table is a standalone lookup, not a reference to either contact table.

```sql
-- Lives in v2 Supabase (Smart AI).
-- v1 reads via HTTP call to GET /api/routing/check?email_hash=<sha256>
-- No FK on either side — cross-database referential integrity is impossible by construction.
CREATE TABLE client_routing (
  email_hash    TEXT PRIMARY KEY,   -- SHA-256(lower(trim(email))); stable across both systems
  system        TEXT NOT NULL CHECK (system IN ('v1', 'v2')),
  reason        TEXT NOT NULL,      -- 'pilot_cohort', 'new_client_post_cutover', 'migrated_feature:itin'
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by   UUID REFERENCES auth.users(id)
);
```

The offer flow's first action on a new lead: compute `sha256(lower(trim(lead.email)))` → look up `client_routing`. If a row exists → route accordingly. If no row → default to v1 pre-cutover, v2 post-cutover. Antonio inserts pilot routing rows via the v2 CRM without a deploy.

**v1 reads the routing table** via a lightweight HTTP call to the v2 routing endpoint (`GET /api/routing/check?email_hash=X`, protected by a shared secret). The v1 system does not query v2's Postgres directly. This is the only cross-system dependency during the pilot period.

This infrastructure is the same mechanism used post-cutover for feature-by-feature migration of existing v1 clients: when a client's ITIN service migrates to v2, a row is inserted with `system='v2'` routing their ITIN-related offers to v2 while their formation/renewal stays on v1.

### 20.3 Cutover day protocol (2026-10-21) — REVISED v1.1 (🔴 Fix C: knowledge_articles + sop_runbooks migration)

On cutover day, the sequence:

**T-72h (knowledge migration prep):**
- Export `knowledge_articles` and `sop_runbooks` from v1 Supabase to v2 Supabase (full copy, not shadow-mode read-through).
- Start one-way sync: a cron job runs every 15 minutes, comparing v1 table checksums vs v2. Any rows updated or inserted in v1 after the export are replicated to v2. **Direction is v1 → v2 only.** If v2 has edits to the same row, v2 wins (v2 is the live system). Log any conflict.
- Validate: run `kb_search` and `sop_search` against v2 — confirm same results as v1 for top 10 queries.
- D9 update: the "shared knowledge_articles and sop_runbooks (read from v1)" contract transitions to "v2 owns its own copy; sync during hybrid period."

**T-24h:**
- Final shadow diff review across all 30 panel clients. Zero material diffs required.
- Verify all env vars in Vercel `td-operations-v2`.
- Verify domain `v2.tonydurante.us` resolves correctly.
- Verify `kb_search` + `sop_search` returning v2-owned data (not proxying v1).
- Inngest dashboard green.
- Anthropic/OpenAI quotas confirmed.
- Announce to team (Antonio + Luca) that cutover is T-24h.

**T-0 (morning):**
- Deploy `td-operations-v2` to production Vercel.
- Register Smart AI webhook URLs with Stripe, Whop, etc. (in addition to v1 URLs — both systems receive webhooks during the hybrid period).
- New-client-facing offer flows updated to point to v2 URL (this is the switch — existing flows continue to point to v1 for existing clients).
- Monitoring dashboards open. Team watching.

**T+1h:** first expected new-client traffic on v2. Validate the full happy path (offer signed → payment → engagement → portal login → wizard start) via a test account.

**T+24h:** if green, announce to team that cutover is stable. Daily reviews for 30 days. Shadow mode continues.

**Post-cutover knowledge sync:** the one-way sync (v1 → v2) continues until all knowledge edits move to v2. Target: 30 days post-cutover, v2 is the editing surface for `knowledge_articles` and `sop_runbooks`; sync is disabled; v1's copies are frozen. This removes the last operational dependency on v1 Supabase, making v1 archivable.

### 20.4 Rollback plan

If issues surface post-cutover:

**Minor (cosmetic, single-feature bugs):**
- Fix forward on v2. No rollback. Affected client contacted directly if client-visible.

**Moderate (blocks new-client onboarding):**
- Temporarily route new-client flow back to v1 while v2 is fixed.
- Existing clients unaffected (always on v1).
- Affected new clients: inform Antonio; manual onboarding if necessary.

**Severe (data loss, PII leak, or similar):**
- Immediate incident response.
- Point DNS back to v1 for all v2 traffic.
- Investigate root cause.
- Scar index populated with incident.
- Post-mortem published before re-cutting-over.

### 20.5 Post-cutover: feature-by-feature migration (Stages 8+)

After cutover, existing 253 v1 clients stay on v1. Each additional feature moves from v1 to v2 on a schedule:

**Order (first 3 months post-cutover):**
1. **ITIN applications** (Stage 8). Next most common service after formation.
2. **Operating Agreement full generation** (Stage 9). Currently template-level only.
3. **Lease generation** (Stage 10).
4. **CMRA, Banking wizard flows** (Stage 11).
5. **Annual renewal logic** (Stage 12). Most complex — installment-driven, recurring.

Each feature migration:
- Smart AI extends its spec, wires Inngest workflows, adds agent capabilities.
- Shadow mode runs for the feature on v1 engagements that would use it.
- Antonio pilot-migrates 2-5 existing v1 clients for that feature onto v2.
- If clean, remaining v1 clients for that feature are migrated on a rolling schedule.
- v1 code for that feature is deprecated when no clients remain on v1 version.

**Target:** full v1 → v2 migration complete 6-9 months post-cutover. v1 becomes read-only archive. v2 is the sole live system.

### 20.6 Migration rationale and devil's-advocate flags

**[R101-FLAG on parallel-system maintenance.]** Running v1 and v2 simultaneously doubles the operational surface. v1 bug fixes, webhook signature rotations, client support — all happen in both systems.

The resolution:
1. **Forcing function: 2026-10-21 cutover caps v1 feature development.** After that date, v1 receives only maintenance (security patches, critical bug fixes) — no new features. All new work goes to v2.
2. **v1 code freeze per feature once v2 ships that feature.** E.g., once Stage 8 ships ITIN in v2 and all v1 ITIN clients have migrated, v1 ITIN code is archived (moved to `deprecated/` directory, not deleted until 6 months later for reference).
3. **Cost tracking per system.** v1 infrastructure cost is visible; dropping after full migration is the signal that v1 can be decommissioned.

**[R101-FLAG on client confusion during hybrid period.]** Existing clients on v1 see the v1 portal (`portal.tonydurante.us`). New clients on v2 see the v2 portal (`v2.tonydurante.us` or whatever the production URL becomes). Two portals during the hybrid period.

The resolution:
1. Existing v1 clients continue to see the v1 portal they already know. No change for them.
2. New v2 clients only know the v2 portal from day one. No exposure to v1.
3. When an existing v1 client is migrated feature-by-feature, their portal stays on v1 until their engagement moves; at that point, their magic link + new credentials route to v2. Transition is explicit and communicated.

**[R101-FLAG on synthesized v1 event history accuracy.]** When we import v1 engagements into v2, we synthesize events for past activity (since v1 didn't log events). The synthesis is best-effort; the event chain is not historically accurate.

The resolution: synthesized events are flagged in the payload (`source: 'migration_synthesis'`). The solver treats them as evidence but the agent's context bundle notes which events are synthetic vs live. This preserves the distinction for forensic purposes and avoids misattributing responsibility.

**[R101-FLAG on webhook re-registration errors.]** Registering a new webhook URL with Stripe/Whop is an API call. If the API returns an error and we don't notice, webhooks stop flowing.

The resolution:
1. Webhook re-registration is scripted (`scripts/webhook-register.ts`) with explicit success verification.
2. Post-registration, we send a synthetic test event (via the provider's "send test webhook" feature) and verify it arrives at Smart AI and produces the expected event.
3. Before DNS flip, both URLs receive production webhooks (belt and suspenders — if one fails, the other catches).

---

## 21. Governance and Session Discipline

How the build is operated matters as much as what is built. This section specifies the protocols.

### 21.1 The forcing function

**2026-10-21. First new client on Smart AI TD Operations.**

This date is referenced:
- In `sysdoc_read('smart-ai-td-ops-architecture')` D7.
- In the build dev_task `2bc839aa-2e8e-4841-85ff-8a3f304a68c5`.
- In every Stage's exit criteria.
- In every session's start protocol.

Slipping past 2026-10-21 requires explicit Antonio decision — not silent drift. "We'll see where we are" is not acceptable; if a stage runs long, we explicitly discuss: extend or cut scope.

### 21.2 R101 — Devil's Advocate Mandatory

Section-by-section, this plan flags R101 concerns. In operation, R101 means:

Before any plan, proposal, decision, or recommendation reaches Antonio, the producer (me, in-session) internally answers:
1. What am I assuming?
2. What did I consider and reject?
3. How is my chosen approach weak?
4. What's verified versus accepted?
5. Am I picking this because it's easier to write, or because it's actually better?

If any answer is missing or weak, the output is not ready.

**Enforcement:**
- Currently: self-discipline. Not reliable alone.
- Coming: `plan_challenge` MCP tool (dev_task `24cfad54`). Required before significant proposals. Hard-block vs soft-warn decision pending.

**This plan itself was produced under R101.** Section-level R101-FLAGs call out known weaknesses — designed to be attacked by external reviewers (Section 21.4).

### 21.3 Session discipline

**Per-session protocol:**
1. Read `sysdoc_read('smart-ai-td-ops-architecture')`.
2. Read `sysdoc_read('smart-ai-td-ops-stage-0-worklist')` (or current stage worklist).
3. `git pull origin main` in the local repo.
4. Query current dev_task progress.
5. Work.
6. Commit incrementally (after each significant change).
7. Save `session_checkpoint` after each significant change.
8. At session end, update progress log on the relevant sysdoc.

**Multi-machine coordination:**
- **MacBook is the lead machine for Smart AI.** iMac and Mac Mini continue v1 support during Stage 0-4. Once v2 architecture stabilizes (Stage 4+), other machines can contribute to v2 work.
- Cross-machine rules (R070, R071, R076) carry forward: pull before work, never `git add -A`, never `git push --force`.

**Session length and compaction:**
- Claude Code sessions compact context when long. The architecture sysdoc + stage worklist survive compaction because they're in the DB, read at session start.
- Session checkpoints save work-in-progress state so a fresh session can resume.
- Critical decisions are committed to sysdocs immediately, not just in-conversation.

### 21.4 Multi-session challenge protocol

This plan is designed to be challenged by multiple fresh Claude sessions before Stage 0 S0.2 schema work begins. Protocol (proposed; awaiting Antonio sign-off to execute):

**Round 1:**
1. Antonio opens 2-3 fresh Claude sessions (Claude.ai web, or new Claude Code projects pointed at this repo).
2. Each session receives: (a) this plan, (b) a structured challenge template.
3. Structured challenge template asks, for each section N:
   - Strongest argument AGAINST this section's approach.
   - What assumption is most likely wrong.
   - What failure mode this section doesn't address.
   - Alternative approach + why.
   - Verification: what 2-3 fresh tool calls would test this section's claims.
4. Each session produces a challenge report.

**Synthesis:**
1. I (this session or a successor) read the 2-3 challenge reports.
2. For each raised issue, produce a disposition: accepted (how to revise) / rejected (why) / escalate (needs Antonio decision).
3. Write disposition to a sysdoc.
4. Antonio signs off on the disposition.

**Round 2 (optional):**
If Round 1 surfaces major issues requiring substantial plan revision, Round 2 happens on the revised plan. Hard cap: 2 rounds. If Round 2 still finds material issues, ship the current plan with issues noted as deferred to Stage 1+.

**Stop condition:** Round produces zero new material issues, OR Antonio declares the plan "good enough."

### 21.5 Scope change management

Scope changes during the build are expected. The protocol:

- **Minor changes** (adding a field to a spec, a new event type, a UI tweak): in-session, commit to the plan and dev_task.
- **Moderate changes** (new stage work, reordering, adding a service type): explicit Antonio decision; architecture sysdoc updated with a dated entry.
- **Major changes** (changing a D1-D9 locked decision): requires a mini-plan-review — "what we locked, what changed, what it means." Updated in D9 with `SUPERSEDED (date)` notation, original decision preserved.

**Scope creep watchdog:** every stage's dev_task has a "locked scope" section. If mid-stage a new requirement is identified, it's either accepted (timeline extends) or deferred (next stage). Not silently absorbed.

### 21.6 Governance rationale and devil's-advocate flags

**[R101-FLAG on session compaction gaps.]** Claude Code sessions compact. If compaction happens mid-stage and the successor session has outdated context, decisions can drift.

The resolution: the architecture sysdoc is the persistent context. Every architectural decision lives there with a date and rationale. Compacted sessions re-read it at start and are bound by it. In-conversation decisions not yet in the sysdoc are at risk of loss — this is why the rule is "commit architectural decisions to sysdocs immediately."

**[R101-FLAG on challenge round fatigue.]** Running 2 rounds of external challenge per major plan is real work — Antonio opens sessions, collects output, synthesizes. If every architectural change requires this, build cadence suffers.

The resolution: multi-session challenge is for the foundational plan (this document) before Stage 0 begins. Per-stage changes don't require it; they're smaller scope and covered by per-session R101 discipline. The multi-session round is a capital investment in plan quality, not a continuous tax.

**[R101-FLAG on MacBook-as-single-lead machine.]** If MacBook is unavailable (laptop broken, Antonio traveling), Smart AI work halts.

The resolution: once Stage 0-1 patterns stabilize, a second machine (iMac or Mac Mini) can be a secondary lead. The architecture sysdoc + worklist + dev_task progress survives across machines because they're in Supabase. Git discipline (pull before work, explicit file adds) prevents desync.

---

## 22. Cost Model

Every major cost driver, sized honestly at three scale points. This is not a forecast; it's a budget sizing exercise with explicit assumptions.

### 22.1 Cost drivers

1. **Claude API** — the big one. Scales with agent activity.
2. **Inngest** — scales with workflow executions.
3. **Supabase** — Pro tier flat plus storage overages.
4. **Vercel** — Pro tier plus function invocations.
5. **OpenAI (embeddings only)** — tiny, flat.
6. **Sentry** — tier-based; flat for our volume.
7. **Domain/DNS/certs** — negligible.

### 22.2 Cost at 225 clients (first cutover scale)

**Assumptions:**
- ~10 agent invocations per client per day on average (mix of high and low activity clients).
- Total agent invocations per month: 225 × 10 × 30 = ~67,500.
- Average tokens per invocation: 4,000 input + 1,000 output = 5,000 total.
- Model distribution: Haiku 70%, Sonnet 25%, Opus 5%.
- Prompt caching effective on ~60% of input tokens (system prompt + SOPs + scars).
- Batch API used for ~10% of invocations (nightly analyses).

**Claude API — detailed math:**

*Input tokens, no optimization:*
- 67,500 × 4,000 = 270M input tokens/month
- Haiku 70%: 189M × $1/1M = $189
- Sonnet 25%: 67.5M × $3/1M = $202.5
- Opus 5%: 13.5M × $5/1M = $67.5
- Subtotal input (no cache): **$459**

*Output tokens:*
- 67,500 × 1,000 = 67.5M output tokens/month
- Haiku 70%: 47.25M × $5/1M = $236.25
- Sonnet 25%: 16.875M × $15/1M = $253.13
- Opus 5%: 3.375M × $25/1M = $84.38
- Subtotal output: **$574**

*With prompt caching (60% of input cached, 90% discount on cached):*
- Cached input value: 60% of $459 = $275 becomes $27.50 (90% off).
- Uncached 40% stays at full price: $183.60.
- Total input with caching: **$211**

*With Batch API (10% of invocations at 50% off) — CORRECTED v1.3 (🟡 Fix 8/Round 4):*
- 10% of invocations run via Batch API. Their full-price cost: 10% × ($211 + $574) = $78.50.
- Batch API gives 50% off that subset: $78.50 × 50% = **$39.25 savings**.
- (v1.2 incorrectly subtracted $78.50 — the full cost — rather than 50% of it, overstating savings by ~$39/month.)

*Final Claude API estimate: $211 + $574 − $39 = **~$746/month** at 225 clients.*

**Other infrastructure:**
- Inngest Pro: **$75/month** (base tier, expected to suffice at this volume).
- Supabase Pro: **$25/month** (flat).
- Vercel Pro: **~$200/month** including usage (per-seat + function invocations).
- OpenAI embeddings: **~$10/month** (daily re-embeds of SOPs + scars, small corpus).
- Sentry: **~$50/month** (team tier for error tracking + performance).

**Total estimated cost at 225 clients: ~$1,106/month.** (v1.2 stated $1,067 — the $39 Batch API correction flows through.)

**Range with assumptions flex:** $900 (low end, fewer agent calls) to $1,400 (high end, more Opus usage).

### 22.3 Cost at 500 clients (growth scale)

Linear scaling for Claude API (agent work scales with client count):

- Claude API: 500/225 × $746 ≈ **$1,658/month**.
- Inngest: **$150-300/month** (scale into Pro tier overages).
- Supabase Pro: $25 (Pro tier holds through much larger volumes).
- Vercel Pro: **~$300/month** (more function invocations).
- OpenAI embeddings: **~$20/month**.
- Sentry: **~$80/month**.

**Total at 500 clients: ~$2,233/month.**

**Range:** $1,800 - $2,500.

### 22.4 Cost at 1,000 clients (target scale)

- Claude API: 1000/225 × $746 ≈ **$3,316/month**.
- Inngest: **$400-600/month** (enterprise pricing, negotiated).
- Supabase: may need to move beyond Pro to Team tier: **~$600/month**.
- Vercel: **~$500-800/month** (enterprise).
- OpenAI embeddings: **~$40/month**.
- Sentry: **~$150/month**.

**Total at 1,000 clients: ~$5,006-5,506/month.**

**Range:** $3,500 (aggressive optimization) - $6,000 (unoptimized peak).

### 22.5 Cost cap and alerts

**First cutover hard cap: $4,000/month.**

- Anchored to Antonio's current $4,000/month employee spend.
- Alert at 80% projection ($3,200/month trajectory).
- At 100% cap: non-critical agent invocations throttled (nightly analyses deferred; routine reminders queued if needed). Critical paths always execute.

**Raising the cap:** Antonio's decision when scale demands. Expected around 500 clients; certain at 1,000.

### 22.6 Cost vs quality trade-off

From Section 1.4: *"I am already spending $4,000 for an employee that can do a quarter of what my broken system does today."*

The principle: **do not cut quality to save cost.** If a client-visible action quality drops by 10% to save $500/month, the business loses more than $500 in reputation and retention.

Specific policies:
- **Do not downgrade models to save cost.** If Opus is the right tier for a task, use it. Haiku-ing a complex task and getting it wrong costs more than the Opus call.
- **Do not skip prompt caching — free optimization.**
- **Do not skip Batch API for batchable work — free 50%.**
- **Do not run agent on every event if debounced signal works — free compute.**
- **Do not run agent when solver output is cached and unchanged — free compute.**

These are "zero-harm optimizations" — get them all. The remaining cost at that point is the true cost of running the system at quality.

### 22.7 Cost tracking implementation

- Every `ai.decision` and `agent.invoked` event logs `cost_usd` in payload.
- Materialized view `monthly_cost_by_category` rolls up daily.
- Dashboard surface in CRM admin: cost this month, projection for end-of-month, month-over-month trend, spike investigation.
- Weekly email to Antonio: cost summary + outliers.

### 22.8 Cost rationale and devil's-advocate flags

**[R101-FLAG on optimistic cost modeling.]** My estimates above assume linear scaling with clients. In practice, complex clients (multi-service, long-lived, exception-heavy) consume more agent cycles than simple ones. The 1,000-client estimate could be low.

The resolution: treat estimates as directional, not precise. Monitor actual cost-per-client; adjust. The cost cap is the real constraint, not the estimate.

**[R101-FLAG on vendor cost changes.]** Anthropic, OpenAI, Inngest all have changed pricing before. A 30% price increase on Claude API would move the needle.

The resolution:
1. Monitor vendor announcements. Have a quarterly review of vendor costs.
2. Abstraction layer (`lib/agents/llm.ts`) makes provider swap feasible. OpenAI and other providers are viable backups.
3. Not locked into any one vendor's pricing forever.

**[R101-FLAG on cost visible in event payloads vs actual billing.]** Our `cost_usd` in events is calculated from Anthropic's published pricing and token counts. Anthropic's invoice may differ (taxes, volume discounts we haven't negotiated, billing rounding).

The resolution: reconcile monthly — Anthropic invoice vs. sum of logged costs. If divergence > 5%, investigate. The logged cost is for in-system attribution; the invoice is the authoritative spend.

---

## Appendix A — Locked Decisions D1 through D9

The nine load-bearing architectural decisions signed off by Antonio on 2026-04-21. Each is referenced throughout the plan.

### D1 — Workflow engine: Inngest (managed)
**Decision:** Inngest. Not Temporal. Not homemade.
**Rationale:** Vercel-native, serverless-first, observability baked in, days-to-ship (not weeks). No new ops surface. Designed for agent-heavy, event-driven workloads; avoids Temporal's LLM-payload saturation that forces external payload codec work.
**Cost:** starts $75/mo (Pro tier); scales to $300-600/mo at 500-1,000 clients.
**Revisit if:** we outgrow Vercel, or if workflows span months with hundreds of steps each.
**Kill criteria:** Inngest function execution P95 > 10s for any workflow sustained > 1 week; OR Inngest cost > $2,000/mo; OR more than 2 Inngest outages > 1h in any 90-day window. Kill trigger → evaluate Temporal (managed via Temporal Cloud) as replacement; all swappable via `lib/workflows/engine.ts`.

### D2 — Rules engine: TypeScript rules + CRM override layer
**Decision:** Rules authored in TypeScript (type-safe, tested, versioned in Git). Runtime-editable values live in `rule_overrides` table with CRM UI.
**What's editable at runtime:** prices, thresholds, reminder cadences, grace periods, conditional values, exceptions configuration.
**What requires code:** new rule shapes, new rule categories, structural changes.
**Rejected:** OPA/Rego (Antonio won't author it), Cedar (same), pure-JSONB-in-DB (no type safety, fragile).
**Future extension (Stage 4+):** visual workflow builder à la Harvey AI's pattern (25,000 client-built workflows).
**Kill criteria:** Stage 0 S0.0.5 empirical rule classification shows < 70% of rules are data-tier (editable without deploy). If ratio is < 70%, the "rules as data" premise fails; evaluate pure-JSONB schema with strict validation or a lightweight rule DSL that compiles to JSON instead.

### D3 — Agent architecture: single Ops Agent + strong context (Stage 1); specialists later
**Decision:** Stage 1 ships ONE "Ops Agent" with scoped tools + per-client context bundles. Revised from earlier 6-agent proposal based on 2026 production research.
**Rationale:** single-agent-with-good-context outperforms multi-agent for sequential workloads. Multi-agent pays off only when tasks run concurrently.
**Specialists emerge later** (Billing, Tax, Compliance, Communications, Portal-Support) only when distinct concurrent workloads or model-tier needs justify.
**Context bundle per invocation:** recent events, current solver state, retrieved SOPs via pgvector, retrieved v1 Scar Index entries relevant to the proposed action.
**Kill criteria:** admin approval rate on agent proposals < 70% averaged over any 30-day window after Stage 2 launch (implying the agent is not generating useful proposals). Kill trigger → audit proposal quality, adjust context bundle or model tier; if approval rate stays < 70% after adjustment, introduce specialist agents by domain.

### D4 — Hosting floor: Vercel + Supabase + Inngest. No new providers.
**Decision:** Stay on Vercel for Next.js. Supabase for data + auth + realtime. Inngest for durable workflows.
**Rationale:** Cloudflare's Vinext (Next.js on Workers) is experimental (Feb 2026 release, not battle-tested) — not production-ready. AI API calls go out regardless of host, so hosting doesn't change AI economics.
**Added later (Stage 2+):** pgvector inside Supabase for retrieval. Upgrade to managed vector DB only if pgvector becomes bottleneck.
**Kill criteria:** Vercel serverless function cold-start P99 > 3s on any production endpoint for > 2 weeks; OR Supabase data loss incident; OR any vendor materially changes pricing such that combined Vercel + Supabase + Inngest > $2,000/mo at 500 clients. Kill trigger → evaluate Cloudflare Workers (Next.js on Workers, if mature) as hosting replacement; Supabase is harder to swap (data + auth + realtime in one); evaluate only on data loss or severe SLA breach.

### D5 — AI cost ceiling: $4,000/month hard cap, alert at 80% ($3,200)
**Baseline model mix:** Claude Haiku 4.5 (70%), Sonnet 4.6 (25%), Opus 4.7 (5%). Prompt caching + Batch API applied wherever input is cacheable.
**Estimated spend:** 225 clients → $900-1,400/mo. 500 → $1,800-2,500/mo. 1,000 → $3,500-5,000/mo (will require raising cap near capacity).
**Anchor:** Antonio pays $4k/mo for an employee delivering ~25% of required output. AI spend under this ceiling is economically justified.
**Priority:** quality over cost. Do not trade 10% quality for $500 savings.
**Kill criteria:** AI cost > $4,000/mo for 2 consecutive months AND quality metrics (admin approval rate, escalation rate) are not improving. This is not "spend is too high" — it's "spend is too high AND value is not being delivered." If both are true: audit task-type costs, kill highest-cost lowest-value task types first.

### D6 — First-cutover feature scope: new-client lifecycle only
**In scope:** SMLLC + MMLLC Formation, Client Onboarding, Tax Return (intake + routing only), payment capture (Stripe/Whop/wire) with version-pinned pricing, Portal v2, CRM v2, Ops Agent, Inngest workflows for formation/onboarding/tax-intake.
**Out of scope:** ITIN, Closure, CMRA, Banking wizard, OA/Lease generation, annual renewal, QB sync, India tax routing, bank statements, referrals, ~40 secondary MCP tools.
**Existing 253 clients:** stay on v1 through cutover. Feature-by-feature migration in batches after.
**Kill criteria:** scope creep — if any out-of-scope item gets designed, specced, or built before the in-scope items are complete, this is a scope breach. Kill trigger → stop, revert, document the scar, reconfirm scope with Antonio.

### D7 — Forcing function: cutover 2026-10-21 (6 months from decision)
**First new client lands on Smart AI TD Operations on 2026-10-21.**
If 7-8 months proves necessary, extend explicitly with Antonio approval.
If 12+ months, it's a red flag. Antonio should challenge me.
Date is checked at every session start. Drifting past requires explicit decision, not silent slide.
**Kill criteria:** if Stage 0 and Stage 1 are not complete by 2026-07-01 (3 months into the build), the 2026-10-21 cutover is at risk. At that point: Antonio reviews whether to extend the date, reduce scope further, or accept a partial cutover (formation only, not onboarding + tax). Silent drift past 2026-10-21 without an explicit decision is the kill event — it means the forcing function failed.

### D8 — Sandbox + Vercel + repo isolation (strict)
**Smart AI Supabase ref:** `tapbgvbglqacamhayfel` (verified alive 2026-04-21).
**Smart AI Vercel project:** `td-operations-v2`. Not sharing deployment, domains, or env vars with v1.
**Smart AI GitHub repo:** `TonyDuranteSystem/td-operations-smart-ai`.
**Smart AI local directory:** `~/Developer/td-operations-smart-ai/` on MacBook.
**Smart AI CLAUDE.md:** new file in new repo. Inherits only R070 + R091 + R093 + R101 from v1.
**v1 sandbox `xjcxlmlpeywtwkhstjlw`** continues for v1 testing.
**Hard rule:** no v1 env var, webhook URL, Supabase ref, or API endpoint appears in Smart AI config and vice versa. `EXPECTED_SUPABASE_REF` assertion enforces at boot.
**Kill criteria:** any code commit to the Smart AI repo that references v1 Supabase ref (`ydzipybqeebtpcvsbtvs`) or v1 domain. This is a zero-tolerance rule. Discovery triggers: revert commit, scar created, R093 check protocol re-run for that section of code.

### D9 — What stays shared with v1, what stays separate — REVISED v1.1 (🔴 Fix C: knowledge migration path)
**Shared during build (Stages 0-7):** Smart AI reads `knowledge_articles` and `sop_runbooks` from v1's Supabase via a read-only retrieval layer. Business rules don't split while the code is still being built.
**Separate now:** code repo, CLAUDE.md, local directory, dev_tasks, session_checkpoints, action_log, MCP server instance, Vercel project, domains.
**Hybrid (project-management artifacts):** architecture sysdocs, stage worklists, build dev_task live in v1's Supabase for now (one read surface for Antonio). May migrate to Smart AI's Supabase post-cutover.

**At cutover (🔴 Fix C — closes the zombie problem):** `knowledge_articles` and `sop_runbooks` are **copied** to v2 Supabase at T-72h. A one-way sync (v1 → v2) runs during the hybrid period. 30 days post-cutover, v2 becomes the editing surface; sync stops; v1's copies are frozen. This removes the last operational dependency on v1 Supabase, making v1 fully archivable.

**Kill criteria for D9 (v1 decommission):** v1 is archivable when: (a) all clients routed to v2 (client_routing table shows zero 'v1' rows), (b) `knowledge_articles` sync stopped (v2 is editing surface), (c) all v1 webhooks deregistered and redirected to v2, (d) v1 infrastructure cost confirmed $0 for 30 consecutive days. Until all four are true, v1 is maintained.

---

## Appendix B — S0.8 Verification Panel (30 Clients)

Antonio-selected panel for the Stage 0 S0.8 exit gate. Scope locked 2026-04-21. Full list verified via live queries.

### Anchor (1 — Antonio's pick)
| Company | Account ID | Entity | State | Note |
|---|---|---|---|---|
| Oh My Creatives LLC | `fb534d22-1b06-45ae-8cc6-6a3007f1a489` | MMLLC | NM | MMLLC classification but only 1 member in junction — data oddity edge case |

### SMLLC clean recent (5)
| Company | Account ID | State |
|---|---|---|
| AG Group LLC | `9c3d5f5b-cad8-4739-b990-65fe0ae0ba10` | NM |
| MDL Advisory LLC | `7898b4df-5fed-45fb-b31b-13134320e711` | NM |
| Trade Charls LLC | `02d22896-2c40-4459-80ad-d18a155185c2` | WY |
| SD Int. LLC | `158c717b-80e7-4f63-a75d-94855723ed8b` | DE (also long-lived) |
| DF Commerce LLC | `63392d94-c327-443f-b5b1-bee7a5e923d5` | WY |

### MMLLC clean recent (5)
| Company | Account ID | State |
|---|---|---|
| PTBT Holding LLC | `7b3bb40b-0249-4dd4-8df1-85c86393a71a` | WY |
| Zhang Holding LLC | `9d068106-0ba8-40ae-a23c-acb76129cd77` | WY |
| Univexa International LLC | `59ae90bf-b629-4c22-9cba-029830fba9f2` | FL |
| DigitalBox LLC | `5250ec1c-a3a8-47fe-8f39-1ebf4b3862f2` | FL |
| Estro LLC | `fa6480ba-96d5-4141-b3a0-5ca9d5c1a51c` | WY |

### Multi-service (8 — heaviest histories)
| Company | Account ID | Entity | SDs | Service types |
|---|---|---|---|---|
| FBC Consulting & Services LLC | `707836b5-558f-4f00-8e8c-ad77c6125852` | SMLLC | 25 | Formation, EIN, ITIN, CMRA, State Annual Report, State RA Renewal, Tax Return, Annual Renewal |
| SDM Consulting LLC | `5e2e105b-2ef5-40ab-b058-df11b2f7847d` | SMLLC | 24 | Same minus ITIN |
| Papi Consulting LLC | `1fb1cc84-df3d-42d1-bc6f-3772844f66c5` | SMLLC | 24 | Same minus ITIN |
| Intubati EM LLC | `fbd57ff1-f3ac-42b5-bf5c-9a680d3cf67a` | C-Corp | 21 | CMRA, State Annual Report, RA Renewal, Tax Return |
| Entregarse US LLC | `a2d2f660-8da9-4645-a478-54a8c1c1339d` | C-Corp | 15 | Full stack |
| Dieffe International LLC | `8fe3dfed-165c-48a3-8c1d-75bc289f6417` | SMLLC | 13 | Full stack |
| Beril LLC | `60c22f1d-deca-45b7-accb-f0161611ab34` | C-Corp | 11 | Full stack (also long-lived) |
| Carasso Consulting LLC | `79d888f4-dc48-492d-8d2f-45bd79b1c9a7` | SMLLC | 9 | Full stack |

### Long-lived by formation date (8, Beril and SD Int. dedup)
| Company | Account ID | Formed | State |
|---|---|---|---|
| Beril LLC | `60c22f1d-...` | 2020-04-09 | FL |
| Lucky Pama LLC | `bb303823-7928-4932-8c21-2842e1de6067` | 2020-06-23 | FL |
| Diendei LLC | `710fe3b9-c997-45ea-9619-208a58fa960e` | 2020-07-08 | FL |
| VSV210 LLC | `d5dfe3b9-2a14-482a-8ba7-e06c129d52ee` | 2020-08-05 | FL |
| UC Marketing LLC | `656bd001-5e5a-4dac-89be-b0c2287ebfd9` | 2021-09-28 | WY |
| Web Media Capital LLC | `9e5c1499-9137-4234-9f7d-bc12abfca26e` | 2021-12-09 | DE |
| SD Int. LLC | `158c717b-...` | 2021-12-10 | DE |
| Xecom Consulting LLC | `89d13729-1714-4244-b124-c5372b926297` | 2022-03-23 | FL |

### At-risk by health (5)
| Company | Account ID | State | Health |
|---|---|---|---|
| VictoriamRoas LLC | `0c3e0fc0-3cda-4c93-9bbc-fa127626257b` | WY | red |
| DeP Consulting LLC | `a14b2c55-211f-4561-b7a4-ac77ef462e20` | WY | yellow |
| CF Consulting LLC | `3ce8e39d-b1fc-4ac3-8c81-c34b01dc11e7` | WY | red |
| Universe 369 LLC | `cabee2a6-e6ea-4fd4-891e-4611ee296f72` | WY | red |
| SP INTERNATIONAL LLC | `90810c0f-24f8-4cc7-a5ba-d366f8a67309` | NM | red |

**Total unique: 30.** Beril and SD Int. each appear in two categories (multi-service + long-lived, and SMLLC-clean + long-lived respectively) — deduped in the import loop.

**Exit gate strategy: triage by root cause**, not by client. Zero-or-explained diff across unique root causes. Details in Section 7 (Solver) and Section 20 (Migration).

---

## Appendix C — v1 vs v2 — What Actually Changes

Side-by-side for reviewer clarity. What exists in v1 today, what v2 replaces it with, and why.

| Aspect | v1 TD Operations | Smart AI v2 | Rationale |
|---|---|---|---|
| **Data model** | 70+ tables, evolved organically. `accounts` + `contacts` + `account_contacts` junction. | 5 core entities + event log + specs + exceptions + scars + proposals. | Deliberate layering; each table has a clear purpose. |
| **Membership** | `account_contacts` — join table, flat. | `account_members` — with `is_signer`, `left_at`, `added_by`, `role` lifecycle. | Member-lifecycle events are first-class; signer swap is one update. |
| **Pre-account entity** | Placeholder account pattern — real account created with fake data, updated later. | `engagements` — commercial relationship anchor, nullable `account_id`. | No placeholder pollution. |
| **State changes** | 176 direct DB writes across MCP tools, webhooks, cron jobs. | Every state change = `emit()` → events + outbox. | No silent writes. Audit trail complete. |
| **Rules location** | Scattered: code (`lib/`), prose (CLAUDE.md, SOPs), DB (various tables). | Specs in TypeScript, runtime overrides in `rule_overrides`, AI evaluation for edge cases. | Edit pricing in the CRM, not a code deploy. |
| **Service type identifier** | 85 hardcoded string literals across `lib/` and `app/`. | Spec-ID-driven; no string literals. | Adding a new service = new spec, zero code changes. |
| **Workflows** | Cron + webhook + action_log, inconsistent retry. | Inngest durable workflows with step-level retry, built-in observability. | Reliability and visibility. |
| **AI** | MCP tools for Claude Code dev sessions; no runtime agent layer. | Ops Agent with tools, scar retrieval, structured outputs, multi-model tiering. | AI is a first-class operator. |
| **Portal** | Per-service-type pages. Adding a service = new pages + components. | Solver-driven rendering. Spec change = immediate portal update. | Flexibility, consistency. |
| **CRM** | Tabbed by entity type (Accounts / Contacts / Tasks). | Intelligence-first (Needs Action / Blocked / Proposals / Anomalies). | Operational surface matches operator mental model. |
| **Exceptions** | Informal (notes field, ad-hoc overrides). | First-class `exceptions` table, typed exception_type, audited, pattern-detected. | Flexibility without fragility. |
| **PII** | Mostly in-table (EIN, ITIN, passport_number as text columns). | Tokenized in events; raw in `sensitive_data` with encryption + RLS. | GDPR-safe, audit-safe. |
| **Schema changes** | Scripts in `scripts/sandbox-seed/`, applied manually. | Supabase migrations in `supabase/migrations/`, applied via `supabase db push`. | Repeatable, reversible. |
| **Observability** | Sentry + ad-hoc logging. | Sentry + Inngest dashboard + custom metrics + SLOs + calibration dashboards. | Silent failures become visible failures. |
| **Workflow engine** | Cron + webhooks; retry is manual or ad-hoc. | Inngest durable workflows with automatic retry, step-level checkpointing. | Reliability at scale. |
| **Hosting** | Vercel + Supabase. | Vercel + Supabase + Inngest. | Same bones; workflow engine added. |
| **Shadow mode / testing** | Sandbox as mirror of prod; manual testing. | Shadow mode tees v1 webhooks into v2 for continuous comparison. | Continuous validation vs periodic. |
| **Migration path** | N/A. | Feature-by-feature post-cutover. | Bounded risk per feature. |

---

## Appendix D — Glossary

- **Account** — a company (LLC, C-Corp) in the system. Has `entity_type`, `state_of_formation`, `status`, members, services. Not the same as a contact.
- **Agent (Ops Agent)** — the AI layer that reads solver output and proposes actions. Single agent at Stage 1 with scoped tools and context bundles.
- **Blast radius** — the reach of a proposed action. `internal_only` (TD-facing), `admin_only` (surfaces to admin), `client_visible` (reaches a client). Blast-radius gating determines whether auto-execution is allowed.
- **Cache invalidation** — event-driven. Every event that touches an engagement's subject invalidates the solver cache for that engagement.
- **Calibration** — the empirical measurement of (AI confidence, actual accuracy) pairs, used to adjust auto-execution thresholds.
- **Case (informal usage)** — the compound state of a client across all their engagements, services, payments, and deadlines. Not an explicit entity in v2 at Stage 1; rendered on-demand by composing solver outputs per account. Future consideration if operational pain forces it.
- **Contact** — a person in the system. Can be a client, a member of an LLC, a signer. One contact can belong to multiple accounts via `account_members`.
- **Context bundle** — the assembled payload passed to the Ops Agent on each invocation. Contains engagement state, recent events, retrieved SOPs, retrieved scars, policy context, and task specification.
- **Cutover** — the date v2 accepts its first new client. 2026-10-21 per D7.
- **Devil's advocate (R101)** — the five-question self-challenge required before any plan, proposal, or decision. Enforced by the `plan_challenge` MCP tool (dev_task `24cfad54`).
- **Emit** — the single entry point for writing to the event log. `emit(event)` writes to `events` + `outbox` atomically.
- **Engagement** — a commercial relationship around a specific contract (Formation, Onboarding, Tax, Renewal, Closure). Pre-account existence allowed (nullable `account_id`). Spec-pinned, price-pinned at creation.
- **Event** — an immutable record of a state change. Append-only. Includes type, subject, actor, payload, causation chain.
- **Exception** — a formal override of a requirement. Typed (skip / defer / substitute / override_value). Approved, reasoned, auditable.
- **Forcing function** — 2026-10-21 cutover date. Not optional. Slipping requires explicit decision, not silent drift.
- **Inngest** — the durable workflow engine. Managed, Vercel-native, event-triggered.
- **Member** — a person linked to an account via `account_members`. Has role, ownership percentage, signer designation, join/leave dates.
- **MCP server** — the tool surface exposed to Claude Code sessions. Smart AI has its own MCP separate from v1's.
- **Outbox** — the transactional outbox pattern for atomic event emission. `events` + `outbox` inserts happen in one Postgres transaction; drain worker publishes async.
- **Proposal** — an agent-generated action recommendation. Reviewed by admin (client-visible ones always) or auto-executed (internal_only, gated by blast radius + scar match + confidence).
- **R093** — CLAUDE.md rule: No Assumptions. Every fact must come from a fresh tool call in the current session.
- **R101** — CLAUDE.md rule: Devil's Advocate Mandatory. Five-question self-challenge before any plan or proposal.
- **Requirement** — a unit of "done" within a specification. Types: gate, data, document, deliverable. Has dependencies, scope (per-member or per-account), and optional `ai_evaluable` flag.
- **Scar (v1 Scar)** — a structured record of a past v1 failure, with category, root cause, Smart AI prevention, and verification path. Used build-time and runtime.
- **Scar Index** — the `v1_scars` table + pgvector retrieval. The learning layer.
- **Shadow mode** — the validation approach: v1 production webhooks tee into v2 read-only for continuous comparison without client-facing effect.
- **Sensitive data** — PII (passport, ITIN, EIN, SSN, DOB). Stored in `sensitive_data` with encryption + per-row RLS; referenced elsewhere via opaque tokens.
- **Solver** — the pure function that takes a spec + engagement state and returns a `StatusReport`. Deterministic. No DB writes.
- **Specification (Spec)** — TypeScript-authored contract for what a service type looks like. Includes requirements, pricing rules, follow-up cadences, exception configuration. Seeded to `service_specs` at deploy.
- **Stage** — a discrete build phase with entry conditions and exit criteria. Stages 0-7 detailed in Section 19.
- **Structured output** — Anthropic tool-use API constraint that forces agent responses into a typed JSON schema. Prevents hallucinated citations or malformed outputs.
- **TD** — Tony Durante LLC. The business.

---

## Appendix E — References

### Sysdocs
- `smart-ai-td-ops-architecture` — canonical locked decisions D1-D9 + Scar Index subsystem. Read at every Smart AI session start.
- `smart-ai-td-ops-stage-0-worklist` — Stage 0 tasks S0.0-S0.9, live-maintained progress.
- `session-context` (v1) — v1's cross-session context hub.
- `target-control-model-challenge.md` (working tree, v1 repo) — prior analysis of v1's control-model gap; informed the engagement-vs-case distinction.
- `sandbox-reality-assessment.md` (working tree) — informed the shadow-mode strategy.
- `operating-model-assessment.md` (working tree) — informed governance and R101 rule.

### Dev tasks
- `2bc839aa-2e8e-4841-85ff-8a3f304a68c5` — "v2 Smart System — Build (Cutover 2026-10-21)". Main tracker.
- `24cfad54-f764-4510-9397-b0625a8849f8` — "R101 enforcement — plan_challenge MCP tool + pre-response gate". Enforcement mechanism.

### Commits (v1 repo)
- `3e40d46` — R101 added to v1 CLAUDE.md (banner in Verification Protocol + one-liner in Error-Magnet Rules).
- `1dbfa33` — QB sync manual-only enforcement (R097 commit).
- `4d5f403` — `offer-signed` webhook decoupled from leads.status transition (R094 commit).
- `49d64df` — Soft-delete pattern for client-visible content (R100 commit).
- `b80ecef` — Server error surfacing on client-side fetch (R099 commit).

### Commits (Smart AI repo)
- `baa4c5e` — Initial skeleton (CLAUDE.md, .gitignore, directory structure).
- `b8d8c75` — R101 inherited in Smart AI CLAUDE.md.
- `38c76f2` — docs(architecture): Part 1 of this plan.
- `845ec2e` — docs(architecture): Part 2.
- `caabd76` — docs(architecture): Part 3.

### Research citations (for Claude API + agent design)
- [Inngest vs Temporal durable workflows (2026)](https://www.inngest.com/compare-to-temporal)
- [Durable Workflow Platforms for AI Agents and LLM Workloads (Render, 2026)](https://render.com/articles/durable-workflow-platforms-ai-agents-llm-workloads)
- [Harvey AI platform](https://www.harvey.ai/platform)
- [Basis scales accounting with OpenAI agents](https://openai.com/index/basis/)
- [Anthropic API pricing 2026](https://www.finout.io/blog/anthropic-api-pricing)
- [Agentic workflow production patterns (Virtido, 2026)](https://virtido.com/blog/agentic-workflows-patterns-best-practices-enterprise)
- [Production-grade agentic AI workflows (arxiv 2512.08769)](https://arxiv.org/abs/2512.08769)

### Business rules / SOPs (v1)
- Master Rules KB: `knowledge_articles` in v1 Supabase (article `370347b6` — canonical per R060).
- SOP runbooks: `sop_runbooks` in v1 Supabase.
- CLAUDE.md R005-R101 (v1 repo root).

---

**End of plan.**

This document is open for structured challenge per Section 21.4 before Stage 0 S0.2 schema work begins. R101-FLAGs throughout each section are the invitation. Bring your best adversarial read.

