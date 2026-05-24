export const runtime = 'nodejs';

import { listAutonomyJobs } from '@/lib/autonomy-store';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    return Response.json({ ok: true, jobs: await listAutonomyJobs(limit) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load autonomy jobs.' }, { status: 500 });
  }
}
