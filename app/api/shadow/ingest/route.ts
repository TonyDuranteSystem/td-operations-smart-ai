import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/db/pg-pool';
import { mapV1Webhook, ShadowMapError, type V1WebhookPayload } from '@/lib/shadow/mapper';

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.SHADOW_INGEST_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const incoming = req.headers.get('x-shadow-secret') ?? '';
  if (incoming !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  let event;
  try {
    event = mapV1Webhook(body as V1WebhookPayload);
  } catch (err) {
    if (err instanceof ShadowMapError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }

  try {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO events
         (event_type, subject_type, subject_id, account_id, actor_type, actor_id,
          payload, caused_by, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        event.event_type,
        event.subject_type,
        event.subject_id,
        event.account_id,
        event.actor_type,
        event.actor_id,
        event.payload,
        event.caused_by,
        event.idempotency_key,
      ]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
