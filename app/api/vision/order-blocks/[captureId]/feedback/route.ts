export const runtime = 'nodejs';

import { createOrderBlockFeedback } from '@/lib/order-block-detection-store';

export async function POST(request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const body = await request.json().catch(() => ({})) as {
      orderBlockId?: string;
      userId?: string;
      feedbackType?: string;
      correction?: Record<string, unknown>;
      comment?: string;
    };
    const feedback = await createOrderBlockFeedback({
      orderBlockId: body.orderBlockId ?? captureId,
      userId: body.userId,
      feedbackType: body.feedbackType ?? 'confirmed',
      correction: body.correction,
      comment: body.comment,
    });
    return Response.json({ ok: true, feedback }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to store order block feedback.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
