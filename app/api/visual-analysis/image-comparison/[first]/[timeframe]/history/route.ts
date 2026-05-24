import { NextResponse } from 'next/server';

import { getImageComparisonHistory } from '@/lib/image-comparison-store';

export async function GET(_request: Request, { params }: { params: Promise<{ first: string; timeframe: string }> }) {
  try {
    const { first, timeframe } = await params;
    const history = await getImageComparisonHistory(first, timeframe);
    return NextResponse.json({ ok: true, history });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load image comparison history.' },
      { status: 400 },
    );
  }
}
