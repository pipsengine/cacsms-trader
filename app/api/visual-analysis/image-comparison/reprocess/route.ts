import { NextResponse } from 'next/server';

import { reprocessImageComparison } from '@/lib/image-comparison-store';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const comparisonId = String(body.comparisonId ?? '');
    if (!comparisonId) throw new Error('comparisonId is required.');
    const payload = await reprocessImageComparison({ comparisonId });
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to reprocess image comparison.' },
      { status: 400 },
    );
  }
}
