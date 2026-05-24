export const runtime = 'nodejs';

import { analyzeCaptureSwings } from '@/lib/swing-point-store';
import type { ChartCaptureRequest } from '@/lib/visual-intelligence-types';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as ChartCaptureRequest & {
      captureId?: string;
      depths?: number[];
      atrMultiplier?: number;
      zigzagPercent?: number;
    };
    const result = await analyzeCaptureSwings(body);
    return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to analyze swing points.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
