import { NextResponse } from 'next/server';
import { queryPostgres } from '@/lib/postgres';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await queryPostgres(`
      SELECT h.id::text, h.event_id, e.event_name, e.currency, h.currency_bias, h.bias_score, h.archived_at::text
      FROM economic_event_history h
      LEFT JOIN economic_events e ON e.id = h.event_id
      ORDER BY h.archived_at DESC
      LIMIT 200
    `);
    return NextResponse.json({ ok: true, history: result.rows });
  } catch (error) {
    return NextResponse.json({ ok: false, history: [], error: error instanceof Error ? error.message : 'Failed to load history.' }, { status: 503 });
  }
}
