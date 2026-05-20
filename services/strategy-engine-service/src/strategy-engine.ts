import type { MarketScanResult, TradeIntent } from "../../../packages/shared-types";

export type StrategyFamily = "smc" | "ict" | "price_action" | "trend_following" | "breakout" | "mean_reversion" | "news_aware";

export interface StrategySignal {
  strategyId: string;
  family: StrategyFamily;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reasons: string[];
}

export interface StrategyContext {
  accountNumber: string;
  terminalId: string;
  market: MarketScanResult;
  newsBlocked: boolean;
  now?: Date;
}

export class StrategyEngine {
  readonly strategyCatalog: StrategyFamily[] = [
    "smc",
    "ict",
    "price_action",
    "trend_following",
    "breakout",
    "mean_reversion",
    "news_aware",
  ];

  selectHybridAIStrategy(context: StrategyContext): StrategyFamily {
    if (context.newsBlocked) return "news_aware";
    if (context.market.condition === "trending") return "trend_following";
    if (context.market.condition === "volatile") return "breakout";
    if (context.market.condition === "ranging") return "mean_reversion";
    return "price_action";
  }

  generateSignal(context: StrategyContext): StrategySignal | null {
    if (!context.market.tradable) return null;
    const family = this.selectHybridAIStrategy(context);
    const side = context.market.condition === "trending" ? "buy" : "sell";

    return {
      strategyId: `${family}-${context.market.symbol}`,
      family,
      symbol: context.market.symbol,
      side,
      entryPrice: 0,
      stopLoss: 0,
      takeProfit: 0,
      confidence: context.market.setupScore,
      reasons: [`${family} selected by hybrid AI strategy selector`, ...context.market.reasons],
    };
  }

  toTradeIntent(signal: StrategySignal, context: StrategyContext, riskAmount: number, rewardRiskRatio: number): TradeIntent {
    return {
      intentId: `${signal.strategyId}-${context.now?.getTime() ?? Date.now()}`,
      terminalId: context.terminalId,
      accountNumber: context.accountNumber,
      symbol: signal.symbol,
      side: signal.side,
      orderKind: "market",
      requestedVolumeLots: 0,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      strategyId: signal.strategyId,
      setupScore: signal.confidence,
      riskAmount,
      rewardRiskRatio,
      createdAt: (context.now ?? new Date()).toISOString(),
    };
  }
}
