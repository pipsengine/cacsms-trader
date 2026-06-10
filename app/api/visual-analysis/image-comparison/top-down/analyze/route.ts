import { NextResponse } from 'next/server';

import { compareTopDownSymbol } from '@/lib/image-comparison-store';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ ok: false, error: 'Symbol is required.' }, { status: 400 });
    }
    const decision = await compareTopDownSymbol(symbol);
    return NextResponse.json({ ok: true, decision });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Top-down image comparison failed.' },
      { status: 400 },
    );
  }
}
