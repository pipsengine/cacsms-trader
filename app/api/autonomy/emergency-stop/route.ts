export const runtime = 'nodejs';

import { emergencyStopAutonomy } from '@/lib/autonomy-store';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    return Response.json({ ok: true, ...(await emergencyStopAutonomy(typeof body.reason === 'string' ? body.reason : undefined)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to stop autonomy runtime.' }, { status: 500 });
  }
}
