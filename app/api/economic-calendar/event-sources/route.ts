export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { queryPostgres } from '@/lib/postgres';

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_ECONOMIC_CALENDAR_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('Economic Calendar tool is disabled outside development.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('Economic Calendar requires local machine access.');
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
    const url = new URL(request.url);
    const eventId = url.searchParams.get('eventId') ?? '';
    if (!eventId) return Response.json({ ok: false, error: 'eventId is required.' }, { status: 422 });

    const [snapshots, conflicts] = await Promise.all([
      queryPostgres(
        `SELECT id::text, source_name, raw_payload, captured_at::text AS captured_at
         FROM economic_event_source_snapshots
         WHERE event_id = $1
         ORDER BY captured_at DESC
         LIMIT 25`,
        [eventId],
      ),
      queryPostgres(
        `SELECT id::text, conflict_type, field_name, source_a, value_a, source_b, value_b, resolution_status, preferred_source, created_at::text AS created_at
         FROM economic_event_conflicts
         WHERE event_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [eventId],
      ),
    ]);

    return Response.json(
      { ok: true, eventId, snapshots: snapshots.rows, conflicts: conflicts.rows },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load event sources.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

