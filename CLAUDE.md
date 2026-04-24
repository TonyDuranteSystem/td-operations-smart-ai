# Smart AI TD Operations — Claude Code Rules

## Identity

You are working on **Smart AI TD Operations**, the greenfield AI-first successor to v1 TD Operations (`~/Developer/td-operations/`). This is not v1. Do not import v1 patterns, code, or implementations unless they have been validated against the v1 Scar Index and reaffirmed here.

## Session Start — MANDATORY

Before any work in this repo, read in this order:

1. Read the architecture sysdoc from Smart AI Supabase (`tapbgvbglqacamhayfel`), `system_docs` WHERE `slug = 'smart-ai-td-ops-architecture'`. Drift-prevention insurance.
2. Read the stage-0 worklist from Smart AI Supabase, `system_docs` WHERE `slug = 'smart-ai-td-ops-stage-0-worklist'`.
3. Read the Smart AI dev_task from Smart AI Supabase, `dev_tasks` WHERE `id = '2bc839aa-2e8e-4841-85ff-8a3f304a68c5'` — progress log.
4. `git pull origin main` — sync with the lead machine (MacBook).

**Never read Smart AI sysdocs/dev_tasks from v1 prod (`ydzipybqeebtpcvsbtvs`).** Prior to 2026-04-23 they lived there; they were migrated to Smart AI Supabase on 2026-04-23. v1 prod copies are stale.

**How to read/write Smart AI Supabase** (until Smart AI MCP ships — S0.0 pending):
- Use the Supabase Management API: `POST https://api.supabase.com/v1/projects/tapbgvbglqacamhayfel/database/query` with `{"query": "..."}` body.
- Auth: `Authorization: Bearer <SUPABASE_ACCESS_TOKEN>` — personal access token from [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens). Expires every 30 days — rotate when expired.
- **Never use v1's `sysdoc_read`, `execute_sql`, `dev_task_*`, or `session_checkpoint` MCP tools for Smart AI work** — those go to v1 prod. v1 MCP tools are fine for cross-reference READS of v1 data (knowledge_articles, sop_runbooks per D9), never for Smart AI writes.

**The architecture sysdoc is canonical.** If a session proposal conflicts with it, the sysdoc wins unless explicitly superseded with Antonio's approval (and the sysdoc updated in the same motion).

## Eternal rules inherited from v1 (the rest are not inherited)

Only rules that are universally true, not v1-scar-specific, are carried forward:

- **R070** — Run `git pull origin main` BEFORE any work, every session. Multi-machine setup is real even on this greenfield (MacBook is lead; other machines may eventually contribute).
- **R091** — Never create README.md or documentation files unless Antonio explicitly requests them. Architecture lives in `docs/architecture.md` and Smart AI Supabase sysdocs.
- **R093** — **NO ASSUMPTIONS. EVER.** Every column name, schema, enum, file path, function signature, API behavior, workflow semantic, or client state must be verified by a fresh tool call in the current session before use. "I haven't verified this yet — let me check" is always the right next sentence. Antonio's words: *"WITH YOUR ASSUMPTIONS WE RISK TO RUIN THE SYSTEM."*
- **R101** — **DEVIL'S ADVOCATE MANDATORY.** Before any plan, proposal, decision, or recommendation, you MUST internally answer five questions: (1) what am I assuming, (2) what did I consider and reject, (3) how is my chosen approach weak, (4) what's verified vs what's accepted, (5) am I picking this because it's easier to write or actually better. If you cannot answer honestly, do not reply yet — investigate more. Antonio's words (2026-04-21): *"you don't have to assume or look for shortcut or be lazy. You must do always the devil's advocate of everything."* R093 bans assumed facts; R101 bans accepting the first reasonable-seeming plan without challenge. Full banner in v1 CLAUDE.md § Verification Protocol. Enforcement tool (`plan_challenge`) in progress as dev_task.

Additional rules ported from v1 guardrails (Tier 1, 2026-04-23):

- **R016** — All URLs, tokens, and slugs must be in English. No special characters in URL components.
- **R086** — Write unit tests for every new function in `lib/`. The pre-push hook blocks push if `npm run test:unit` fails.
- **R089** — All automation via Supabase Edge Functions, Inngest, or Vercel crons. Never Make, Zapier, n8n, or any other third-party automation platform.
- **R090** — Never commit `.env.local`, `.env`, or any credentials. Verify `.gitignore` excludes them before staging.

New rules for Smart AI will emerge from the system's actual behavior as it is built. They are derived, not inherited.

## v1 Scar Index — the learning layer

Every rule from v1's CLAUDE.md R005-R100 and every historical bugfix in v1 `dev_tasks` is a **scar**: a hard-won production lesson. These are being extracted into the `v1_scars` table in Smart AI's Supabase (Stage 0 S0.9 of the worklist).

Before designing any feature:
- Query the scar index for related categories.
- Every matching scar must be provably prevented in the new design — by schema constraint, typed invariant, test case, or RLS policy. Prose-level promise is not prevention.
- Missing preventions are design gates: the feature does not ship until the scar is closed.

Runtime: the Ops Agent retrieves relevant scars into its context bundle before every proposal. If a proposed action matches a known failure pattern AND the prevention isn't satisfied in current state, the agent escalates regardless of confidence.

## Multi-machine git safety

MacBook is the lead machine. If iMac or Mac Mini join later, these rules apply to all of them.

- **MM3** — NEVER use `git add -A` or `git add .`. Stage specific files by name only. These commands stage deletions of files that exist on remote but are missing locally — another machine's work gets silently destroyed on the next push.
- **MM4** — NEVER run `git push --force`. If push is rejected non-fast-forward, use `git pull --rebase origin main`. If conflicts exist, STOP and report — do not auto-resolve. After resolution: `git rebase --continue` → `npm run build` → `git push`.
- **MM6** — Protected files — do NOT modify without Antonio's explicit request. Another machine may have updated them intentionally. If `git status` shows any of these modified without your action, investigate before committing:
    - `CLAUDE.md`
    - `.husky/pre-commit`
    - `.husky/pre-push`
    - `.claude/settings.json`
    - `.claude/hooks/*.sh`
    - `middleware.ts`
    - `lib/config.ts`
    - `lib/supabase-admin.ts`
- **MM7** — When `git push` fails non-fast-forward: run `git pull --rebase origin main`. If conflicts exist, STOP — do not auto-resolve. List conflicted files and ask Antonio which version to keep. After manual resolution: `git rebase --continue` → `npm run build` → `git push`.

## Database discipline

Smart AI has TWO Supabase projects — never confuse them.

- **D-Sandbox-vs-Prod** — Two projects, both required targets for every migration:
    - **Sandbox** (`tapbgvbglqacamhayfel`): Stage 0–1 development. Contains v1-clone data (seeded 2026-02-22) for S0.7 shadow mode, S0.8 panel verification, and S0.9 scar extraction. This is the dev/staging environment.
    - **Production** (`wxzomfntgnkryyzytcir`): Created 2026-04-23. Clean slate — no data yet. First real Smart AI client lands here at cutover 2026-10-21.

  Every schema migration MUST be applied to BOTH projects. Apply to sandbox first, verify, then apply to production. Runner: `npx tsx scripts/apply-migrations.ts --target=sandbox` and `--target=production`. The runner has 4 guards: (1) required `--target` flag, (2) migration must reference the target's ref, (3) migration must not contain any v1 ref, (4) migration must not reference the other Smart AI ref. Each Stage 0–1 migration applied twice rehearses the cutover promotion workflow.

  NEVER apply a migration to production only, or skip sandbox verification.

## Isolation — HARD RULES

- This repo is NOT a fork or branch of v1 TD Operations.
- No v1 Supabase ref, env var, webhook URL, or domain appears in this repo's config — except in explicitly-labeled read-only shadow-mode adapters.
- Smart AI Supabase ref enforces at boot via `EXPECTED_SUPABASE_REF` middleware assertion.
- MacBook is the dedicated lead machine for this project. iMac and Mac Mini remain on v1 support only, until Smart AI architecture stabilizes.

## Save after every significant action

The Smart AI MCP server is not yet configured (Stage 0 S0.0). Until then, update the progress_log on the Smart AI dev_task (`2bc839aa...` on Smart AI Supabase `tapbgvbglqacamhayfel`) via Management API curl — NOT via v1's MCP tools.

**Never call `session_checkpoint` MCP for Smart AI work** — that tool writes to v1 prod's `session_checkpoints` table. For Smart AI, the progress_log on the Smart AI dev_task is the checkpoint surface until the Smart AI MCP + its own `session_checkpoints` table are wired up in S0.0.

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
