export const runtime = 'nodejs';

import { getJob } from '@/lib/visual-intelligence-store';

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }): Promise<Response> {
  try {
    const { jobId } = await context.params;
    const job = await getJob(jobId);
    if (!job) {
      return Response.json({ ok: false, error: 'Job not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true, job }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load visual intelligence job.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
