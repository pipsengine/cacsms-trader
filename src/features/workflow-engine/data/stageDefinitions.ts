export type StageDefinition = {
  id: number;
  name: string;
  short: string;
  description: string;
  deps: number[];
  /** Latency target for one engine run (Stage 1: feed round-trip, Stage 9: MT5 ping). null = not measured for this stage. */
  slaLatencyMs: number | null;
  /** Maximum age of the stage's last published run before it is considered stale. */
  slaFreshnessSec: number | null;
  slaNote: string;
  triggers: string[];
  invalidation: string[];
};

export const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    id: 1,
    name: 'Market Data & Feed',
    short: 'Data',
    description: 'Validate the MT5 feed and the historical store; nothing downstream may use invalid, stale or incomplete data.',
    deps: [],
    slaLatencyMs: 250,
    slaFreshnessSec: 120,
    slaNote: 'Feed round-trip ≤ 250 ms · tick age ≤ 120 s while the market is open',
    triggers: ['Live ticks', 'M5–MN1 candle closes', 'History sync / repair / validation jobs'],
    invalidation: ['Tick older than 120 s in session', 'ask < bid or missing quote', 'History not READY for a core timeframe', 'MT5 provider offline'],
  },
  {
    id: 2,
    name: 'Currency & XAU Strength',
    short: 'Strength',
    description: 'Basket-relative Q/M/W/D strength for 8 currencies + XAU from closed D1 candles.',
    deps: [1],
    slaLatencyMs: 3000,
    slaFreshnessSec: 180,
    slaNote: 'Shared Stage 2/3 run ≤ 3 s · re-published at least every 3 min',
    triggers: ['D1 / W1 / MN1 close', 'Stage 2/3 refresh (60 s)'],
    invalidation: ['Expected D1 close missing', 'Too few closed observations'],
  },
  {
    id: 3,
    name: 'Historical Regime',
    short: 'Regime',
    description: 'Persistence, acceleration, deterioration and reversal regimes per asset and pair.',
    deps: [2],
    slaLatencyMs: 3000,
    slaFreshnessSec: 180,
    slaNote: 'Run ≤ 3 s · re-published at least every 3 min',
    triggers: ['Stage 2 strength publication', 'D1 / W1 / MN1 close'],
    invalidation: ['Insufficient closed observations', 'Missing D1 history'],
  },
  {
    id: 4,
    name: 'Pair Discovery & Ranking',
    short: 'Scanner',
    description: 'Rank 28 FX pairs + XAUUSD from strength and regime; promote candidates to HTF Market Vision.',
    deps: [1, 2, 3],
    slaLatencyMs: 1000,
    slaFreshnessSec: 900,
    slaNote: 'Re-rank ≤ 1 s · full sweep at least every 15 min',
    triggers: ['Stage 3 run / regime transition', 'Material strength change', 'D1/H8/H1 close', 'Stage 1 freshness change', 'Stage 5 qualification change', '10 min sweep'],
    invalidation: ['Stage 1 not READY', 'Stale strength', 'Conviction below promotion threshold', 'Regime conflict'],
  },
  {
    id: 5,
    name: 'HTF Market Vision',
    short: 'Vision',
    description: 'D1/H8 swings, channels, touches, boundaries, breakouts and confidence for promoted instruments.',
    deps: [1, 4],
    slaLatencyMs: 5000,
    slaFreshnessSec: 1200,
    slaNote: 'Analysis run ≤ 5 s · full sweep at least every 20 min',
    triggers: ['Stage 4 promotion change', 'D1 / H8 close', 'Boundary approach / intrabar breach', 'Volatility spike', '15 min sweep'],
    invalidation: ['Channel BROKEN / INVALIDATED', 'Insufficient D1/H8 bars', 'Stale Stage 1 data'],
  },
  {
    id: 6,
    name: 'Structural Direction',
    short: 'Direction',
    description: 'Fuse scanner bias with D1 authority and H8 phase into a structural direction and H1 hand-off.',
    deps: [4, 5],
    slaLatencyMs: 2000,
    slaFreshnessSec: 600,
    slaNote: 'Decision run ≤ 2 s · re-evaluated at least every 10 min',
    triggers: ['Stage 5 run', 'Stage 4 promotion change', 'D1 / H8 close', 'Strength / regime change'],
    invalidation: ['D1 channel invalidated', 'H8 reversal against D1', 'Scanner vs structure conflict', 'Stale Stage 5'],
  },
  {
    id: 7,
    name: 'H1 Confirmation',
    short: 'H1',
    description: 'H1 HH/HL/LH/LL, BOS, CHoCH, momentum and pullback confirmation of the Stage 6 direction.',
    deps: [1, 6],
    slaLatencyMs: 3000,
    slaFreshnessSec: 600,
    slaNote: 'Evaluation ≤ 3 s · re-evaluated at least every 10 min',
    triggers: ['Stage 6 READY_FOR_H1 change', 'H1 close', 'Live BOS attempt / invalidation breach'],
    invalidation: ['Invalidation level breached', 'H1 structure against direction', 'Setup expired', 'Stale Stage 6'],
  },
  {
    id: 8,
    name: 'Opportunity & Risk',
    short: 'Risk',
    description: 'Setup score, correlation, currency exposure, margin and per-account risk; issues Stage 9 authorizations.',
    deps: [7],
    slaLatencyMs: 2000,
    slaFreshnessSec: 600,
    slaNote: 'Risk run ≤ 2 s · re-evaluated at least every 10 min',
    triggers: ['Stage 7 confirmation change', 'H1 close', 'Price / spread move', 'Account equity / margin / positions', 'Config or trading change', '5 min sweep'],
    invalidation: ['Risk / correlation / exposure / margin / prop limits', 'Authorization expiry', 'Stale Stage 7'],
  },
  {
    id: 9,
    name: 'Execution & Position Management',
    short: 'Execution',
    description: 'Central engine: revalidate authorizations, submit to MT5, manage SL/TP/trailing/partial exits, reconcile.',
    deps: [8],
    slaLatencyMs: 250,
    slaFreshnessSec: 60,
    slaNote: 'MT5 ping ≤ 250 ms · engine cycle published at least every 60 s',
    triggers: ['Stage 8 authorization', '2 s engine cycle', 'Control change', 'MT5 connect / disconnect', 'Operator exit'],
    invalidation: ['Emergency stop', 'Trading or analysis paused', 'Execution disabled', 'MT5 disconnected / reconciliation pending', 'Revalidation failure', 'Authorization expired'],
  },
  {
    id: 10,
    name: 'Learning, Audit & Feedback',
    short: 'Learning',
    description: 'Closed-trade records, attribution and calibration feedback published from Stage 9.',
    deps: [9],
    slaLatencyMs: null,
    slaFreshnessSec: 60,
    slaNote: 'Trade records published within one engine cycle of the close',
    triggers: ['Stage 9 trade close'],
    invalidation: ['Trade record not published', 'Missing deal evidence'],
  },
];

export const stageName = (id: number) => STAGE_DEFINITIONS.find((d) => d.id === id)?.name ?? `Stage ${id}`;
