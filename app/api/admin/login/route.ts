import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const body = await req.formData().catch(() => null);
  const token = body?.get('token');
  if (typeof token !== 'string' || token !== adminSecret) {
    return new NextResponse(
      `<!doctype html><html><head><meta charset="utf-8"><title>Admin — Sign in</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#18181b;color:#f4f4f5}
form{background:#27272a;border:1px solid #3f3f46;border-radius:8px;padding:2rem;width:320px}
h1{margin:0 0 1.5rem;font-size:1.1rem;font-weight:600}
input{width:100%;box-sizing:border-box;padding:.5rem .75rem;border:1px solid #3f3f46;border-radius:6px;background:#18181b;color:#f4f4f5;font-size:.875rem;margin-bottom:1rem}
button{width:100%;padding:.5rem;background:#f4f4f5;color:#18181b;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:.875rem}
.err{color:#f87171;font-size:.75rem;margin-bottom:.75rem}</style></head>
<body><form method="POST" action="/api/admin/login">
<h1>Smart AI Admin</h1><p class="err">Invalid token — try again.</p>
<input type="password" name="token" placeholder="Access token" autofocus autocomplete="current-password"/>
<button type="submit">Sign in</button></form></body></html>`,
      { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  const res = NextResponse.redirect(new URL('/admin', req.url));
  res.cookies.set('admin_token', adminSecret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
  return res;
}
