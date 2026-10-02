import { demoModel } from '../v3-e2e/data/chartData';
import type { AutonomousSnapshot } from '../v3-e2e/types/autonomous';

/** Reference XAUUSD H1 snapshot for #/ai-chart-mock (v4 compositor). */
export const demoAutonomousSnapshot: AutonomousSnapshot = {
  schemaVersion: 1,
  analysisId: 'ACA-XAUUSD-MOCK-v4',
  symbol: demoModel.symbol,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  primaryTimeframe: demoModel.timeframe,
  lifecycle: 'SETUP_DEVELOPING',
  marketState: 'PULLBACK',
  direction: 'BULLISH',
  structure: 'HH → HL',
  evidenceScore: 78,
  primaryThesis: {
    type: 'PRIMARY',
    title: 'Bullish continuation (pullback)',
    summary:
      'D1 and H8 remain structurally bullish. H1 is pulling back toward the active ERZ and lower channel region. Initial bullish reaction is present but M15 structural confirmation is still absent.',
    invalidationReason: 'Break below invalidation',
  },
  timeframes: [
    { timeframe: 'YTD', direction: 'BULLISH', marketState: 'TRENDING', evidenceScore: 85, closedBarTime: Date.now() },
    { timeframe: 'Q', direction: 'BULLISH', marketState: 'TRENDING', evidenceScore: 82, closedBarTime: Date.now() },
    { timeframe: 'MN', direction: 'BULLISH', marketState: 'TRENDING', evidenceScore: 80, closedBarTime: Date.now() },
    { timeframe: 'W', direction: 'BULLISH', marketState: 'PULLBACK', evidenceScore: 78, closedBarTime: Date.now() },
    { timeframe: 'D1', direction: 'BULLISH', marketState: 'PULLBACK', evidenceScore: 76, closedBarTime: Date.now() },
    { timeframe: 'H8', direction: 'BULLISH', marketState: 'PULLBACK', evidenceScore: 74, closedBarTime: Date.now() },
    { timeframe: 'H1', direction: 'NEUTRAL', marketState: 'PULLBACK', evidenceScore: 68, closedBarTime: Date.now() },
    { timeframe: 'M15', direction: 'NEUTRAL', marketState: 'REVERSAL_DEVELOPING', evidenceScore: 63, closedBarTime: Date.now() },
    { timeframe: 'M5', direction: 'BULLISH', marketState: 'BREAKOUT_DEVELOPING', evidenceScore: 61, closedBarTime: Date.now() },
  ],
  evidence: [
    { id: 's1', kind: 'SUPPORTING', source: 'AI', text: 'D1 bullish structure', observedAt: Date.now() },
    { id: 's2', kind: 'SUPPORTING', source: 'AI', text: 'H8 ascending channel', observedAt: Date.now() },
    { id: 'c1', kind: 'CONFLICTING', source: 'AI', text: 'M15 remains structurally bearish', observedAt: Date.now() },
    { id: 'm1', kind: 'MISSING', source: 'AI', text: 'M15 bullish BOS', observedAt: Date.now() },
  ],
  tradability: [],
  reconciliation: 'PARTIAL',
  engineStates: {
    channel: 'Ascending',
    supertrend: 'Bullish',
    strength: 'USD weakening',
    opportunity: 'Lower half of ascending channel\nApproaching H1 ERZ / Demand',
    p1p2: 'P2 pending',
    confirmation: 'Stage 6',
  },
  chart: {
    candles: demoModel.candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    })),
    supertrend: demoModel.supertrend.flatMap((s) =>
      s.points.map((p) => ({
        time: p.time,
        value: p.price,
        direction: (s.tone === 'bear' ? 'BEARISH' : 'BULLISH') as 'BULLISH' | 'BEARISH',
      })),
    ),
    channels: [
      {
        id: 'ch0',
        upper: demoModel.channel.upper.map((p) => ({ time: p.time, price: p.price })),
        lower: demoModel.channel.lower.map((p) => ({ time: p.time, price: p.price })),
        median: demoModel.channel.mid?.map((p) => ({ time: p.time, price: p.price })),
      },
    ],
    zones: demoModel.zones.map((z) => ({
      id: z.id,
      kind: z.tone === 'supply' ? ('SUPPLY' as const) : ('ERZ' as const),
      label: z.label,
      from: z.from,
      to: z.to,
      high: z.high,
      low: z.low,
    })),
    annotations: demoModel.markers.map((m) => ({
      id: m.id,
      kind:
        m.tone === 'number'
          ? m.number === 3 || (m.number ?? 0) % 2 === 1
            ? ('SWING_HIGH' as const)
            : ('SWING_LOW' as const)
          : m.tone === 'choch'
            ? ('CHOCH' as const)
            : ('BOS' as const),
      time: m.time,
      price: m.price,
      label: m.label,
      priority: 80,
    })),
    levels: demoModel.levels
      .filter((l) => l.tone !== 'price')
      .map((l) => ({
        id: l.id,
        kind:
          l.tone === 'target' ? ('TARGET' as const) : l.tone === 'invalid' ? ('INVALIDATION' as const) : ('BREAK' as const),
        price: l.price,
        label: l.label,
      })),
    scenario: demoModel.scenario.map((p, i) => ({
      id: `sc-${i}`,
      time: p.time,
      price: p.price,
      label: '',
      state: 'PROJECTED' as const,
    })),
  },
};
