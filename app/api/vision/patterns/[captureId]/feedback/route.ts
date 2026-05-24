export const runtime = 'nodejs';

import { createPatternFeedback } from '@/lib/pattern-recognition-store';

export async function POST(request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const body = await request.json().catch(() => ({})) as {
      patternResultId?: string;
      userId?: string;
      feedbackType?: string;
      correction?: Record<string, unknown>;
      comment?: string;
    };
    const feedback = await createPatternFeedback({
      patternResultId: body.patternResultId ?? captureId,
      userId: body.userId,
      feedbackType: body.feedbackType ?? 'confirmed',
      correction: body.correction,
      comment: body.comment,
    });
    return Response.json({ ok: true, feedback }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to store pattern feedback.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
