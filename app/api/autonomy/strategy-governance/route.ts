export const runtime = 'nodejs';

import { listStrategyGovernance } from '@/lib/strategy-governance';

export async function GET(): Promise<Response> {
  const strategies = await listStrategyGovernance();
  return Response.json({ ok: true, strategies }, { headers: { 'Cache-Control': 'no-store' } });
}
