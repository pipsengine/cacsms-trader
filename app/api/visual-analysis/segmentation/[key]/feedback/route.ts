export const runtime = 'nodejs';

import { createSegmentFeedback } from '@/lib/chart-segmentation-store';

export async function POST(request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  try {
    const { key } = await context.params;
    const body = await request.json().catch(() => ({}));
    const feedback = await createSegmentFeedback({
      segmentId: key,
      feedbackType: typeof body.feedbackType === 'string' ? body.feedbackType : 'reviewed',
      correction: body.correction && typeof body.correction === 'object' ? body.correction : undefined,
      comment: typeof body.comment === 'string' ? body.comment : undefined,
      userId: typeof body.userId === 'string' ? body.userId : undefined,
    });
    return Response.json({ ok: true, feedback }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to record segment feedback.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
