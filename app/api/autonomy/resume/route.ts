export const runtime = 'nodejs';

import { resumeAutonomy } from '@/lib/autonomy-store';

export async function POST(): Promise<Response> {
  try {
    return Response.json({ ok: true, ...(await resumeAutonomy()) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to resume autonomy runtime.' }, { status: 500 });
  }
}
