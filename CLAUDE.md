# Smart AI TD Operations — Claude Code Rules

## Identity

You are working on **Smart AI TD Operations**, the greenfield AI-first successor to v1 TD Operations (`~/Developer/td-operations/`). This is not v1. Do not import v1 patterns, code, or implementations unless they have been validated against the v1 Scar Index and reaffirmed here.

## Session Start — MANDATORY

Before any work in this repo, read in this order:

1. `sysdoc_read('smart-ai-td-ops-architecture')` — canonical locked architectural decisions. Drift-prevention insurance.
2. `sysdoc_read('smart-ai-td-ops-stage-0-worklist')` — current stage worklist.
3. Query `dev_tasks` for "Smart AI TD Operations — Build" (ID `2bc839aa-2e8e-4841-85ff-8a3f304a68c5`) — progress log.
4. `git pull origin main` — sync with the lead machine (MacBook).

**The architecture sysdoc is canonical.** If a session proposal conflicts with it, the sysdoc wins unless explicitly superseded with Antonio's approval (and the sysdoc updated in the same motion).

## Eternal rules inherited from v1 (the rest are not inherited)

Only rules that are universally true, not v1-scar-specific, are carried forward:

- **R070** — Run `git pull origin main` BEFORE any work, every session. Multi-machine setup is real even on this greenfield (MacBook is lead; other machines may eventually contribute).
- **R091** — Never create README.md or documentation files unless explicitly requested by Antonio.
- **R093** — **NO ASSUMPTIONS. EVER.** Every column name, schema, enum, file path, function signature, API behavior, workflow semantic, or client state must be verified by a fresh tool call in the current session before use. "I haven't verified this yet — let me check" is always the right next sentence. Antonio's words: *"WITH YOUR ASSUMPTIONS WE RISK TO RUIN THE SYSTEM."*
- **R101** — **DEVIL'S ADVOCATE MANDATORY.** Before any plan, proposal, decision, or recommendation, you MUST internally answer five questions: (1) what am I assuming, (2) what did I consider and reject, (3) how is my chosen approach weak, (4) what's verified vs what's accepted, (5) am I picking this because it's easier to write or actually better. If you cannot answer honestly, do not reply yet — investigate more. Antonio's words (2026-04-21): *"you don't have to assume or look for shortcut or be lazy. You must do always the devil's advocate of everything."* R093 bans assumed facts; R101 bans accepting the first reasonable-seeming plan without challenge. Full banner in v1 CLAUDE.md § Verification Protocol. Enforcement tool (`plan_challenge`) in progress as dev_task.

New rules for Smart AI will emerge from the system's actual behavior as it is built. They are derived, not inherited.

## v1 Scar Index — the learning layer

Every rule from v1's CLAUDE.md R005-R100 and every historical bugfix in v1 `dev_tasks` is a **scar**: a hard-won production lesson. These are being extracted into the `v1_scars` table in Smart AI's Supabase (Stage 0 S0.9 of the worklist).

Before designing any feature:
- Query the scar index for related categories.
- Every matching scar must be provably prevented in the new design — by schema constraint, typed invariant, test case, or RLS policy. Prose-level promise is not prevention.
- Missing preventions are design gates: the feature does not ship until the scar is closed.

Runtime: the Ops Agent retrieves relevant scars into its context bundle before every proposal. If a proposed action matches a known failure pattern AND the prevention isn't satisfied in current state, the agent escalates regardless of confidence.

## Isolation — HARD RULES

- This repo is NOT a fork or branch of v1 TD Operations.
- No v1 Supabase ref, env var, webhook URL, or domain appears in this repo's config — except in explicitly-labeled read-only shadow-mode adapters.
- Smart AI Supabase ref enforces at boot via `EXPECTED_SUPABASE_REF` middleware assertion.
- MacBook is the dedicated lead machine for this project. iMac and Mac Mini remain on v1 support only, until Smart AI architecture stabilizes.

## Save after every significant action

The Smart AI MCP server is not yet configured (Stage 0 S0.0). Until then, use v1's `session_checkpoint` with explicit "Smart AI" prefix in the summary.

After every commit, schema change, decision, or config change — save immediately. Compaction eats unsaved state.

## Architecture invariants — DO NOT violate without updating the architecture sysdoc

- **Workflow engine:** Inngest (managed). Not Temporal. Not homemade.
- **Rules engine:** TypeScript source + CRM override layer. Not OPA. Not Cedar. Not pure JSONB.
- **Agent architecture:** single Ops Agent at Stage 1 with strong per-client context. Specialists only emerge when concurrent workloads justify.
- **Hosting floor:** Vercel + Supabase + Inngest. No new providers without architecture change.
- **Events:** append-only + outbox pattern for transactional atomicity. "Atomicity" without outbox is a lie.
- **Solver:** pure function. Deterministic. No DB writes. AI-evaluable requirements pre-resolved as `ai.decision` events, never called inline.
- **PII:** tokenized in events; raw values in `sensitive_data` with per-row RLS and encryption at rest.
- **Pricing:** engagements snapshot `spec_version_id` at creation. Future spec edits cannot retroactively alter contracted prices.
- **Cutover forcing function:** 2026-10-21. Slipping past requires explicit Antonio decision, not silent drift.

## Communication

English. Direct. Challenge Antonio's proposals when warranted; do not flatter. Verify before claiming. If you cannot cite file/table/line/tool output from this session, do not say it and do not act on it.

## What this repo is NOT for

- Not a place to patch v1 bugs — those go in `~/Developer/td-operations/`.
- Not a place to document v1 — v1 documentation lives in v1's sysdocs + CLAUDE.md.
- Not a place to experiment with unapproved architectures — if you want to try Temporal, or Cedar, or a different agent shape, the architecture sysdoc is the place to propose it, not code.
