import { MarketIntelligenceEngine } from '@/services/market-intelligence-engine';

import { getLatestPairSelection } from '@/lib/pair-selector';

import { telemetryForSymbol } from '@/lib/mt5-symbol-telemetry';

import { detectTradingSession, is24HourTradingEnabled } from '@/lib/trading-session-policy';

import type { TickSnapshot } from '@/packages/shared-types';

import type { StyleFitnessContext, StyleFitnessResult, TradingStyleId } from './types';

import { getEnabledTradingStyles, getTradingStyleProfile } from './registry';

import { scoreInstitutionalMtfConfluence } from './mtf-confluence';



const engine = new MarketIntelligenceEngine();



function clamp(value: number, min: number, max: number) {

  return Math.max(min, Math.min(max, value));

}



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



function buildTicksFromTelemetry(symbols: string[], terminal: unknown): TickSnapshot[] {

  return symbols.map((symbol) => {

    const row = terminal ? telemetryForSymbol(terminal, symbol) : null;

    const spreadPoints = row?.spreadPoints ?? 40;

    return {

      symbol: symbol.toUpperCase(),

      bid: row?.bid ?? 0,

      ask: row?.ask ?? 0,

      spreadPoints,
      serverTime: row?.receivedAt ?? new Date().toISOString(),
      receivedAt: row?.receivedAt ?? new Date().toISOString(),
    };

  });

}



async function buildSymbolContextMap(symbols: string[]): Promise<Map<string, Omit<StyleFitnessContext, 'symbol'>>> {

  const normalized = symbols.map((symbol) => symbol.toUpperCase());

  const [selection, terminal] = await Promise.all([

    getLatestPairSelection(),

    loadTerminalTelemetry(),

  ]);

  const candidateMap = new Map(

    (selection?.candidates ?? []).map((candidate) => [candidate.symbol.toUpperCase(), candidate]),

  );

  const ticks = buildTicksFromTelemetry(normalized, terminal);

  const scans = engine.scan({

    symbols: normalized,

    ticks,

    candlesBySymbol: {},

    now: new Date(),

    allow24HourTrading: is24HourTradingEnabled(),

  });

  const scanMap = new Map(scans.map((scan) => [scan.symbol.toUpperCase(), scan]));



  const contextMap = new Map<string, Omit<StyleFitnessContext, 'symbol'>>();

  for (const symbol of normalized) {

    const candidate = candidateMap.get(symbol);

    const scan = scanMap.get(symbol);

    const telemetry = terminal ? telemetryForSymbol(terminal, symbol) : null;

    const session = candidate?.session ?? detectTradingSession(new Date(), symbol);

    contextMap.set(symbol, {

      spreadPoints: telemetry?.spreadPoints ?? ticks.find((tick) => tick.symbol === symbol)?.spreadPoints ?? 30,

      volatilityScore: scan?.volatilityScore ?? candidate?.setupScore ?? 50,

      liquidityScore: scan?.liquidityScore ?? candidate?.liquidityScore ?? 55,

      session,

      macroRiskScore: candidate ? clamp(100 - candidate.macroScore, 0, 100) : 45,

      mtfAlignmentScore: 50,

      mtfConflictCount: 0,

    });

  }

  return contextMap;

}



function styleFitness(styleId: TradingStyleId, context: StyleFitnessContext): StyleFitnessResult {

  const profile = getTradingStyleProfile(styleId);

  const reasons: string[] = [];

  let score = 40;



  if (context.spreadPoints > profile.maxSpreadPoints) {

    return {

      styleId,

      symbol: context.symbol,

      fitnessScore: 0,

      eligible: false,

      reasons: [`Spread ${context.spreadPoints} pts exceeds ${profile.label} max ${profile.maxSpreadPoints}`],

      entryTimeframe: profile.entryTimeframe,

    };

  }



  score += Math.min(18, context.liquidityScore * 0.18);

  score += Math.min(12, context.mtfAlignmentScore * 0.12);

  score -= context.mtfConflictCount * 6;

  score -= Math.max(0, context.macroRiskScore - 55) * 0.2;



  if (styleId === 'scalp') {

    if (['overlap', 'london', 'new_york'].includes(context.session)) score += 14;

    if (context.volatilityScore >= 55) score += 10;

    if (context.volatilityScore < 35) score -= 12;

    reasons.push('Scalp model favors liquid session volatility and tight spreads.');

  }



  if (styleId === 'intraday') {

    if (context.volatilityScore >= 45) score += 8;

    if (context.mtfAlignmentScore >= 60) score += 10;

    reasons.push('Intraday model uses M15 trigger with H1/H4 institutional alignment.');

  }



  if (styleId === 'day_trade') {

    if (['london', 'new_york', 'overlap'].includes(context.session)) score += 10;

    if (context.mtfAlignmentScore >= 55) score += 8;

    reasons.push('Day trade model targets session-bound continuation with MTF agreement.');

  }



  if (styleId === 'swing') {

    if (context.volatilityScore <= 70) score += 8;

    if (context.mtfAlignmentScore >= 65) score += 12;

    if (context.macroRiskScore > 70) score -= 10;

    reasons.push('Swing model requires H4/D structure and controlled macro risk.');

  }



  if (styleId === 'position') {

    if (context.macroRiskScore <= 50) score += 12;

    if (context.mtfAlignmentScore >= 70) score += 14;

    if (context.volatilityScore > 80) score -= 8;

    reasons.push('Position model weights macro/COT/rates and weekly-daily structure.');

  }



  const fitnessScore = Math.round(clamp(score, 0, 100));

  return {

    styleId,

    symbol: context.symbol,

    fitnessScore,

    eligible: fitnessScore >= profile.confidenceFloor - 8,

    reasons,

    entryTimeframe: profile.entryTimeframe,

  };

}



export async function buildStyleFitnessMatrix(symbols: string[]): Promise<StyleFitnessResult[]> {

  const styles = getEnabledTradingStyles();

  const results: StyleFitnessResult[] = [];

  const contextMap = await buildSymbolContextMap(symbols);



  for (const symbol of symbols) {

    const baseContext = contextMap.get(symbol.toUpperCase());

    const session = baseContext?.session ?? detectTradingSession(new Date(), symbol);

    const mtf = await scoreInstitutionalMtfConfluence(symbol);

    const context: StyleFitnessContext = {

      symbol: symbol.toUpperCase(),

      spreadPoints: baseContext?.spreadPoints ?? 25,

      volatilityScore: baseContext?.volatilityScore ?? 50,

      liquidityScore: baseContext?.liquidityScore ?? 55,

      session,

      macroRiskScore: baseContext?.macroRiskScore ?? 45,

      mtfAlignmentScore: mtf.alignmentScore,

      mtfConflictCount: mtf.conflictCount,

    };

    for (const profile of styles) {

      results.push(styleFitness(profile.id, context));

    }

  }



  return results.sort((a, b) => b.fitnessScore - a.fitnessScore);

}



export function pickStyleCandidates(

  matrix: StyleFitnessResult[],

  maxTotal: number,

): StyleFitnessResult[] {

  const picked: StyleFitnessResult[] = [];

  const usedSymbolStyle = new Set<string>();



  for (const row of matrix) {

    if (!row.eligible) continue;

    const key = `${row.symbol}:${row.styleId}`;

    if (usedSymbolStyle.has(key)) continue;

    const styleCount = picked.filter((item) => item.styleId === row.styleId).length;

    const profile = getTradingStyleProfile(row.styleId);

    if (styleCount >= profile.maxEntriesPerCycle) continue;

    picked.push(row);

    usedSymbolStyle.add(key);

    if (picked.length >= maxTotal) break;

  }



  return picked;

}

