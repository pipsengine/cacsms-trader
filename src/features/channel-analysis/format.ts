import type { ChannelDirection, ChannelRelationship, ChannelSnapshot, ChannelStatus, ChannelTimeframe } from './types';

/** Canonical hierarchy, same order as channel_analysis.TIMEFRAMES (guarded by test_channel_windows). Never sort. */
export const TIMEFRAMES: ChannelTimeframe[] = ['Y', 'YTD', 'HY', 'Q', 'MN', 'W', 'D1', 'H8', 'H1'];
export const TF_LABEL: Record<ChannelTimeframe, string> = {
  Y: 'Yearly',
  YTD: 'Year to Date',
  HY: '6 Months',
  Q: 'Quarterly',
  MN: 'Monthly',
  W: 'Weekly',
  D1: 'Daily',
  H8: '8 Hour',
  H1: '1 Hour',
};
/** Card titles as shown on the Channel Analysis design. */
export const TF_TITLE: Record<ChannelTimeframe, string> = {
  Y: 'Yearly (1Y)',
  YTD: 'Year to Date',
  HY: '6 Months',
  Q: 'Quarterly (3M)',
  MN: 'Monthly (1M)',
  W: 'Weekly (1W)',
  D1: 'Daily (1D)',
  H8: '8 Hours',
  H1: '1 Hour',
};
export const TF_HELP: Partial<Record<ChannelTimeframe, string>> = {
  YTD: 'Channel structure from the start of the current year through the latest available market data.',
  HY: 'Rolling six-month channel structure ending at the latest available market data.',
};
export const GROUP_LABEL = { primary: 'Primary (Y·Q·MN)', intermediate: 'Intermediate (W–D1)', current: 'Current (H8–H1)', context: 'Context (YTD·HY)' };

/** YTD/HY are strategic context: displayed and related, never counted in the scored hierarchy. */
export const isContext = (c: ChannelSnapshot | undefined | null) => c?.hierarchyRole === 'CONTEXT';

/** Same set as channel_analysis.VALID_STATUSES / vision.CONFIRMED_STATUSES (guarded by test_channel_windows). */
export const VALID_STATUSES: ChannelStatus[] = ['VALIDATED', 'ACTIVE', 'WEAKENING', 'BROKEN', 'RETESTING'];
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

export function slopeText(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4;
  return v.toFixed(d);
}

export function signed(v: number, digits: number): string {
  const n = v.toFixed(digits);
  return v > 0 ? `+${n}` : n;
}

const FLAGS: Record<string, string> = {
  EUR: '🇪🇺',
  USD: '🇺🇸',
  GBP: '🇬🇧',
  JPY: '🇯🇵',
  AUD: '🇦🇺',
  NZD: '🇳🇿',
  CAD: '🇨🇦',
  CHF: '🇨🇭',
  XAU: '🥇',
};

export function instrumentFlag(symbol: string): string {
  const base = symbol.toUpperCase().startsWith('XAU') ? 'XAU' : symbol.slice(0, 3).toUpperCase();
  return FLAGS[base] ?? '◆';
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
  if (tf === 'W' || tf === 'D1' || tf === 'YTD' || tf === 'HY') return date;
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
  if (s === 'ACTIVE' || s === 'VALIDATED') return 'good';
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

const REL_PHASE: Record<ChannelRelationship, string> = {
  PRIMARY: 'PRIMARY',
  ALIGNED: 'CONTINUATION',
  CORRECTIVE: 'CORRECTION',
  COUNTER_CORRECTION: 'COUNTER-CORRECTION',
  NESTED_CORRECTION: 'NESTED CORRECTION',
  REVERSAL_CANDIDATE: 'REVERSAL',
  BREAKOUT: 'BREAKOUT',
  RANGE_INTERNAL: 'RANGE',
  UNRESOLVED: 'UNRESOLVED',
};

/** Footer phase: primary keeps the engine phase; extremes read as near resistance/support; otherwise the hierarchy role. */
export function displayPhase(c: ChannelSnapshot): string {
  if (!isValid(c)) return c.status === 'FORMING' ? 'FORMING' : 'NONE';
  if (c.relationship === 'PRIMARY' || isContext(c)) return human(c.phase).toUpperCase();
  const pos = currentView(c).position;
  if (pos != null && c.direction === 'BULLISH' && pos >= 80) return 'NEAR RESISTANCE';
  if (pos != null && c.direction === 'BEARISH' && pos <= 20) return 'NEAR SUPPORT';
  return REL_PHASE[c.relationship];
}

export function phaseTone(label: string): string {
  const s = label.toUpperCase();
  if (s === 'NONE' || s === 'FORMING' || s === 'UNKNOWN' || s === 'UNRESOLVED') return 'muted';
  if (s.includes('COUNTER')) return 'info';
  if (s.includes('NESTED') || s.includes('CORRECTION') || s.includes('PULLBACK') || s.includes('REVERSAL') || s.includes('BREAK')) return 'bad';
  if (s.includes('RESIST') || s.includes('SUPPORT') || s.includes('RANGE')) return 'warn';
  return 'good';
}

const TREND_CAPTION: Record<ChannelRelationship, string> = {
  PRIMARY: 'Primary Trend',
  ALIGNED: 'Continuation',
  CORRECTIVE: 'Correction',
  COUNTER_CORRECTION: 'Counter-Corr.',
  NESTED_CORRECTION: 'Nested Corr.',
  REVERSAL_CANDIDATE: 'Reversal',
  BREAKOUT: 'Breakout',
  RANGE_INTERNAL: 'Range',
  UNRESOLVED: 'Unresolved',
};

export function trendCaption(c: ChannelSnapshot): string {
  if (!isValid(c)) return 'No channel';
  if (isContext(c)) return c.relationship === 'PRIMARY' ? 'Context' : TREND_CAPTION[c.relationship];
  if (c.relationship === 'PRIMARY') return 'Primary Trend';
  const pos = currentView(c).position;
  if (pos != null && c.direction === 'BULLISH' && pos >= 80) return 'Near Resistance';
  if (pos != null && c.direction === 'BEARISH' && pos <= 20) return 'Near Support';
  return TREND_CAPTION[c.relationship];
}

/** Meter and position colour: direction, with amber when price is pressed into the far boundary. */
export function posTone(direction: ChannelDirection, position: number | null): string {
  if (position != null && ((direction === 'BULLISH' && position >= 80) || (direction === 'BEARISH' && position <= 20))) return 'warn';
  if (direction === 'BEARISH') return 'bad';
  if (direction === 'RANGE') return 'warn';
  if (direction === 'BULLISH') return 'good';
  return '';
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
