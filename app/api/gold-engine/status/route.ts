import { NextResponse } from 'next/server';
import { getGoldEngineStatus, isGoldOnlyTradingEngine } from '@/lib/gold-trading-engine';
import { SYSTEM_FOCUS_SYMBOLS } from '@/lib/focus-symbols';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      goldOnly: isGoldOnlyTradingEngine(),
      focusSymbols: [...SYSTEM_FOCUS_SYMBOLS],
      engine: getGoldEngineStatus(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
