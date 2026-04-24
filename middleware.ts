import { NextResponse, type NextRequest } from 'next/server';
import { assertSmartAiRef } from '@/lib/config';

const ADMIN_LOGIN_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Admin — Sign in</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#18181b;color:#f4f4f5}
  form{background:#27272a;border:1px solid #3f3f46;border-radius:8px;padding:2rem;width:320px}
  h1{margin:0 0 1.5rem;font-size:1.1rem;font-weight:600}
  input{width:100%;box-sizing:border-box;padding:.5rem .75rem;border:1px solid #3f3f46;border-radius:6px;background:#18181b;color:#f4f4f5;font-size:.875rem;margin-bottom:1rem}
  button{width:100%;padding:.5rem;background:#f4f4f5;color:#18181b;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:.875rem}
  button:hover{background:#e4e4e7}
  .err{color:#f87171;font-size:.75rem;margin-bottom:.75rem;display:none}
</style>
</head>
<body>
<form method="POST" action="/api/admin/login">
  <h1>Smart AI Admin</h1>
  <p class="err" id="err">Invalid token.</p>
  <input type="password" name="token" placeholder="Access token" autofocus autocomplete="current-password" />
  <button type="submit">Sign in</button>
</form>
</body>
</html>`;

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

  // Admin auth gate — bearer token required for /admin/* (architecture §17.7).
  // ADMIN_SECRET must be set in Vercel env before S0.7 ships shadow-mode data (R101 flag).
  if (request.nextUrl.pathname.startsWith('/admin')) {
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return new NextResponse('Admin access not configured (ADMIN_SECRET missing)', { status: 503 });
    }
    const auth = request.headers.get('authorization') ?? '';
    const cookie = request.cookies.get('admin_token')?.value ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : cookie;
    if (token !== adminSecret) {
      // Return login page prompt for browsers, 401 for API/curl clients
      const acceptsHtml = request.headers.get('accept')?.includes('text/html') ?? false;
      if (acceptsHtml) {
        return new NextResponse(ADMIN_LOGIN_HTML, {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|pdf|webmanifest|ttf|otf|woff|woff2)$).*)',
  ],
};
