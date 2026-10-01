import { SUPERTREND_TIMEFRAMES, type SupertrendCardSnapshot, type SupertrendSnapshot, type SupertrendTimeframe } from './types';

/** Bridge cache may still expose legacy `YTD` after the UI switched to `Y`. */
export function normalizeSupertrendSnapshot(raw: SupertrendSnapshot): SupertrendSnapshot {
  if (!raw?.cards) {
    return { ...raw, cards: {} as Record<SupertrendTimeframe, SupertrendCardSnapshot> };
  }
  const incoming = raw.cards as Record<string, SupertrendCardSnapshot | undefined>;
  const cards = {} as Record<SupertrendTimeframe, SupertrendCardSnapshot>;
  for (const tf of SUPERTREND_TIMEFRAMES) {
    const hit = incoming[tf];
    if (hit) cards[tf] = hit.timeframe === tf ? hit : { ...hit, timeframe: tf };
  }
  const legacy = incoming.YTD ?? (incoming as Record<string, SupertrendCardSnapshot | undefined>).YTD;
  if (!cards.Y && legacy) {
    cards.Y = { ...legacy, timeframe: 'Y' };
  }
  return { ...raw, cards };
}
