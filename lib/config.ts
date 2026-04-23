/**
 * Smart AI TD Operations — runtime config invariants (architecture D8).
 *
 * EXPECTED_SUPABASE_REF is the literal Smart AI Supabase project ref. Any code
 * that connects to Supabase asserts this before opening a client. Mismatch = fatal.
 * This file is imported at module load by supabase-admin.ts and middleware.ts.
 */

export const EXPECTED_SUPABASE_REF = 'tapbgvbglqacamhayfel' as const;

const V1_PROD_REF = 'ydzipybqeebtpcvsbtvs';
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
