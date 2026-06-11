import type { Candle, MarketCondition, MarketScanResult, TickSnapshot, TradingSession } from "../../../packages/shared-types";
import {
  detectTradingSession,
  is24HourTradingEnabled,
  isTradingSessionTradable,
} from "../../../lib/trading-session-policy";

export interface MarketIntelligenceInput {
  symbols: string[];
  ticks: TickSnapshot[];
  candlesBySymbol: Record<string, Candle[]>;
  now?: Date;
  allow24HourTrading?: boolean;
}

export class MarketIntelligenceEngine {
  selectPairs(input: MarketIntelligenceInput): string[] {
    return input.symbols.filter((symbol) => {
      const tick = input.ticks.find((candidate) => candidate.symbol === symbol);
      return tick ? tick.spreadPoints <= 35 : false;
    });
  }

  detectSession(now = new Date(), symbol?: string): TradingSession {
    return detectTradingSession(now, symbol);
  }

  detectVolatility(candles: Candle[]): number {
    if (candles.length < 2) return 0;
    const ranges = candles.slice(-20).map((candle) => Math.abs(candle.high - candle.low));
    const averageRange = ranges.reduce((sum, range) => sum + range, 0) / ranges.length;
    const lastClose = candles[candles.length - 1]?.close ?? 1;
    return clampScore((averageRange / lastClose) * 10000);
  }

  scanLiquidity(tick?: TickSnapshot): number {
    if (!tick) return 0;
    return clampScore(100 - tick.spreadPoints * 2);
  }

  classifyTrendOrRange(candles: Candle[]): MarketCondition {
    if (candles.length < 10) return "ranging";
    const recent = candles.slice(-10);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const move = Math.abs(last.close - first.open);
    const range = Math.max(...recent.map((candle) => candle.high)) - Math.min(...recent.map((candle) => candle.low));

    if (range === 0) return "illiquid";
    return move / range > 0.55 ? "trending" : "ranging";
  }

  scoreMarketCondition(
    symbol: string,
    tick: TickSnapshot | undefined,
    candles: Candle[],
    now = new Date(),
    allow24HourTrading = is24HourTradingEnabled(),
  ): MarketScanResult {
    const session = this.detectSession(now, symbol);
    const sessionTradable = isTradingSessionTradable(session, { symbol, now, continuousMode: allow24HourTrading });
    const volatilityScore = this.detectVolatility(candles);
    const liquidityScore = this.scanLiquidity(tick);
    const condition = liquidityScore < 30 ? "illiquid" : volatilityScore > 75 ? "volatile" : this.classifyTrendOrRange(candles);
    const setupScore = Math.round((volatilityScore * 0.35) + (liquidityScore * 0.4) + (sessionTradable ? 20 : 0));
    const hasCandleContext = candles.length >= 10;
    const tradable = hasCandleContext
      ? setupScore >= 55 && condition !== "illiquid" && sessionTradable
      : liquidityScore >= 45 && condition !== "illiquid" && sessionTradable;

    return {
      symbol,
      condition,
      session,
      volatilityScore,
      liquidityScore,
      setupScore: clampScore(setupScore),
      tradable,
      reasons: buildMarketReasons(condition, session, liquidityScore, volatilityScore),
      scannedAt: now.toISOString(),
    };
  }

  scan(input: MarketIntelligenceInput): MarketScanResult[] {
    const now = input.now ?? new Date();
    const allow24HourTrading = input.allow24HourTrading ?? is24HourTradingEnabled();
    return input.symbols.map((symbol) => this.scoreMarketCondition(
      symbol,
      input.ticks.find((tick) => tick.symbol === symbol),
      input.candlesBySymbol[symbol] ?? [],
      now,
      allow24HourTrading,
    ));
  }
}

function buildMarketReasons(condition: MarketCondition, session: TradingSession, liquidityScore: number, volatilityScore: number): string[] {
  const reasons = [`${condition} market`, `${session} session`];
  if (liquidityScore < 30) reasons.push("spread/liquidity below threshold");
  if (volatilityScore > 75) reasons.push("elevated volatility detected");
  return reasons;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
