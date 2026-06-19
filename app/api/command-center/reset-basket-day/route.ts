export const runtime = 'nodejs';

import { getBasketCapacitySnapshot, resetBasketDayAccounting } from '@/lib/gold-basket-capacity';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const accountNumber = (body as { accountNumber?: string }).accountNumber ?? null;
    const terminalId = (body as { terminalId?: string }).terminalId ?? null;
    const reset = await resetBasketDayAccounting({
      accountNumber,
      terminalId,
      reason: 'command_center_basket_day_reset',
    });
    const basketCapacity = await getBasketCapacitySnapshot({ accountNumber, terminalId });
    return Response.json(
      { ok: true, reset, basketCapacity },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to reset basket day accounting.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
