export const runtime = 'nodejs';

import { resumeAutonomy } from '@/lib/autonomy-store';

export async function POST(): Promise<Response> {
  return Response.json({ ok: true, ...(await resumeAutonomy()) }, { headers: { 'Cache-Control': 'no-store' } });
}
