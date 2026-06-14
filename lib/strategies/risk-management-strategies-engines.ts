import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { atr, ema } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rocPct(candles: StrategyPriceCandle[], bars: number): number {
  const closes = candles.map((item) => item.close);
  const last = closes.length - 1;
  const start = closes[Math.max(0, last - bars)]!;
  return start !== 0 ? ((closes[last]! - start) / start) * 100 : 0;
}

function drawdownPct(candles: StrategyPriceCandle[], lookback: number): number {
  const window = candles.slice(-lookback);
  const peak = Math.max(...window.map((item) => item.high));
  const lastClose = window.at(-1)!.close;
  return peak !== 0 ? ((peak - lastClose) / peak) * 100 : 0;
}

function riskGatedTrendSignal(
  candles: StrategyPriceCandle[],
  trendBars: number,
  maxDrawdownPct: number,
  maxVolRatio: number,
): { bias: StrategyBias; decision: StrategySignalSide; drawdown: number; volRatio: number; trendRoc: number } {
  const closes = candles.map((item) => item.close);
  const lastIndex = candles.length - 1;
  const trendMa = ema(closes, trendBars)[lastIndex];
  const last = candles[lastIndex]!;
  const trendRoc = rocPct(candles, trendBars);
  const dd = drawdownPct(candles, trendBars);
  const atrSeries = atr(candles, 14);
  const atrNow = atrSeries[lastIndex] ?? 0;
  const atrBase = atrSeries[Math.max(0, lastIndex - trendBars)] ?? atrNow;
  const volRatio = atrBase > 0 ? atrNow / atrBase : 1;
  const riskOk = dd <= maxDrawdownPct && volRatio <= maxVolRatio;
  let bias: StrategyBias = trendRoc > 0 ? 'bullish' : trendRoc < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (riskOk && trendRoc > 0 && last.close > (trendMa ?? last.close) && last.close > last.open) decision = 'buy';
  if (riskOk && trendRoc < 0 && last.close < (trendMa ?? last.close) && last.close < last.open) decision = 'sell';
  if (!riskOk) bias = 'neutral';
  return { bias, decision, drawdown: dd, volRatio, trendRoc };
}

export const evaluateFixedLotStrategyEngine: StrategyEngine = (candles, config, context) => {
  const trendBars = Math.max(20, parseNumber(config.trendBars, 34));
  const maxDrawdownPct = parseNumber(config.maxDrawdownPct, 2.5);
  const maxVolRatio = parseNumber(config.maxVolRatio, 1.5);
  const { bias, decision, drawdown, volRatio, trendRoc } = riskGatedTrendSignal(candles, trendBars, maxDrawdownPct, maxVolRatio);
  return buildEvaluationResult({
    strategyId: 'fixed-lot-strategy',
    context,
    config: { ...config, trendBars, maxDrawdownPct, maxVolRatio },
    candles,
    decision,
    bias,
    confidence: 30 + (decision !== 'wait' ? 32 : 0) + (drawdown <= maxDrawdownPct ? 10 : 0),
    reasons: ['Fixed lot strategy — constant size with drawdown/vol gate', `Drawdown ${drawdown.toFixed(2)}% · vol ${volRatio.toFixed(2)}×`, decision !== 'wait' ? 'Risk gate passed — trend entry' : 'Risk gate blocked entry'],
    metrics: { drawdownPct: Number(drawdown.toFixed(3)), volRatio: Number(volRatio.toFixed(3)), trendRocPct: Number(trendRoc.toFixed(3)) },
  });
};

export const evaluatePercentageRiskModelEngine: StrategyEngine = (candles, config, context) => {
  const riskPct = parseNumber(config.riskPct, 1);
  const trendBars = Math.max(20, parseNumber(config.trendBars, 30));
  const maxDrawdownPct = riskPct * 3;
  const maxVolRatio = parseNumber(config.maxVolRatio, 1.4);
  const { bias, decision, drawdown, volRatio } = riskGatedTrendSignal(candles, trendBars, maxDrawdownPct, maxVolRatio);
  return buildEvaluationResult({
    strategyId: 'percentage-risk-model',
    context,
    config: { ...config, riskPct, trendBars, maxVolRatio },
    candles,
    decision,
    bias,
    confidence: 31 + (decision !== 'wait' ? 30 : 0),
    reasons: [`Percentage risk model — ${riskPct}% equity risk per trade`, `Max drawdown gate ${maxDrawdownPct.toFixed(1)}% · current ${drawdown.toFixed(2)}%`, decision !== 'wait' ? 'Sized trend entry allowed' : 'Risk budget exceeded — wait'],
    metrics: { riskPct, drawdownPct: Number(drawdown.toFixed(3)), volRatio: Number(volRatio.toFixed(3)) },
  });
};

export const evaluateKellyCriterionEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const minEdge = parseNumber(config.minEdge, 0.08);
  const window = candles.slice(-lookback);
  let wins = 0;
  let losses = 0;
  for (let index = 1; index < window.length; index += 1) {
    const move = window[index]!.close - window[index - 1]!.close;
    if (move > 0) wins += 1;
    else if (move < 0) losses += 1;
  }
  const total = wins + losses;
  const winRate = total > 0 ? wins / total : 0.5;
  const edge = winRate - (1 - winRate);
  const kellyFraction = Math.max(0, edge);
  const { bias, decision, trendRoc } = riskGatedTrendSignal(candles, lookback, 3, 1.6);
  const kellyOk = kellyFraction >= minEdge;
  const finalDecision: StrategySignalSide = kellyOk ? decision : 'wait';
  return buildEvaluationResult({
    strategyId: 'kelly-criterion',
    context,
    config: { ...config, lookback, minEdge },
    candles,
    decision: finalDecision,
    bias: kellyOk ? bias : 'neutral',
    confidence: 32 + (finalDecision !== 'wait' ? 30 : 0) + Math.min(16, kellyFraction * 40),
    reasons: ['Kelly criterion — win-rate edge sizing gate', `Win rate ${(winRate * 100).toFixed(1)}% · Kelly edge ${kellyFraction.toFixed(3)}`, finalDecision !== 'wait' ? 'Kelly edge sufficient — entry' : 'Kelly edge below threshold'],
    metrics: { winRate: Number(winRate.toFixed(3)), kellyEdge: Number(kellyFraction.toFixed(3)), trendRocPct: Number(trendRoc.toFixed(3)) },
  });
};

export const evaluateVolatilityPositionSizingEngine: StrategyEngine = (candles, config, context) => {
  const atrPeriod = Math.max(7, parseNumber(config.atrPeriod, 14));
  const targetAtrPct = parseNumber(config.targetAtrPct, 0.35);
  const trendBars = Math.max(15, parseNumber(config.trendBars, 28));
  const atrSeries = atr(candles, atrPeriod);
  const last = candles[candles.length - 1]!;
  const atrNow = atrSeries[candles.length - 1] ?? 0;
  const atrPct = last.close !== 0 ? (atrNow / last.close) * 100 : 0;
  const sizeOk = atrPct <= targetAtrPct * 1.5;
  const { bias, decision, trendRoc } = riskGatedTrendSignal(candles, trendBars, 2.5, 2);
  const finalDecision: StrategySignalSide = sizeOk ? decision : 'wait';
  return buildEvaluationResult({
    strategyId: 'volatility-position-sizing',
    context,
    config: { ...config, atrPeriod, targetAtrPct, trendBars },
    candles,
    decision: finalDecision,
    bias: sizeOk ? bias : 'neutral',
    confidence: 33 + (finalDecision !== 'wait' ? 30 : 0),
    reasons: ['Volatility position sizing — inverse ATR size gate', `ATR ${atrPct.toFixed(3)}% vs target ${targetAtrPct}%`, finalDecision !== 'wait' ? 'Vol-adjusted entry allowed' : 'Vol too high for sizing model'],
    metrics: { atrPct: Number(atrPct.toFixed(3)), trendRocPct: Number(trendRoc.toFixed(3)) },
  });
};

export const evaluateDynamicRiskAllocationEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 36));
  const maxDrawdownPct = parseNumber(config.maxDrawdownPct, 2);
  const volLookback = Math.max(10, parseNumber(config.volLookback, 20));
  const dd = drawdownPct(candles, lookback);
  const atrSeries = atr(candles, 14);
  const lastIndex = candles.length - 1;
  const volChange = (atrSeries[lastIndex] ?? 0) - (atrSeries[Math.max(0, lastIndex - volLookback)] ?? 0);
  const riskBudget = Math.max(0, maxDrawdownPct - dd);
  const { bias, decision, volRatio } = riskGatedTrendSignal(candles, lookback, maxDrawdownPct, 1.35);
  const finalDecision: StrategySignalSide = riskBudget > 0.3 && volChange <= 0 ? decision : 'wait';
  return buildEvaluationResult({
    strategyId: 'dynamic-risk-allocation',
    context,
    config: { ...config, lookback, maxDrawdownPct, volLookback },
    candles,
    decision: finalDecision,
    bias: finalDecision !== 'wait' ? bias : 'neutral',
    confidence: 32 + (finalDecision !== 'wait' ? 32 : 0),
    reasons: ['Dynamic risk allocation — remaining drawdown budget', `Risk budget ${riskBudget.toFixed(2)}% · vol ratio ${volRatio.toFixed(2)}×`, finalDecision !== 'wait' ? 'Dynamic allocation entry' : 'Risk budget depleted or vol rising'],
    metrics: { riskBudgetPct: Number(riskBudget.toFixed(3)), drawdownPct: Number(dd.toFixed(3)) },
  });
};

export const evaluateEquityCurveManagementEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(25, parseNumber(config.lookback, 50));
  const minSlopePct = parseNumber(config.minSlopePct, 0.05);
  const closes = candles.map((item) => item.close);
  const equityProxy = closes.slice(-lookback);
  const slope = equityProxy.length >= 2 ? ((equityProxy.at(-1)! - equityProxy[0]!) / equityProxy[0]!) * 100 : 0;
  const rising = slope >= minSlopePct;
  const falling = slope <= -minSlopePct;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = rising ? 'bullish' : falling ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (rising && last.close > last.open) decision = 'buy';
  if (falling && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'equity-curve-management',
    context,
    config: { ...config, lookback, minSlopePct },
    candles,
    decision,
    bias,
    confidence: 33 + (decision !== 'wait' ? 30 : 0) + Math.min(14, Math.abs(slope) * 15),
    reasons: ['Equity curve management — proxy slope gate', `Equity proxy slope ${slope.toFixed(2)}%`, decision === 'buy' ? 'Rising equity curve — add risk long' : decision === 'sell' ? 'Falling equity curve — reduce via short bias' : 'Flat equity curve — wait'],
    metrics: { equitySlopePct: Number(slope.toFixed(3)) },
  });
};

export const evaluatePortfolioRiskBalancingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const maxConcentration = parseNumber(config.maxConcentration, 0.65);
  const returns: number[] = [];
  for (let index = 1; index < candles.slice(-lookback).length; index += 1) {
    const prev = candles[candles.length - lookback + index - 1]!.close;
    returns.push(prev !== 0 ? (candles[candles.length - lookback + index]!.close - prev) / prev : 0);
  }
  const positive = returns.filter((value) => value > 0).length;
  const concentration = returns.length > 0 ? Math.max(positive, returns.length - positive) / returns.length : 0.5;
  const balanced = concentration <= maxConcentration;
  const { bias, decision, trendRoc } = riskGatedTrendSignal(candles, lookback, 2.2, 1.45);
  const finalDecision: StrategySignalSide = balanced ? decision : 'wait';
  return buildEvaluationResult({
    strategyId: 'portfolio-risk-balancing',
    context,
    config: { ...config, lookback, maxConcentration },
    candles,
    decision: finalDecision,
    bias: balanced ? bias : 'neutral',
    confidence: 31 + (finalDecision !== 'wait' ? 30 : 0),
    reasons: ['Portfolio risk balancing — return concentration gate', `Direction concentration ${(concentration * 100).toFixed(0)}%`, finalDecision !== 'wait' ? 'Balanced book — trend entry' : 'Concentration too high — wait'],
    metrics: { concentration: Number(concentration.toFixed(3)), trendRocPct: Number(trendRoc.toFixed(3)) },
  });
};

export const evaluateDrawdownProtectionEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 45));
  const maxDrawdownPct = parseNumber(config.maxDrawdownPct, 1.8);
  const dd = drawdownPct(candles, lookback);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (dd >= maxDrawdownPct && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (dd < maxDrawdownPct * 0.5 && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  }
  return buildEvaluationResult({
    strategyId: 'drawdown-protection',
    context,
    config: { ...config, lookback, maxDrawdownPct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 0),
    reasons: ['Drawdown protection — defensive de-risk trigger', `Drawdown ${dd.toFixed(2)}% vs max ${maxDrawdownPct}%`, decision === 'sell' ? 'Drawdown breach — protective short' : decision === 'buy' ? 'Drawdown recovered — re-risk long' : 'Drawdown within band'],
    metrics: { drawdownPct: Number(dd.toFixed(3)) },
  });
};

export const evaluateDailyLossLimitStrategyEngine: StrategyEngine = (candles, config, context) => {
  const sessionBars = Math.max(8, parseNumber(config.sessionBars, 16));
  const maxLossPct = parseNumber(config.maxLossPct, 1.2);
  const session = candles.slice(-sessionBars);
  const sessionStart = session[0]!.close;
  const sessionLoss = sessionStart !== 0 ? ((sessionStart - session.at(-1)!.close) / sessionStart) * 100 : 0;
  const limitBreached = sessionLoss >= maxLossPct;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (!limitBreached && last.close > last.open && session.at(-1)!.close > sessionStart) {
    bias = 'bullish';
    decision = 'buy';
  } else if (limitBreached) {
    bias = 'bearish';
    decision = 'sell';
  }
  return buildEvaluationResult({
    strategyId: 'daily-loss-limit-strategy',
    context,
    config: { ...config, sessionBars, maxLossPct },
    candles,
    decision,
    bias,
    confidence: 33 + (decision !== 'wait' ? 30 : 0),
    reasons: ['Daily loss limit — session P&L proxy gate', `Session move ${sessionLoss.toFixed(2)}% vs limit ${maxLossPct}%`, limitBreached ? 'Daily loss limit hit — stand down / hedge' : decision === 'buy' ? 'Within limit — session long ok' : 'Session flat — wait'],
    metrics: { sessionLossPct: Number(sessionLoss.toFixed(3)) },
  });
};
