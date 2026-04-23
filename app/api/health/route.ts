import { NextResponse } from 'next/server';
import { EXPECTED_SUPABASE_REF, extractSupabaseRef } from '@/lib/config';

/**
 * Liveness probe. No auth. Does NOT touch the database.
 * Returns 200 with the resolved ref when the tripwire holds, 500 when it doesn't.
 */
export function GET(): NextResponse {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const actualRef = extractSupabaseRef(url);
  const healthy = actualRef === EXPECTED_SUPABASE_REF;
  return NextResponse.json(
    {
      service: 'td-operations-v2',
      stage: 0,
      expected_supabase_ref: EXPECTED_SUPABASE_REF,
      actual_supabase_ref: actualRef,
      healthy,
    },
    { status: healthy ? 200 : 500 }
  );
}
