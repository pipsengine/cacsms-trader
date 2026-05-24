export const runtime = 'nodejs';

import { listSchedules } from '@/lib/autonomy-store';

export async function GET(): Promise<Response> {
  try {
    return Response.json({ ok: true, schedules: await listSchedules() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load autonomy schedules.' }, { status: 500 });
  }
}
