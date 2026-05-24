export const runtime = 'nodejs';

import { updateSchedules } from '@/lib/autonomy-store';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    return Response.json({ ok: true, ...(await updateSchedules(body)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to update autonomy schedules.' }, { status: 400 });
  }
}
