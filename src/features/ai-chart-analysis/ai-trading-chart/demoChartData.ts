import type { Candle, ChartModel, SupertrendPoint } from './AITradingChart';

const HOUR = 60 * 60 * 1000;
const start = new Date('2026-09-25T00:00:00+01:00').getTime();

function generateCandles(): Candle[] {
  const candles: Candle[] = [];
  let price = 2628;
  for (let i = 0; i < 78; i++) {
    let drift = 0;
    if (i < 34) drift = 0.9;
    else if (i < 54) drift = -0.45;
    else if (i < 68) drift = 0.28;
    else drift = -0.12;
    const wave = Math.sin(i * 0.72) * 2.3 + Math.cos(i * 0.31) * 1.4;
    const open = price;
    const close = open + drift + wave * 0.34;
    const high = Math.max(open, close) + 1.2 + Math.abs(Math.sin(i)) * 1.9;
    const low = Math.min(open, close) - 1.1 - Math.abs(Math.cos(i * 0.8)) * 1.8;
    const volume = 300 + Math.abs(Math.sin(i * 0.47)) * 900 + (i % 17 === 0 ? 1000 : 0);
    candles.push({ time: start + i * HOUR, open, high, low, close, volume, closed: true });
    price = close;
  }
  return candles;
}

const candles = generateCandles();
const supertrend: SupertrendPoint[] = candles.map((candle, index) => ({
  time: candle.time,
  value: index < 42 ? candle.low - 2.4 : candle.high + 2.8,
  direction: index < 42 ? 'BULLISH' : 'BEARISH',
}));
const lastTime = candles[candles.length - 1]!.time;

/** Reference XAUUSD H1 mock — compare live ChartModel against this in dev. */
export const demoChartModel: ChartModel = {
  symbol: 'XAUUSD',
  instrumentName: 'Gold vs US Dollar',
  timeframe: 'H1',
  candles,
  currentPrice: candles[candles.length - 1]!.close,
  timezoneLabel: 'UTC+1',
  supertrend,
  channels: [
    {
      id: 'h1-main-channel',
      direction: 'BULLISH',
      lowerStart: { time: candles[4]!.time, price: 2618 },
      lowerEnd: { time: lastTime + 14 * HOUR, price: 2648 },
      upperStart: { time: candles[0]!.time, price: 2645 },
      upperEnd: { time: lastTime + 14 * HOUR, price: 2684 },
    },
  ],
  zones: [
    {
      id: 'h1-supply',
      type: 'SUPPLY',
      label: 'H1 Supply',
      startTime: candles[39]!.time,
      endTime: lastTime + 6 * HOUR,
      high: 2673,
      low: 2668,
      state: 'ACTIVE',
    },
    {
      id: 'h1-erz',
      type: 'ERZ',
      label: 'H1 ERZ / Demand',
      startTime: candles[58]!.time,
      endTime: lastTime + 14 * HOUR,
      high: 2643,
      low: 2633,
      state: 'REACTION',
    },
  ],
  structures: [
    { id: 'swing-high-3', type: 'SWING_HIGH', time: candles[36]!.time, price: candles[36]!.high, label: '3', sequence: 3, priority: 70 },
    { id: 'choch-1', type: 'CHOCH', time: candles[43]!.time, price: 2645, label: 'CHOCH', direction: 'BEARISH', priority: 90, state: 'CONFIRMED' },
    { id: 'swing-low-4', type: 'SWING_LOW', time: candles[59]!.time, price: 2634, label: '4', sequence: 4, priority: 70 },
    { id: 'bos-1', type: 'BOS', time: candles[64]!.time, price: 2650, label: 'BOS', direction: 'BULLISH', priority: 95, state: 'CONFIRMED' },
    { id: 'swing-high-5', type: 'SWING_HIGH', time: candles[69]!.time, price: 2652, label: '5', sequence: 5, priority: 75 },
  ],
  levels: [
    { id: 'p2', type: 'BREAK', price: 2642.5, label: 'P2 Break', direction: 'BULLISH' },
    { id: 'invalid', type: 'INVALIDATION', price: 2618.4, label: 'Invalidation' },
    { id: 't1', type: 'TARGET', price: 2658.2, label: 'T1' },
    { id: 't2', type: 'TARGET', price: 2670.5, label: 'T2' },
  ],
  projectedScenario: [
    { id: 'scenario-current', time: lastTime, price: 2644, label: 'CURRENT' },
    { id: 'scenario-reaction', time: lastTime + 3 * HOUR, price: 2652, label: 'REACTION' },
    { id: 'scenario-retest', time: lastTime + 5 * HOUR, price: 2645, label: 'RETEST' },
    { id: 'scenario-bos', time: lastTime + 8 * HOUR, price: 2659, label: 'BOS' },
    { id: 'scenario-t1', time: lastTime + 11 * HOUR, price: 2658.2, label: 'T1' },
    { id: 'scenario-t2', time: lastTime + 14 * HOUR, price: 2670.5, label: 'T2' },
  ],
};
