import type { Instrument } from '../../../types';
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
  quality: 'GOOD' | 'STALE' | 'INVALID' | 'CLOSED';
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

  if (!i.bid || !i.ask) {
    return { symbol: i.symbol, pass: false, reason: 'Missing bid/ask', freshnessSec: fresh, quality: 'INVALID' };
  }
  if (i.ask < i.bid) {
    return { symbol: i.symbol, pass: false, reason: 'Invalid OHLC/tick (ask < bid)', freshnessSec: fresh, quality: 'INVALID' };
  }
  if (fresh != null && fresh > limit) {
    return {
      symbol: i.symbol,
      pass: false,
      reason: marketOpen ? `Stale feed (${fresh}s)` : `No weekend ticks (${fresh}s since last)`,
      freshnessSec: fresh,
      quality: marketOpen ? 'STALE' : 'CLOSED',
    };
  }
  if (i.state === 'BLOCKED') {
    return { symbol: i.symbol, pass: false, reason: 'Instrument state BLOCKED', freshnessSec: fresh, quality: 'INVALID' };
  }
  if (!marketOpen) {
    return { symbol: i.symbol, pass: false, reason: 'FX market closed (weekend)', freshnessSec: fresh, quality: 'CLOSED' };
  }
  return { symbol: i.symbol, pass: true, reason: 'Valid + fresh', freshnessSec: fresh, quality: 'GOOD' };
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
      severity: gate.quality === 'INVALID' ? 'ERROR' : gate.quality === 'STALE' ? 'WARNING' : 'INFO',
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

export function stage1Summary(instruments: Array<Instrument & { lastTickAt?: string }>, now = new Date()) {
  const gates = instruments.map((i) => assessInstrument(i, now));
  const pass = gates.filter((g) => g.pass).length;
  const blocked = gates.filter((g) => !g.pass).length;
  return { gates, pass, blocked, total: gates.length };
}
