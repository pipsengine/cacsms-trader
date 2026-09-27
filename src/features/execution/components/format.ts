export { classTone, dirTone, human, lots, money, num, pct, px, until } from '../../opportunity-risk/components/format';

export function duration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  if (m < 1) return `${Math.round(sec)}s`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const since = (ts: string | null | undefined, now = Date.now()) => (ts && Number.isFinite(Date.parse(ts)) ? duration((now - Date.parse(ts)) / 1000) : '—');

export const stamp = (ts: string | null | undefined) => (ts && Number.isFinite(Date.parse(ts)) ? new Date(ts).toLocaleString() : '—');

export const signed = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);
