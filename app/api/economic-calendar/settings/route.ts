import { NextResponse } from 'next/server';
import { queryPostgres } from '@/lib/postgres';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await queryPostgres(`SELECT key, value, updated_at::text AS updated_at FROM economic_calendar_settings ORDER BY key`);
    return NextResponse.json({ ok: true, settings: result.rows });
  } catch (error) {
    return NextResponse.json({ ok: false, settings: [], error: error instanceof Error ? error.message : 'Failed to load settings.' }, { status: 503 });
  }
}
