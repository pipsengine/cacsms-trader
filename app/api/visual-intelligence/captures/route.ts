export const runtime = 'nodejs';

import { createCaptureAndRunAnalysis, listCaptures } from '@/lib/visual-intelligence-store';
import type { ChartCaptureRequest } from '@/lib/visual-intelligence-types';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
    const captures = await listCaptures(limit);
    return Response.json({ ok: true, captures }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to list visual intelligence captures.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as ChartCaptureRequest;
    const result = await createCaptureAndRunAnalysis(body);
    return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to process visual intelligence capture.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
