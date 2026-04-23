/**
 * Smart AI TD Operations — runtime config invariants (architecture D8).
 *
 * Smart AI has TWO Supabase projects:
 *   - SANDBOX_SUPABASE_REF — used during Stage 0–1 for all development work.
 *     Contains a v1-clone dataset for shadow-mode + panel verification.
 *   - PROD_SUPABASE_REF — created 2026-04-23. Empty slate. At cutover, new
 *     Smart AI clients land here. During Stage 0–1, migrations are applied
 *     to BOTH so the cutover promotion workflow is rehearsed continuously.
 *
 * EXPECTED_SUPABASE_REF is the ref the *running app* expects. Set by env
 * var at deploy time; defaults to sandbox for Stage 0 dev. Mismatch at
 * runtime = fatal (supabase-admin.ts + middleware.ts both call assertSmartAiRef).
 *
 * FORBIDDEN_SUPABASE_REFS are v1 refs. Any code path that touches them
 * must refuse. Migration scripts check the connection string against this
 * list before opening a client.
 */

export const SANDBOX_SUPABASE_REF = 'tapbgvbglqacamhayfel' as const;
export const PROD_SUPABASE_REF    = 'wxzomfntgnkryyzytcir' as const;

export const SMART_AI_SUPABASE_REFS: readonly string[] = [
  SANDBOX_SUPABASE_REF,
  PROD_SUPABASE_REF,
];

// EXPECTED_SUPABASE_REF is the currently-configured runtime target. At Stage 0
// it is sandbox. At cutover, Vercel prod env flips this to PROD_SUPABASE_REF.
// Kept as a typed string (not a literal union) so an env-driven override in
// future deploys does not require a type change.
export const EXPECTED_SUPABASE_REF: string =
  process.env.EXPECTED_SUPABASE_REF ?? SANDBOX_SUPABASE_REF;

const V1_PROD_REF    = 'ydzipybqeebtpcvsbtvs';
const V1_SANDBOX_REF = 'xjcxlmlpeywtwkhstjlw';

export const FORBIDDEN_SUPABASE_REFS: readonly string[] = [V1_PROD_REF, V1_SANDBOX_REF];

export function extractSupabaseRef(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

export function assertSmartAiRef(url: string | undefined): void {
  const actualRef = extractSupabaseRef(url);
  if (actualRef === null) {
    throw new Error(
      `FATAL: NEXT_PUBLIC_SUPABASE_URL is missing or malformed (got ${JSON.stringify(url)}). Refusing to start.`
    );
  }
  if (FORBIDDEN_SUPABASE_REFS.includes(actualRef)) {
    throw new Error(
      `FATAL: Smart AI is configured with a v1 Supabase ref "${actualRef}". D8 zero-tolerance. Refusing to start.`
    );
  }
  if (actualRef !== EXPECTED_SUPABASE_REF) {
    throw new Error(
      `FATAL: Supabase project ref mismatch. Expected "${EXPECTED_SUPABASE_REF}", got "${actualRef}". Refusing to start — wrong DB target.`
    );
  }
}
