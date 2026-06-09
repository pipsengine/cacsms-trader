export const runtime = 'nodejs';

import { getCommandCenterOverview } from '@/lib/command-center-overview';

export async function GET(): Promise<Response> {
  try {
    return Response.json(
      { ok: true, overview: await getCommandCenterOverview() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load system overview.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
