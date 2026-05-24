export const runtime = 'nodejs';

import { getLatestFullVisualIntelligence } from '@/lib/visual-intelligence-orchestrator';

export async function GET(): Promise<Response> {
  try {
    const result = await getLatestFullVisualIntelligence();
    return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load latest visual intelligence analysis.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
