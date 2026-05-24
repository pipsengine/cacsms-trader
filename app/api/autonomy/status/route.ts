export const runtime = 'nodejs';

import { getAutonomyStatus } from '@/lib/autonomy-store';

export async function GET(): Promise<Response> {
  try {
    return Response.json({ ok: true, status: await getAutonomyStatus() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load autonomy status.' }, { status: 500 });
  }
}
