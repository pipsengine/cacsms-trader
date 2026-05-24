import { NextResponse } from 'next/server';

import { compareChartImages } from '@/lib/image-comparison-store';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = await compareChartImages({
      symbol: String(body.symbol ?? ''),
      timeframe: String(body.timeframe ?? ''),
      previousImage: body.previousImage,
      currentImage: body.currentImage,
      previousImageUrl: body.previousImageUrl,
      currentImageUrl: body.currentImageUrl,
      previousCaptureId: body.previousCaptureId,
      currentCaptureId: body.currentCaptureId,
      previousCandles: body.previousCandles,
      currentCandles: body.currentCandles,
      previousAnalysis: body.previousAnalysis,
      currentAnalysis: body.currentAnalysis,
    });
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to compare chart images.' },
      { status: 400 },
    );
  }
}
