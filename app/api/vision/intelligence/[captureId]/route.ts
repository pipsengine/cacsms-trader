export const runtime = 'nodejs';

import { getFullVisualIntelligence } from '@/lib/visual-intelligence-orchestrator';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const result = await getFullVisualIntelligence(captureId);
    return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load full visual intelligence analysis.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
