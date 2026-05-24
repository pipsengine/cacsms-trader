export const runtime = 'nodejs';

import { analyzeCaptureChannels } from '@/lib/channel-detection-store';
import type { ChartCaptureRequest } from '@/lib/visual-intelligence-types';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as ChartCaptureRequest & { captureId?: string };
    const result = await analyzeCaptureChannels(body);
    return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to analyze channels.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
