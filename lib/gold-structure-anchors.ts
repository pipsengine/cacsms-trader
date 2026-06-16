import { resolveLatestCaptureId } from '@/lib/capture-analysis-bootstrap';
import { getStructureAnalysis } from '@/lib/structure-analysis-store';
import { analyzeMarketStructure } from '@/lib/structure-analysis-engine';
import { queryPostgres } from '@/lib/postgres';
import type { AutonomousTradeSide } from '@/lib/autonomous-stop-targets';
import { loadRecentCandlesForStructure } from '@/lib/gold-structure-candles';

export type GoldStructureAnchor = {
  price: number;
  weight: number;
  source: string;
  eventType?: string;
  validationScore?: number;
};

export async function loadGoldStructureEntryAnchors(input: {
  symbol: string;
  timeframe: string;
  side: AutonomousTradeSide;
}): Promise<GoldStructureAnchor[]> {
  const symbol = input.symbol.toUpperCase();
  const timeframe = input.timeframe.toUpperCase();
  const anchors: GoldStructureAnchor[] = [];
  const captureId = await resolveLatestCaptureId(symbol, timeframe);

  if (captureId) {
    try {
      const structure = await getStructureAnalysis(captureId);
      for (const event of [...structure.bos, ...structure.choch].slice(-4)) {
        const aligned =
          (input.side === 'BUY' && event.direction === 'bullish') ||
          (input.side === 'SELL' && event.direction === 'bearish');
        if (!aligned || event.validationScore < 0.45) continue;
        anchors.push({
          price: event.priceLevel,
          weight: 0.72 + event.validationScore * 0.35 + (event.eventType === 'CHOCH' ? 0.08 : 0.04),
          source: `${event.eventType.toLowerCase()}_retest`,
          eventType: event.eventType,
          validationScore: event.validationScore,
        });
      }
    } catch {
      // fall through to live analysis
    }

    const fvgRows = await queryPostgres(
      `
        SELECT price_low, price_high, direction, confidence_score
        FROM fair_value_gaps
        WHERE chart_capture_id = $1
        ORDER BY created_at DESC
        LIMIT 6
      `,
      [captureId],
    ).catch(() => ({ rows: [] }));

    for (const row of fvgRows.rows as Array<Record<string, unknown>>) {
      const direction = String(row.direction ?? '').toLowerCase();
      const low = Number(row.price_low ?? 0);
      const high = Number(row.price_high ?? 0);
      if (low <= 0 || high <= 0) continue;
      const mid = (low + high) / 2;
      const quality = Number(row.confidence_score ?? 0.5);
      if (input.side === 'BUY' && direction.includes('bull')) {
        anchors.push({ price: mid, weight: 0.66 + quality * 0.4, source: 'bullish_fvg', validationScore: quality });
      }
      if (input.side === 'SELL' && direction.includes('bear')) {
        anchors.push({ price: mid, weight: 0.66 + quality * 0.4, source: 'bearish_fvg', validationScore: quality });
      }
    }
  }

  const candles = await loadRecentCandlesForStructure(symbol, timeframe);
  if (candles.length >= 12) {
    const live = analyzeMarketStructure(candles, timeframe);
    for (const event of [...live.bos, ...live.choch].slice(-2)) {
      const aligned =
        (input.side === 'BUY' && event.direction === 'bullish') ||
        (input.side === 'SELL' && event.direction === 'bearish');
      if (!aligned) continue;
      if (anchors.some((a) => Math.abs(a.price - event.priceLevel) < 0.05)) continue;
      anchors.push({
        price: event.priceLevel,
        weight: 0.7 + event.validationScore * 0.3,
        source: `live_${event.eventType.toLowerCase()}`,
        eventType: event.eventType,
        validationScore: event.validationScore,
      });
    }
  }

  return anchors.sort((a, b) => b.weight - a.weight);
}
