export const runtime = 'nodejs';

import { getAutonomyHealth } from '@/lib/autonomy-store';

export async function GET(): Promise<Response> {
  try {
    return Response.json({ ok: true, ...(await getAutonomyHealth()) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load autonomy health.' }, { status: 500 });
  }
}
