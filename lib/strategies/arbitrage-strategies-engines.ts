import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { atr, sma } from './indicators';

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

function zScore(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const last = values.at(-1)!;
  return stdDev > 0 ? (last - mean) / stdDev : 0;
}

export const evaluateTriangularArbitrageEngine: StrategyEngine = (candles, config, context) => {
  const legBars = Math.max(4, parseNumber(config.legBars, 8));
  const minMispricePct = parseNumber(config.minMispricePct, 0.18);
  const leg1 = rocPct(candles, legBars);
  const leg2 = rocPct(candles.slice(-legBars * 2), legBars);
  const leg3 = rocPct(candles.slice(-legBars * 3), legBars);
  const loopResidual = leg1 + leg2 - leg3;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = loopResidual > 0 ? 'bullish' : loopResidual < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (Math.abs(loopResidual) >= minMispricePct && loopResidual > 0 && last.close > last.open) {
    decision = 'buy';
  } else if (Math.abs(loopResidual) >= minMispricePct && loopResidual < 0 && last.close < last.open) {
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'triangular-arbitrage',
    context,
    config: { ...config, legBars, minMispricePct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 0) + Math.min(16, Math.abs(loopResidual) * 20),
    reasons: [
      'Triangular arbitrage — synthetic loop residual from staggered ROC legs',
      `Loop residual ${loopResidual.toFixed(3)}% (min ±${minMispricePct}%)`,
      decision === 'buy' ? 'Positive loop misprice — long arb leg' : decision === 'sell' ? 'Negative loop misprice — short arb leg' : 'Loop within fair-value band',
    ],
    metrics: {
      loopResidualPct: Number(loopResidual.toFixed(4)),
      leg1Pct: Number(leg1.toFixed(3)),
    },
  });
};

export const evaluateLatencyArbitrageEngine: StrategyEngine = (candles, config, context) => {
  const fastBars = Math.max(2, parseNumber(config.fastBars, 3));
  const slowBars = Math.max(fastBars + 2, parseNumber(config.slowBars, 12));
  const minGapPct = parseNumber(config.minGapPct, 0.08);
  const fastRoc = rocPct(candles, fastBars);
  const slowRoc = rocPct(candles, slowBars);
  const latencyGap = fastRoc - slowRoc;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = latencyGap > 0 ? 'bullish' : latencyGap < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (latencyGap >= minGapPct && last.close >= last.open) {
    decision = 'buy';
  } else if (latencyGap <= -minGapPct && last.close <= last.open) {
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'latency-arbitrage',
    context,
    config: { ...config, fastBars, slowBars, minGapPct },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 28 : 0) + Math.min(18, Math.abs(latencyGap) * 40),
    reasons: [
      'Latency arbitrage — fast vs slow ROC gap as stale-quote proxy',
      `Latency gap ${latencyGap.toFixed(3)}% (min ±${minGapPct}%)`,
      decision === 'buy' ? 'Fast quote ahead — latency long' : decision === 'sell' ? 'Fast quote behind — latency short' : 'No latency edge',
    ],
    metrics: {
      latencyGapPct: Number(latencyGap.toFixed(4)),
      fastRocPct: Number(fastRoc.toFixed(3)),
    },
  });
};

export const evaluateCrossBrokerArbitrageEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(10, parseNumber(config.lookback, 20));
  const minSpreadPct = parseNumber(config.minSpreadPct, 0.06);
  const window = candles.slice(-lookback);
  const spreads = window.map((item) => {
    const mid = (item.high + item.low) / 2;
    return mid !== 0 ? ((item.close - mid) / mid) * 100 : 0;
  });
  const currentSpread = spreads.at(-1)!;
  const avgSpread = spreads.reduce((sum, value) => sum + value, 0) / spreads.length;
  const deviation = currentSpread - avgSpread;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = deviation > 0 ? 'bullish' : deviation < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (Math.abs(deviation) >= minSpreadPct && deviation > 0) {
    decision = 'sell';
    bias = 'bearish';
  } else if (Math.abs(deviation) >= minSpreadPct && deviation < 0) {
    decision = 'buy';
    bias = 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'cross-broker-arbitrage',
    context,
    config: { ...config, lookback, minSpreadPct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 30 : 0) + Math.min(15, Math.abs(deviation) * 35),
    reasons: [
      'Cross-broker arbitrage — close/mid spread deviation vs rolling average',
      `Spread deviation ${deviation.toFixed(3)}% (min ±${minSpreadPct}%)`,
      decision === 'buy' ? 'Cheap vs venue mid — buy arb' : decision === 'sell' ? 'Rich vs venue mid — sell arb' : 'Cross-venue spread aligned',
    ],
    metrics: {
      spreadDeviationPct: Number(deviation.toFixed(4)),
      currentSpreadPct: Number(currentSpread.toFixed(4)),
    },
  });
};

export const evaluateInterestArbitrageEngine: StrategyEngine = (candles, config, context) => {
  const trendBars = Math.max(30, parseNumber(config.trendBars, 50));
  const minCarryPct = parseNumber(config.minCarryPct, 0.4);
  const maxVolRatio = parseNumber(config.maxVolRatio, 1.35);
  const trendRoc = rocPct(candles, trendBars);
  const atrSeries = atr(candles, 14);
  const lastIndex = candles.length - 1;
  const atrNow = atrSeries[lastIndex] ?? 0;
  const atrBase = atrSeries[Math.max(0, lastIndex - trendBars)] ?? atrNow;
  const volRatio = atrBase > 0 ? atrNow / atrBase : 1;
  const last = candles[lastIndex]!;
  let bias: StrategyBias = trendRoc > 0 ? 'bullish' : trendRoc < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (Math.abs(trendRoc) >= minCarryPct && volRatio <= maxVolRatio && trendRoc > 0 && last.close > last.open) {
    decision = 'buy';
  } else if (Math.abs(trendRoc) >= minCarryPct && volRatio <= maxVolRatio && trendRoc < 0 && last.close < last.open) {
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'interest-arbitrage',
    context,
    config: { ...config, trendBars, minCarryPct, maxVolRatio },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 30 : 0) + (volRatio <= maxVolRatio ? 10 : 0),
    reasons: [
      'Interest arbitrage — slow trend carry with contained volatility',
      `Trend ROC ${trendRoc.toFixed(2)}% · vol ratio ${volRatio.toFixed(2)}×`,
      decision === 'buy' ? 'Positive carry long leg' : decision === 'sell' ? 'Negative carry short leg' : 'Carry/vol filter not met',
    ],
    metrics: {
      trendRocPct: Number(trendRoc.toFixed(3)),
      volRatio: Number(volRatio.toFixed(3)),
    },
  });
};

export const evaluateSwapArbitrageEngine: StrategyEngine = (candles, config, context) => {
  const rollBars = Math.max(8, parseNumber(config.rollBars, 16));
  const minRollPct = parseNumber(config.minRollPct, 0.12);
  const closes = candles.map((item) => item.close);
  const rollWindow = candles.slice(-rollBars);
  const gapProxy = rollWindow.length >= 2
    ? ((rollWindow.at(-1)!.open - rollWindow[0]!.close) / rollWindow[0]!.close) * 100
    : 0;
  const rollMa = sma(closes, rollBars)[closes.length - 1];
  const last = candles[candles.length - 1]!;
  const aboveRoll = last.close > (rollMa ?? last.close);
  const rollZ = zScore(rollWindow.map((item) => item.close));
  let bias: StrategyBias = gapProxy > 0 ? 'bullish' : gapProxy < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (Math.abs(gapProxy) >= minRollPct && gapProxy > 0 && aboveRoll && last.close > last.open) {
    decision = 'buy';
  } else if (Math.abs(gapProxy) >= minRollPct && gapProxy < 0 && !aboveRoll && last.close < last.open) {
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'swap-arbitrage',
    context,
    config: { ...config, rollBars, minRollPct },
    candles,
    decision,
    bias,
    confidence: 33 + (decision !== 'wait' ? 32 : 0) + Math.min(14, Math.abs(rollZ) * 6),
    reasons: [
      'Swap arbitrage — overnight roll gap vs rolling mean alignment',
      `Roll gap ${gapProxy.toFixed(3)}% · roll z-score ${rollZ.toFixed(2)}`,
      decision === 'buy' ? 'Positive swap roll — long leg' : decision === 'sell' ? 'Negative swap roll — short leg' : 'Swap roll edge insufficient',
    ],
    metrics: {
      rollGapPct: Number(gapProxy.toFixed(4)),
      rollZScore: Number(rollZ.toFixed(3)),
    },
  });
};
