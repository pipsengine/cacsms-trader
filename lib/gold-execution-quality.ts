import { telemetryForSymbol } from '@/lib/mt5-symbol-telemetry';
import {
  goldMaxSpreadPoints,
  goldMaxTickAgeSeconds,
  goldSessionPriority,
  isGoldSymbol,
} from '@/lib/gold-trading-engine';
import { detectTradingSession, is24HourTradingEnabled } from '@/lib/trading-session-policy';

export type GoldExecutionQualityResult = {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  metrics: {
    spreadPoints: number | null;
    tickAgeSeconds: number | null;
    session: string;
    sessionPriority: number;
    tradable: boolean;
    sessionOpen: boolean;
  };
};

async function loadTerminalTelemetry(): Promise<unknown | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/terminals`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const terminals = Array.isArray(payload.terminals) ? payload.terminals : [];
    const connected = terminals.filter((row: { status?: string }) => String(row?.status ?? '').toLowerCase() === 'connected');
    return connected[0] ?? null;
  } catch {
    return null;
  }
}

/** Live Gold mid price from connected terminal telemetry (for re-entry / retracement checks). */
export async function resolveGoldLivePrice(symbol: string): Promise<number | null> {
  if (!isGoldSymbol(symbol)) return null;
  const terminal = await loadTerminalTelemetry();
  if (!terminal) return null;
  const row = telemetryForSymbol(terminal, symbol);
  if (!row || row.stale) return null;
  const bid = Number(row.bid);
  const ask = Number(row.ask);
  if (Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0) {
    return Number(((bid + ask) / 2).toFixed(2));
  }
  if (Number.isFinite(bid) && bid > 0) return bid;
  if (Number.isFinite(ask) && ask > 0) return ask;
  return null;
}

export async function evaluateGoldExecutionQuality(symbol: string): Promise<GoldExecutionQualityResult> {
  if (!isGoldSymbol(symbol)) {
    return {
      ok: true,
      blockers: [],
      warnings: [],
      metrics: { spreadPoints: null, tickAgeSeconds: null, session: 'n/a', sessionPriority: 0, tradable: true, sessionOpen: true },
    };
  }

  const blockers: string[] = [];
  const warnings: string[] = [];
  const session = detectTradingSession(new Date(), symbol);
  const sessionPriority = goldSessionPriority(session);
  const terminal = await loadTerminalTelemetry();
  const row = terminal ? telemetryForSymbol(terminal, symbol) : null;
  const spreadPoints = row?.spreadPoints ?? null;
  const tickAgeSeconds = row?.tickAgeSeconds ?? null;
  const tradable = row?.tradable ?? false;
  const sessionOpen = row?.sessionOpen ?? false;

  const maxSpread = goldMaxSpreadPoints();
  if (spreadPoints != null && spreadPoints > maxSpread) {
    blockers.push(`Gold spread ${Math.round(spreadPoints)} pts exceeds max ${maxSpread} pts.`);
  } else if (spreadPoints == null && terminal) {
    warnings.push('Gold spread telemetry unavailable — using conservative checks only.');
  }

  const maxTickAge = goldMaxTickAgeSeconds();
  if (tickAgeSeconds != null && tickAgeSeconds > maxTickAge) {
    blockers.push(`Gold tick feed is stale (${Math.round(tickAgeSeconds)}s > ${maxTickAge}s).`);
  }

  if (terminal && !tradable) {
    blockers.push('Gold symbol is not tradable on the connected terminal.');
  }

  if (!is24HourTradingEnabled() && !sessionOpen && session === 'closed') {
    blockers.push('Gold session is closed and 24h trading is disabled.');
  } else if (sessionPriority < 50 && session === 'closed') {
    warnings.push('Gold liquidity may be reduced outside primary sessions.');
  }

  if (row?.stale) {
    blockers.push('Gold price feed marked stale by terminal telemetry.');
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    metrics: {
      spreadPoints,
      tickAgeSeconds,
      session,
      sessionPriority,
      tradable,
      sessionOpen,
    },
  };
}
