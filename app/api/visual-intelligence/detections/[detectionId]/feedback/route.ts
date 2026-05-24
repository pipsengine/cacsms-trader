export const runtime = 'nodejs';

import { createFeedback } from '@/lib/visual-intelligence-store';

export async function POST(request: Request, context: { params: Promise<{ detectionId: string }> }): Promise<Response> {
  try {
    const { detectionId } = await context.params;
    const body = await request.json().catch(() => ({})) as {
      userId?: string;
      feedbackType?: string;
      correction?: Record<string, unknown>;
      comment?: string;
    };
    const feedback = await createFeedback({
      detectionId,
      userId: body.userId,
      feedbackType: body.feedbackType ?? 'confirmed',
      correction: body.correction,
      comment: body.comment,
    });
    return Response.json({ ok: true, feedback }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to store visual intelligence feedback.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
