export const runtime = 'nodejs';

import { getExecutionReadiness } from '@/lib/cacsms-vision-store';

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }): Promise<Response> {
  try {
    const { symbol } = await context.params;
    return Response.json({ ok: true, readiness: await getExecutionReadiness(symbol) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load execution readiness.' }, { status: 500 });
  }
}
