import type { BridgeTick } from '../features/mt5-connection/services/mt5BridgeClient';
import type { Instrument, Position } from '../types';

export type LiveFeedUpdate = {
  ticks?: BridgeTick[];
  positions?: Position[];
  latencyMs?: number;
  at: string;
};

const listeners = new Set<(u: LiveFeedUpdate) => void>();

export function subscribeLiveFeed(cb: (u: LiveFeedUpdate) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function publishLiveFeed(update: Omit<LiveFeedUpdate, 'at'> & { at?: string }) {
  const payload: LiveFeedUpdate = { ...update, at: update.at || new Date().toISOString() };
  listeners.forEach((l) => l(payload));
}

export function mergeTicksIntoInstruments(current: Instrument[], ticks: BridgeTick[]): Instrument[] {
  if (!ticks.length) return current;
  const bySymbol = new Map(current.map((i) => [i.symbol, i]));
  for (const t of ticks) {
    const prev = bySymbol.get(t.symbol);
    const spread = Number((Math.abs(t.ask - t.bid) * (t.symbol.includes('JPY') || t.symbol === 'XAUUSD' ? 100 : 10000)).toFixed(1));
    if (prev) {
      bySymbol.set(t.symbol, {
        ...prev,
        bid: t.bid,
        ask: t.ask,
        spread: spread || prev.spread,
        lastTickAt: t.time || prev.lastTickAt,
      });
    } else {
      bySymbol.set(t.symbol, {
        symbol: t.symbol,
        kind: t.symbol === 'XAUUSD' ? 'GOLD' : 'FX',
        bid: t.bid,
        ask: t.ask,
        spread,
        change: 0,
        d1: 'NEUTRAL',
        h8: 'NEUTRAL',
        h1: 'Waiting',
        score: 0,
        state: 'WAIT',
        strengthDiff: 0,
        channelPos: 50,
        confidence: 0,
        lastTickAt: t.time,
      });
    }
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function mergeEnrichIntoInstruments(
  current: Instrument[],
  rows: Array<{
    symbol: string;
    bid?: number;
    ask?: number;
    spread?: number;
    change?: number;
    d1?: string;
    h8?: string;
    h1?: string;
    score?: number;
    state?: string;
    confidence?: number;
    strengthDiff?: number;
    channelPos?: number;
    time?: string;
  }>,
): Instrument[] {
  const bySymbol = new Map(current.map((i) => [i.symbol, i]));
  for (const r of rows) {
    if (!r.symbol || r.bid == null) continue;
    const prev = bySymbol.get(r.symbol);
    bySymbol.set(r.symbol, {
      symbol: r.symbol,
      kind: r.symbol === 'XAUUSD' ? 'GOLD' : 'FX',
      bid: r.bid,
      ask: r.ask ?? r.bid,
      spread: r.spread ?? prev?.spread ?? 0,
      change: r.change ?? prev?.change ?? 0,
      d1: (r.d1 as Instrument['d1']) || prev?.d1 || 'NEUTRAL',
      h8: (r.h8 as Instrument['h8']) || prev?.h8 || 'NEUTRAL',
      h1: r.h1 || prev?.h1 || 'Waiting',
      score: r.score ?? prev?.score ?? 0,
      state: (r.state as Instrument['state']) || prev?.state || 'WAIT',
      strengthDiff: r.strengthDiff ?? prev?.strengthDiff ?? 0,
      channelPos: r.channelPos ?? prev?.channelPos ?? 50,
      confidence: r.confidence ?? prev?.confidence ?? 0,
      lastTickAt: r.time || prev?.lastTickAt,
    });
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}
