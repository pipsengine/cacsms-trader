import { getSymbolMultiTimeframe } from '@/lib/multi-timeframe-analysis-store';

export interface InstitutionalMtfConfluence {
  symbol: string;
  alignmentScore: number;
  conflictCount: number;
  dominantBias: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  tradable: boolean;
  reasons: string[];
}

function normalizeBias(value: unknown): 'bullish' | 'bearish' | 'neutral' {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('bull')) return 'bullish';
  if (text.includes('bear')) return 'bearish';
  return 'neutral';
}

export async function scoreInstitutionalMtfConfluence(symbol: string): Promise<InstitutionalMtfConfluence> {
  const mtf = await getSymbolMultiTimeframe(symbol.toUpperCase()).catch(() => null);
  if (!mtf) {
    return {
      symbol: symbol.toUpperCase(),
      alignmentScore: 45,
      conflictCount: 0,
      dominantBias: 'neutral',
      tradable: true,
      reasons: ['MTF fusion pending — using neutral institutional prior.'],
    };
  }

  const alignments = mtf.alignments ?? [];
  const conflicts = mtf.conflicts ?? [];
  const snapshots = mtf.snapshots ?? [];
  const alignmentScore = alignments.length
    ? Math.round(alignments.reduce((sum, row) => sum + Number(row.alignmentScore ?? 0), 0) / alignments.length)
    : Number(mtf.decision?.confidenceScore ?? 50);
  const conflictCount = conflicts.length;
  const biases = snapshots.map((row) => normalizeBias(row.bias ?? row.decisionState));
  const bullish = biases.filter((bias) => bias === 'bullish').length;
  const bearish = biases.filter((bias) => bias === 'bearish').length;
  const dominantBias = bullish > bearish + 1
    ? 'bullish'
    : bearish > bullish + 1
      ? 'bearish'
      : bullish > 0 && bearish > 0
        ? 'mixed'
        : 'neutral';

  const reasons = [
    `MTF alignment score ${alignmentScore}`,
    conflictCount > 0 ? `${conflictCount} timeframe conflict(s) detected` : 'No major timeframe conflicts',
    `Dominant institutional bias: ${dominantBias}`,
  ];

  return {
    symbol: symbol.toUpperCase(),
    alignmentScore: Math.max(0, Math.min(100, alignmentScore - conflictCount * 8)),
    conflictCount,
    dominantBias,
    tradable: alignmentScore >= 40 && conflictCount <= 2,
    reasons,
  };
}
