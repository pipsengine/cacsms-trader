import type { Instrument } from '../../../types';
import type { HistorySeries, HistoryStatusCode } from './historyClient';
import { getInstrumentHistoryGate } from './historyStore';
import { isFxMarketOpen } from './sessions';

export type QualityIssue = {
  id: string;
  symbol: string;
  timeframe: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  reason: string;
  lastValid?: string;
  blocksTrading: boolean;
};

export type Stage1Gate = {
  symbol: string;
  pass: boolean;
  reason: string;
  freshnessSec: number | null;
  quality: 'GOOD' | 'STALE' | 'INVALID' | 'CLOSED' | 'HISTORY';
  history: HistoryStatusCode;
};

const STALE_SEC_OPEN = 120;
const STALE_SEC_CLOSED = 72 * 3600;

export function freshnessSec(iso?: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

export function assessInstrument(i: Instrument & { lastTickAt?: string }, now = new Date()): Stage1Gate {
  const marketOpen = isFxMarketOpen(now);
  const fresh = freshnessSec(i.lastTickAt, now.getTime());
  const limit = marketOpen ? STALE_SEC_OPEN : STALE_SEC_CLOSED;
  const hist = getInstrumentHistoryGate(i.symbol);
  const base = { symbol: i.symbol, freshnessSec: fresh, history: hist.code };

  if (!i.bid || !i.ask) {
    return { ...base, pass: false, reason: 'Missing bid/ask', quality: 'INVALID' };
  }
  if (i.ask < i.bid) {
    return { ...base, pass: false, reason: 'Invalid OHLC/tick (ask < bid)', quality: 'INVALID' };
  }
  if (!hist.pass) {
    return { ...base, pass: false, reason: `History ${hist.code}: ${hist.reason}`, quality: 'HISTORY' };
  }
  if (fresh != null && fresh > limit) {
    return {
      ...base,
      pass: false,
      reason: marketOpen ? `Stale feed (${fresh}s)` : `No weekend ticks (${fresh}s since last)`,
      quality: marketOpen ? 'STALE' : 'CLOSED',
    };
  }
  if (i.state === 'BLOCKED') {
    return { ...base, pass: false, reason: 'Instrument state BLOCKED', quality: 'INVALID' };
  }
  if (!marketOpen) {
    return { ...base, pass: false, reason: 'FX market closed (weekend)', quality: 'CLOSED' };
  }
  return { ...base, pass: true, reason: 'Valid + fresh · history READY', quality: 'GOOD' };
}

export function buildQualityIssues(
  instruments: Array<Instrument & { lastTickAt?: string; spread?: number }>,
  now = new Date(),
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const i of instruments) {
    const gate = assessInstrument(i, now);
    if (gate.quality === 'GOOD') continue;
    issues.push({
      id: `${i.symbol}-${gate.quality}`,
      symbol: i.symbol,
      timeframe: 'TICK',
      severity: gate.quality === 'INVALID' ? 'ERROR' : gate.quality === 'STALE' || gate.quality === 'HISTORY' ? 'WARNING' : 'INFO',
      reason: gate.reason,
      lastValid: i.lastTickAt,
      blocksTrading: !gate.pass && gate.quality !== 'CLOSED',
    });
    if ((i.spread || 0) > 40) {
      issues.push({
        id: `${i.symbol}-spread`,
        symbol: i.symbol,
        timeframe: 'TICK',
        severity: 'WARNING',
        reason: `Excessive spread ${i.spread}`,
        lastValid: i.lastTickAt,
        blocksTrading: true,
      });
    }
  }
  return issues.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Historical series issues produced by the bridge validation engine (the single source for candle quality). */
export function historyQualityIssues(series: HistorySeries[]): QualityIssue[] {
  const out: QualityIssue[] = [];
  for (const s of series) {
    const blocks = s.status !== 'READY';
    const last = s.latestTs != null ? new Date(s.latestTs * 1000).toISOString() : undefined;
    for (const [n, i] of (s.issues || []).entries()) {
      if (i.severity === 'INFO' && !blocks) continue;
      out.push({
        id: `${s.symbol}-${s.timeframe}-${i.code}-${n}`,
        symbol: s.symbol,
        timeframe: s.timeframe,
        severity: i.severity,
        reason: `${i.code}: ${i.message}`,
        lastValid: last,
        blocksTrading: blocks && i.severity !== 'INFO',
      });
    }
    if (blocks && !(s.issues || []).some((i) => i.severity !== 'INFO')) {
      out.push({
        id: `${s.symbol}-${s.timeframe}-${s.status}`,
        symbol: s.symbol,
        timeframe: s.timeframe,
        severity: s.status === 'VALIDATION_FAILED' || s.status === 'PROVIDER_OFFLINE' ? 'ERROR' : 'WARNING',
        reason: `${s.status}: ${s.reason || 'not ready'}`,
        lastValid: last,
        blocksTrading: true,
      });
    }
  }
  return out;
}

/** Instrument state after Stage 1 fail-closed: anything without valid+fresh data cannot be READY. */
export function gatedState(i: Instrument & { lastTickAt?: string }, now = new Date()): Instrument['state'] {
  return assessInstrument(i, now).pass ? i.state : 'BLOCKED';
}

export function stage1Summary(instruments: Array<Instrument & { lastTickAt?: string }>, now = new Date()) {
  const gates = instruments.map((i) => assessInstrument(i, now));
  const pass = gates.filter((g) => g.pass).length;
  const blocked = gates.filter((g) => !g.pass).length;
  return { gates, pass, blocked, total: gates.length };
}
