import { priceDigits } from '../../htf-vision/components/VisionChart';

export const human = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '—');

export const num = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));

export const pct = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}%`);

export const px = (v: number | null | undefined, ref?: number | null) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(priceDigits(ref ?? v));

export const money = (v: number | null | undefined, ccy?: string) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${ccy ? ` ${ccy}` : ''}`;

export const lots = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${Number(v.toFixed(2))} lot`);

export function until(ts: string | null | undefined, now = Date.now()) {
  if (!ts) return '—';
  const ms = Date.parse(ts) - now;
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'expired';
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : m >= 1 ? `${m}m left` : `${Math.round(ms / 1000)}s left`;
}

export const dirTone = (d?: string | null) => (d === 'BULLISH' || d === 'BUY' ? 'green' : d === 'BEARISH' || d === 'SELL' ? 'red' : 'gray');

export const classTone = (c?: string | null) => (c === 'LIVE' ? 'red' : c === 'PROP' ? 'amber' : 'blue');

export const GATE_LABELS: Record<string, string> = {
  stage7: 'Stage 7 hand-off',
  confidence: 'Stage 7 confidence',
  expiry: 'Setup lifetime',
  freshness: 'Stage 7 / H1 freshness',
  price: 'Live price',
  spec: 'Broker contract spec',
  atr: 'H1 ATR',
  invalidation: 'Stop-loss vs invalidation',
  stopDistance: 'Stop distance',
  target: 'Structural target',
  drift: 'Setup unchanged (drift)',
  spread: 'Spread / slippage',
  rewardRisk: 'Reward : risk',
  score: 'Setup score',
  setup: 'Setup qualification',
  account: 'Account information',
  symbol: 'Symbol trade mode',
  fx: 'FX conversion',
  openRisk: 'Open-position risk known',
  dailyLoss: 'Daily-loss limit',
  drawdown: 'Drawdown limit',
  concurrency: 'Concurrent positions',
  sameSymbol: 'Same-symbol exposure',
  prop: 'Prop-firm rules',
  headroom: 'Risk headroom',
  sizing: 'Position sizing',
  margin: 'Margin',
  permission: 'Account permission',
  globalSwitch: 'Global trading switch',
  authorization: 'Authorization',
};

/** Account-level gates that decide whether this account may trade, as opposed to whether the setup is technically good. */
export const PERMISSION_GATES = new Set(['permission', 'globalSwitch']);
