/**
 * Production adapter contract.
 * The page must RECEIVE autonomous analysis state. It must not calculate market truth.
 */
export function normalizeAutonomousSnapshot(raw) {
  if (!raw || !raw.symbol || !raw.chart?.candles?.length) throw new Error('Invalid autonomous snapshot');
  const candles = raw.chart.candles
    .map(c => ({time:+c.time,open:+c.open,high:+c.high,low:+c.low,close:+c.close,volume:+c.volume||0}))
    .filter(c => [c.time,c.open,c.high,c.low,c.close].every(Number.isFinite))
    .sort((a,b)=>a.time-b.time);
  if (!candles.length) throw new Error('No finite OHLC candles');
  return {...raw, chart:{...raw.chart,candles}};
}

/**
 * Instrument-aware formatter. Never format EURUSD like XAUUSD.
 */
export function priceDecimals(symbol, price) {
  if (/JPY$/.test(symbol)) return 3;
  if (symbol === 'XAUUSD' || symbol === 'XAGUSD') return 2;
  if (Math.abs(price) < 10) return 5;
  return 2;
}
export function formatPrice(symbol, price) {
  if (!Number.isFinite(+price)) return '—';
  const d=priceDecimals(symbol,+price);
  return (+price).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
}

/**
 * Safe visible price domain. Candle data is authoritative. Overlays can expand the domain
 * only when they are plausible relative to the current instrument range.
 */
export function buildSafePriceDomain(symbol, candles, overlays=[]) {
  const lows=candles.map(c=>c.low).filter(Number.isFinite), highs=candles.map(c=>c.high).filter(Number.isFinite);
  const baseMin=Math.min(...lows), baseMax=Math.max(...highs), baseRange=Math.max(baseMax-baseMin,Math.abs(baseMax)*0.0005,1e-8);
  const plausible=overlays.map(Number).filter(Number.isFinite).filter(p=>p>=baseMin-baseRange*2.5&&p<=baseMax+baseRange*2.5);
  const lo=Math.min(baseMin,...plausible), hi=Math.max(baseMax,...plausible), range=Math.max(hi-lo,baseRange);
  return {min:lo-range*.08,max:hi+range*.08,rejected:overlays.filter(p=>Number.isFinite(+p)&&!plausible.includes(+p))};
}
