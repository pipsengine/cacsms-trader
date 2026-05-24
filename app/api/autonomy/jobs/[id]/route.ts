export const runtime = 'nodejs';

import { getAutonomyJob } from '@/lib/autonomy-store';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const job = await getAutonomyJob(id);
    if (!job) return Response.json({ ok: false, error: 'Autonomous job was not found.' }, { status: 404 });
    return Response.json({ ok: true, job }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load autonomous job.' }, { status: 500 });
  }
}
