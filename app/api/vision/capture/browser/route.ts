export const runtime = 'nodejs';

import { createBrowserCapture } from '@/lib/chart-capture-intelligence';

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await request.json().catch(() => ({}));
    if (!input || typeof input.url !== 'string') {
      return Response.json({ ok: false, error: 'Browser capture requires a url.' }, { status: 400 });
    }
    const capture = await createBrowserCapture(input);
    return Response.json({ ok: true, capture }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to capture browser chart.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
