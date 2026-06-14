import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { atr, ema, rsi } from './indicators';

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

function trendMomentumFusion(candles: StrategyPriceCandle[], trendBars: number, momentumBars: number): {
  bias: StrategyBias;
  decision: StrategySignalSide;
  trendRoc: number;
  momentum: number;
} {
  const closes = candles.map((item) => item.close);
  const trendMa = ema(closes, trendBars)[closes.length - 1];
  const last = candles[candles.length - 1]!;
  const trendRoc = rocPct(candles, trendBars);
  const momentum = rocPct(candles, momentumBars);
  let bias: StrategyBias = trendRoc > 0 && momentum > 0 ? 'bullish' : trendRoc < 0 && momentum < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (trendRoc > 0 && momentum > 0 && last.close > (trendMa ?? last.close) && last.close > last.open) decision = 'buy';
  if (trendRoc < 0 && momentum < 0 && last.close < (trendMa ?? last.close) && last.close < last.open) decision = 'sell';
  return { bias, decision, trendRoc, momentum };
}

function liquiditySweep(candles: StrategyPriceCandle[], lookback: number, sweepPct: number): StrategySignalSide {
  const window = candles.slice(-lookback, -1);
  if (window.length === 0) return 'wait';
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (sweepPct / 100);
  if (last.low < rangeLow - buffer && last.close > rangeLow) return 'buy';
  if (last.high > rangeHigh + buffer && last.close < rangeHigh) return 'sell';
  return 'wait';
}

export const evaluateTrendMomentumEngine: StrategyEngine = (candles, config, context) => {
  const trendBars = Math.max(20, parseNumber(config.trendBars, 40));
  const momentumBars = Math.max(8, parseNumber(config.momentumBars, 14));
  const minMomentumPct = parseNumber(config.minMomentumPct, 0.12);
  const { bias, decision, trendRoc, momentum } = trendMomentumFusion(candles, trendBars, momentumBars);
  const finalDecision: StrategySignalSide = Math.abs(momentum) >= minMomentumPct ? decision : 'wait';
  return buildEvaluationResult({
    strategyId: 'trend-momentum',
    context,
    config: { ...config, trendBars, momentumBars, minMomentumPct },
    candles,
    decision: finalDecision,
    bias: finalDecision !== 'wait' ? bias : 'neutral',
    confidence: 36 + (finalDecision !== 'wait' ? 30 : 0),
    reasons: ['Trend + momentum hybrid — dual ROC with EMA filter', `Trend ${trendRoc.toFixed(2)}% · momentum ${momentum.toFixed(2)}%`, finalDecision !== 'wait' ? 'Trend-momentum entry' : 'Momentum below threshold'],
    metrics: { trendRocPct: Number(trendRoc.toFixed(3)), momentumPct: Number(momentum.toFixed(3)) },
  });
};

export const evaluateSmcPriceActionEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const sweepPct = parseNumber(config.sweepPct, 0.05);
  const decision = liquiditySweep(candles, lookback, sweepPct);
  const last = candles[candles.length - 1]!;
  const closes = candles.map((item) => item.close);
  const trendMa = ema(closes, Math.max(15, Math.floor(lookback / 2)))[closes.length - 1];
  let finalDecision: StrategySignalSide = 'wait';
  if (decision === 'buy' && last.close > (trendMa ?? last.close)) finalDecision = 'buy';
  if (decision === 'sell' && last.close < (trendMa ?? last.close)) finalDecision = 'sell';
  return buildEvaluationResult({
    strategyId: 'smc-price-action',
    context,
    config: { ...config, lookback, sweepPct },
    candles,
    decision: finalDecision,
    bias: finalDecision === 'buy' ? 'bullish' : finalDecision === 'sell' ? 'bearish' : 'neutral',
    confidence: 37 + (finalDecision !== 'wait' ? 32 : 0),
    reasons: ['SMC + price action — liquidity sweep with structure filter', decision !== 'wait' ? 'Liquidity sweep detected' : 'No sweep', finalDecision !== 'wait' ? 'SMC price action entry' : 'Sweep without structure confirm'],
    metrics: { sweepDetected: decision !== 'wait' ? 1 : 0 },
  });
};

export const evaluateFundamentalTechnicalEngine: StrategyEngine = (candles, config, context) => {
  const macroBars = Math.max(40, parseNumber(config.macroBars, 60));
  const techBars = Math.max(10, parseNumber(config.techBars, 18));
  const minMacroPct = parseNumber(config.minMacroPct, 0.35);
  const macroRoc = rocPct(candles, macroBars);
  const techRoc = rocPct(candles, techBars);
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (macroRoc >= minMacroPct && techRoc > 0 && last.close > last.open) decision = 'buy';
  if (macroRoc <= -minMacroPct && techRoc < 0 && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'fundamental-technical',
    context,
    config: { ...config, macroBars, techBars, minMacroPct },
    candles,
    decision,
    bias: macroRoc > 0 ? 'bullish' : macroRoc < 0 ? 'bearish' : 'neutral',
    confidence: 34 + (decision !== 'wait' ? 30 : 0),
    reasons: ['Fundamental + technical — slow macro ROC + fast technical confirm', `Macro ${macroRoc.toFixed(2)}% · technical ${techRoc.toFixed(2)}%`, decision !== 'wait' ? 'Fundamental-technical entry' : 'Macro/technical misaligned'],
    metrics: { macroRocPct: Number(macroRoc.toFixed(3)), techRocPct: Number(techRoc.toFixed(3)) },
  });
};

export const evaluateAiTechnicalAnalysisEngine: StrategyEngine = (candles, config, context) => {
  const trendBars = Math.max(15, parseNumber(config.trendBars, 30));
  const rsiPeriod = Math.max(7, parseNumber(config.rsiPeriod, 14));
  const minScore = parseNumber(config.minScore, 0.58);
  const closes = candles.map((item) => item.close);
  const trendMa = ema(closes, trendBars)[closes.length - 1];
  const rsiNow = rsi(closes, rsiPeriod)[closes.length - 1] ?? 50;
  const last = candles[candles.length - 1]!;
  const trendUp = last.close > (trendMa ?? last.close) ? 1 : 0;
  const aiScore = trendUp * 0.5 + (rsiNow / 100) * 0.5;
  let decision: StrategySignalSide = 'wait';
  if (aiScore >= minScore && last.close > last.open) decision = 'buy';
  if (aiScore <= 1 - minScore && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'ai-technical-analysis',
    context,
    config: { ...config, trendBars, rsiPeriod, minScore },
    candles,
    decision,
    bias: aiScore > 0.5 ? 'bullish' : aiScore < 0.5 ? 'bearish' : 'neutral',
    confidence: 33 + (decision !== 'wait' ? 32 : 0),
    reasons: ['AI + technical analysis — EMA trend fused with RSI score', `Fusion score ${aiScore.toFixed(2)}`, decision !== 'wait' ? 'AI-technical entry' : 'Fusion score neutral'],
    metrics: { fusionScore: Number(aiScore.toFixed(3)), rsi: Number(rsiNow.toFixed(1)) },
  });
};

export const evaluateNewsLiquidityEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(10, parseNumber(config.quietBars, 18));
  const spikeMultiple = parseNumber(config.spikeMultiple, 1.6);
  const lookback = Math.max(20, parseNumber(config.lookback, 36));
  const quiet = candles.slice(-lookback, -3);
  const quietAvg = quiet.reduce((sum, item) => sum + (item.high - item.low), 0) / Math.max(quiet.length, 1);
  const last = candles[candles.length - 1]!;
  const lastRange = last.high - last.low;
  const volSpike = quietAvg > 0 && lastRange / quietAvg >= spikeMultiple;
  const sweep = liquiditySweep(candles, lookback, 0.05);
  let decision: StrategySignalSide = 'wait';
  if (volSpike && sweep === 'buy') decision = 'buy';
  if (volSpike && sweep === 'sell') decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'news-liquidity',
    context,
    config: { ...config, quietBars, spikeMultiple, lookback },
    candles,
    decision,
    bias: decision === 'buy' ? 'bullish' : decision === 'sell' ? 'bearish' : 'neutral',
    confidence: 36 + (decision !== 'wait' ? 32 : volSpike ? 8 : 0),
    reasons: ['News + liquidity — vol spike after quiet base with sweep', volSpike ? `Spike ${(lastRange / quietAvg).toFixed(2)}× quiet ATR` : 'No vol spike', decision !== 'wait' ? 'News-liquidity entry' : 'Awaiting news-liquidity confluence'],
    metrics: { spikeRatio: Number((lastRange / Math.max(quietAvg, 0.00001)).toFixed(3)) },
  });
};

export const evaluateScalpingOrderFlowEngine: StrategyEngine = (candles, config, context) => {
  const flowBars = Math.max(4, parseNumber(config.flowBars, 8));
  const minDelta = parseNumber(config.minDelta, 0.15);
  const window = candles.slice(-flowBars);
  let delta = 0;
  for (const candle of window) {
    const range = candle.high - candle.low;
    delta += range > 0 ? (candle.close - candle.open) / range : 0;
  }
  const avgDelta = delta / Math.max(window.length, 1);
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (avgDelta >= minDelta && last.close > last.open) decision = 'buy';
  if (avgDelta <= -minDelta && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'scalping-order-flow',
    context,
    config: { ...config, flowBars, minDelta },
    candles,
    decision,
    bias: avgDelta > 0 ? 'bullish' : avgDelta < 0 ? 'bearish' : 'neutral',
    confidence: 38 + (decision !== 'wait' ? 28 : 0),
    reasons: ['Scalping + order flow — short-window delta proxy', `Order flow delta ${avgDelta.toFixed(3)}`, decision !== 'wait' ? 'Scalp flow entry' : 'Flow delta insufficient'],
    metrics: { orderFlowDelta: Number(avgDelta.toFixed(4)) },
  });
};

export const evaluateSwingMacroAnalysisEngine: StrategyEngine = (candles, config, context) => {
  const macroBars = Math.max(50, parseNumber(config.macroBars, 80));
  const swingBars = Math.max(15, parseNumber(config.swingBars, 25));
  const minMacroPct = parseNumber(config.minMacroPct, 0.45);
  const macroRoc = rocPct(candles, macroBars);
  const swingRoc = rocPct(candles, swingBars);
  const atrSeries = atr(candles, 14);
  const volRatio = (atrSeries[candles.length - 1] ?? 0) / Math.max(atrSeries[Math.max(0, candles.length - swingBars)] ?? 1, 0.00001);
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (Math.abs(macroRoc) >= minMacroPct && macroRoc > 0 && swingRoc > 0 && volRatio <= 1.4 && last.close > last.open) decision = 'buy';
  if (Math.abs(macroRoc) >= minMacroPct && macroRoc < 0 && swingRoc < 0 && volRatio <= 1.4 && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'swing-macro-analysis',
    context,
    config: { ...config, macroBars, swingBars, minMacroPct },
    candles,
    decision,
    bias: macroRoc > 0 ? 'bullish' : macroRoc < 0 ? 'bearish' : 'neutral',
    confidence: 34 + (decision !== 'wait' ? 30 : 0),
    reasons: ['Swing + macro analysis — macro trend with swing confirmation', `Macro ${macroRoc.toFixed(2)}% · swing ${swingRoc.toFixed(2)}%`, decision !== 'wait' ? 'Swing-macro entry' : 'Macro/swing not aligned'],
    metrics: { macroRocPct: Number(macroRoc.toFixed(3)), swingRocPct: Number(swingRoc.toFixed(3)) },
  });
};
