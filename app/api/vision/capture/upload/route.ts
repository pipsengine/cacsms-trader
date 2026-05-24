export const runtime = 'nodejs';

import { createUploadCapture, payloadFromRequest } from '@/lib/chart-capture-intelligence';

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await payloadFromRequest(request);
    const capture = await createUploadCapture(input);
    return Response.json({ ok: true, capture }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to upload chart capture.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
