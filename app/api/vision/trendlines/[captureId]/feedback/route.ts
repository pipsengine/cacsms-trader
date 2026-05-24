export const runtime = 'nodejs';

import { createTrendlineFeedback } from '@/lib/trendline-detection-store';

export async function POST(request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const body = await request.json().catch(() => ({})) as {
      trendlineId?: string;
      userId?: string;
      feedbackType?: string;
      correction?: Record<string, unknown>;
      comment?: string;
    };
    const feedback = await createTrendlineFeedback({
      trendlineId: body.trendlineId ?? captureId,
      userId: body.userId,
      feedbackType: body.feedbackType ?? 'confirmed',
      correction: body.correction,
      comment: body.comment,
    });
    return Response.json({ ok: true, feedback }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to store trendline feedback.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
