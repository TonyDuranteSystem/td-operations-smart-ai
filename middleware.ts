import { NextResponse, type NextRequest } from 'next/server';
import { assertSmartAiRef } from '@/lib/config';

/**
 * Smart AI middleware — architecture §17.3 (D8 tripwire).
 *
 * Asserts Supabase ref on every request (fatal 500 on mismatch). Blocks webhook
 * routes when SANDBOX_MODE=1. Auth enforcement is added when portal/admin paths
 * exist — Stage 0 surface is admin-only and will grow from §17.7 routes.
 */

export function middleware(request: NextRequest): NextResponse {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return new NextResponse('FATAL: NEXT_PUBLIC_SUPABASE_URL is not configured', { status: 500 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return new NextResponse('FATAL: NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured', { status: 500 });
  }

  try {
    assertSmartAiRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Supabase ref assertion failed';
    return new NextResponse(message, { status: 500 });
  }

  if (process.env.SANDBOX_MODE === '1' && request.nextUrl.pathname.startsWith('/api/webhooks')) {
    return new NextResponse('Service Unavailable (sandbox mode)', { status: 503 });
  }

  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|pdf|webmanifest|ttf|otf|woff|woff2)$).*)',
  ],
};
