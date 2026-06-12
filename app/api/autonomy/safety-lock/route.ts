export const runtime = 'nodejs';

import { evaluateAutonomySafetyLock } from '@/lib/autonomy-safety-lock';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  const terminalId = url.searchParams.get('terminalId');
  const accountNumber = url.searchParams.get('accountNumber');
  const status = await evaluateAutonomySafetyLock({
    symbol,
    terminalId,
    accountNumber,
    autoActivateKillSwitch: false,
  });
  return Response.json({ ok: true, status }, { headers: { 'Cache-Control': 'no-store' } });
}
