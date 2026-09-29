import type { ChannelDirection, ChannelRelationship, ChannelSnapshot, ChannelStatus, ChannelTimeframe } from './types';

export const TIMEFRAMES: ChannelTimeframe[] = ['Y', 'Q', 'MN', 'W', 'D1', 'H8', 'H1'];
export const TF_LABEL: Record<ChannelTimeframe, string> = {
  Y: 'Yearly',
  Q: 'Quarterly',
  MN: 'Monthly',
  W: 'Weekly',
  D1: 'Daily',
  H8: '8 Hour',
  H1: '1 Hour',
};
export const GROUP_LABEL = { primary: 'Primary (Y–MN)', intermediate: 'Intermediate (W–D1)', current: 'Current (H8–H1)' };

export const VALID_STATUSES: ChannelStatus[] = ['ACTIVE', 'WEAKENING', 'BROKEN', 'RETESTING'];
export const isValid = (c: ChannelSnapshot | undefined | null) =>
  Boolean(c && VALID_STATUSES.includes(c.status) && c.direction !== 'UNKNOWN');

export const human = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '—');

export function num(v: number | null | undefined, digits = 5): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);
}

export function pct(v: number | null | undefined, d = 0): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}%`;
}

export function atr(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(2)} ATR`;
}

export function age(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Bar times are broker server time (as Stage 1 stores them); they are labelled without timezone conversion so bars match the MT5 terminal. */
export function barTime(ms: number | null | undefined, tf?: ChannelTimeframe): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const date = `${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (tf === 'Y') return String(d.getUTCFullYear());
  if (tf === 'Q') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  if (tf === 'MN') return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (tf === 'W' || tf === 'D1') return date;
  return `${date} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function isoAge(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso.includes('T') || iso.endsWith('Z') ? iso : `${iso.replace(' ', 'T')}Z`) : NaN;
  return Number.isFinite(t) ? `${age((now - t) / 1000)} ago` : '—';
}

export const dirClass = (d?: ChannelDirection | null) => (d ? d.toLowerCase() : 'unknown');
export const dirArrow = (d?: ChannelDirection | null) => (d === 'BULLISH' ? '↗' : d === 'BEARISH' ? '↘' : d === 'RANGE' ? '→' : '·');

export function statusLabel(c: ChannelSnapshot): string {
  if (c.status === 'NO_CHANNEL' || c.status === 'INVALIDATED') return 'NO VALID CHANNEL';
  return c.status;
}

/** Slope of the channel itself; after a break the channel direction follows the break, the geometry does not. */
export const geometryWord = (trend: ChannelDirection) => (trend === 'BULLISH' ? 'ascending' : trend === 'BEARISH' ? 'descending' : 'horizontal');

export function statusTone(s: ChannelStatus): string {
  if (s === 'ACTIVE') return 'good';
  if (s === 'BROKEN' || s === 'INVALIDATED') return 'bad';
  if (s === 'WEAKENING' || s === 'RETESTING') return 'warn';
  if (s === 'FORMING') return 'info';
  return 'muted';
}

export const REL_LABEL: Record<ChannelRelationship, string> = {
  PRIMARY: 'Primary',
  ALIGNED: 'Aligned',
  CORRECTIVE: 'Correction',
  COUNTER_CORRECTION: 'Counter-correction',
  NESTED_CORRECTION: 'Nested correction',
  REVERSAL_CANDIDATE: 'Reversal candidate',
  BREAKOUT: 'Breakout',
  RANGE_INTERNAL: 'Range internal',
  UNRESOLVED: 'Unresolved',
};

export function relTone(r: ChannelRelationship): string {
  if (r === 'PRIMARY' || r === 'ALIGNED') return 'good';
  if (r === 'CORRECTIVE' || r === 'COUNTER_CORRECTION' || r === 'NESTED_CORRECTION') return 'warn';
  if (r === 'REVERSAL_CANDIDATE' || r === 'BREAKOUT') return 'bad';
  if (r === 'RANGE_INTERNAL') return 'info';
  return 'muted';
}

/** Position and boundary distances from the live price when available, otherwise from the last closed candle. */
export function currentView(c: ChannelSnapshot) {
  const live = c.live && c.live.position !== undefined ? c.live : null;
  return {
    position: live ? (live.position ?? null) : c.position,
    distanceUpperAtr: live ? (live.distanceUpperAtr ?? null) : c.distanceUpperAtr,
    distanceLowerAtr: live ? (live.distanceLowerAtr ?? null) : c.distanceLowerAtr,
    price: live ? live.currentPrice : c.currentPrice,
    isLive: Boolean(live),
  };
}
