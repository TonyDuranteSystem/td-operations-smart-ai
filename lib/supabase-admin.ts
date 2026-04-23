/**
 * Supabase Admin Client (Service Role) — Smart AI TD Operations.
 * Bypasses Row Level Security for server-side operations.
 * Used by: API routes, Inngest handlers, migrations.
 *
 * Lazy-initialized via Proxy so build-time evaluation doesn't crash when envs
 * are not yet populated. First actual method call performs the D8 assertion.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSmartAiRef } from '@/lib/config';

let _supabaseAdmin: SupabaseClient | null = null;

function getOrInit(): SupabaseClient {
  if (_supabaseAdmin) return _supabaseAdmin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  assertSmartAiRef(url);

  if (!serviceRoleKey) {
    throw new Error('FATAL: SUPABASE_SERVICE_ROLE_KEY is not configured. Refusing to start.');
  }

  _supabaseAdmin = createClient(url as string, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabaseAdmin;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getOrInit();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (client as any)[prop];
  },
});
