export const runtime = 'nodejs';

import { listDecisionLogs } from '@/lib/autonomy-store';

export async function GET(): Promise<Response> {
  try {
    return Response.json({ ok: true, decisionLogs: await listDecisionLogs() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load decision logs.' }, { status: 500 });
  }
}
