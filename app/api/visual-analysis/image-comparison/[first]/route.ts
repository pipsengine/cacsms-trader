import { NextResponse } from 'next/server';

import { getImageComparison } from '@/lib/image-comparison-store';

export async function GET(_request: Request, { params }: { params: Promise<{ first: string }> }) {
  try {
    const { first } = await params;
    const comparison = await getImageComparison(first);
    if (!comparison) return NextResponse.json({ ok: false, error: 'Comparison not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, comparison });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load image comparison.' },
      { status: 400 },
    );
  }
}
