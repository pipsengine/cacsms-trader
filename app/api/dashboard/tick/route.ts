export const runtime = 'nodejs';

import { getCommandCenterTick } from '@/lib/command-center-tick';

export async function GET(): Promise<Response> {
  try {
    return Response.json(
      { ok: true, tick: await getCommandCenterTick({ syncHeartbeats: false, includePositionDetails: false }) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load dashboard tick.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
