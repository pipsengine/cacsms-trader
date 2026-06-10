import { NextResponse } from 'next/server';

import { getTopDownComparisonState } from '@/lib/image-comparison-store';

export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    const decision = await getTopDownComparisonState(symbol);
    return NextResponse.json({ ok: true, decision }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load top-down comparison state.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
