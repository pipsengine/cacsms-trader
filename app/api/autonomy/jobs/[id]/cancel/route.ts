export const runtime = 'nodejs';

import { cancelAutonomyJob } from '@/lib/autonomy-store';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    return Response.json({ ok: true, job: await cancelAutonomyJob(id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to cancel autonomous job.' }, { status: 400 });
  }
}
