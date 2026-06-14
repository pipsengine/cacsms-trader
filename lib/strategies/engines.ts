import type { StrategyPriceCandle } from './strategy-candle-loader';
import { strategyCandlesToReconstructed } from './strategy-candle-adapter';
import { analyzeTrendlines, type TrendlineDetection } from '@/lib/trendline-detection-engine';
import { analyzeSwingPoints } from '@/lib/swing-point-engine';
import { analyzeMarketStructure } from '@/lib/structure-analysis-engine';
import { analyzeSupportResistance, type SupportResistanceZone } from '@/lib/support-resistance-engine';
import { analyzeChannels, type ChannelDetection } from '@/lib/channel-detection-engine';
import {
  analyzeMultiTimeframe,
  MTF_TIMEFRAMES,
  type MtfTimeframe,
} from '@/lib/multi-timeframe-analysis-engine';
import {
  adx,
  atr,
  bollinger,
  crossover,
  ema,
  macd,
  rsi,
  sma,
  stochastic,
  supertrend,
  ichimoku,
} from './indicators';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyEngineContext,
  type StrategyEvaluationResult,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import {
  evaluate1MinuteScalpingEngine,
  evaluate5MinuteScalpingEngine,
  evaluateTickScalpingEngine,
  evaluateSpreadScalpingEngine,
  evaluateOrderFlowScalpingEngine,
  evaluateDomScalpingEngine,
  evaluateMomentumScalpingEngine,
  evaluateEmaScalpingEngine,
  evaluateVwapScalpingEngine,
  evaluateRsiScalpingEngine,
  evaluateStochasticScalpingEngine,
  evaluatePriceActionScalpingEngine,
  evaluateLiquidityGrabScalpingEngine,
  evaluateNewsScalpingEngine,
  evaluateSessionScalpingEngine,
  evaluateHighFrequencyScalpingEngine,
  evaluateAlgorithmicScalpingEngine,
} from './scalping-engines';
import {
  evaluateIntradayTrendTradingEngine,
  evaluateIntradayBreakoutEngine,
  evaluateMomentumDayTradingEngine,
  evaluateVwapDayTradingEngine,
  evaluateOpeningSessionTradingEngine,
  evaluateMeanReversionDayTradingEngine,
  evaluateGapTradingEngine,
  evaluateReversalDayTradingEngine,
  evaluateNewsBasedDayTradingEngine,
  evaluateCorrelationDayTradingEngine,
  evaluatePivotPointDayTradingEngine,
  evaluateRangeDayTradingEngine,
  evaluateSmartMoneyDayTradingEngine,
} from './day-trading-engines';
import {
  evaluateSwingPullbackStrategyEngine,
  evaluateFibonacciSwingTradingEngine,
  evaluateSwingReversalStrategyEngine,
  evaluateTrendSwingTradingEngine,
  evaluateChannelSwingTradingEngine,
  evaluateHarmonicSwingTradingEngine,
  evaluateElliottWaveSwingTradingEngine,
  evaluateMacdSwingTradingEngine,
  evaluateRsiSwingTradingEngine,
  evaluateSupportAndResistanceSwingTradingEngine,
  evaluateCandlestickSwingTradingEngine,
  evaluateWeeklySwingTradingEngine,
  evaluatePositionSwingTradingEngine,
} from './swing-trading-engines';
import {
  evaluateSupportAndResistanceEngine,
  evaluateSupplyAndDemandEngine,
  evaluateCandlestickTradingEngine,
  evaluateEngulfingPatternEngine,
  evaluateInsideBarStrategyEngine,
  evaluateFakeyPatternEngine,
  evaluateMarketStructureTradingEngine,
  evaluateLiquiditySweepStrategyEngine,
  evaluateMitigationBlockStrategyEngine,
  evaluateBreakerBlockStrategyEngine,
  evaluateInstitutionalCandleTradingEngine,
  evaluateIctTradingStrategyEngine,
  evaluateBosBreakOfStructureEngine,
  evaluateChochChangeOfCharacterEngine,
} from './price-action-engines';
import {
  evaluateMacdStrategyEngine,
  evaluateBollingerBandsStrategyEngine,
  evaluateAtrStrategyEngine,
  evaluateAdxStrategyEngine,
  evaluateCciStrategyEngine,
  evaluateParabolicSarStrategyEngine,
  evaluateIchimokuStrategyEngine,
  evaluateMovingAverageStrategyEngine,
  evaluateKeltnerChannelStrategyEngine,
  evaluateDonchianChannelStrategyEngine,
  evaluateMomentumIndicatorStrategyEngine,
  evaluateWilliamsRStrategyEngine,
  evaluateTdiStrategyEngine,
  evaluateAlligatorIndicatorStrategyEngine,
} from './indicator-based-engines';
import {
  evaluateRsiOverboughtOversoldEngine,
  evaluateVwapReversionEngine,
  evaluateStatisticalReversionEngine,
  evaluateRangeReversalEngine,
  evaluateChannelReversionEngine,
  evaluateZScoreReversionEngine,
  evaluateDeviationReversionEngine,
  evaluateReversionScalpingEngine,
} from './mean-reversion-engines';
import {
  evaluateMomentumBreakoutEngine,
  evaluateVolumeMomentumEngine,
  evaluateNewsMomentumEngine,
  evaluateMacdMomentumEngine,
  evaluateRsiMomentumEngine,
  evaluateVolatilityMomentumEngine,
  evaluateCurrencyStrengthMomentumEngine,
  evaluateRelativeStrengthMomentumEngine,
} from './momentum-trading-engines';
import {
  evaluateDoubleTopBottomEngine,
  evaluateHeadAndShouldersEngine,
  evaluateRsiDivergenceEngine,
  evaluateMacdDivergenceEngine,
  evaluateExhaustionReversalEngine,
  evaluateClimacticReversalEngine,
  evaluateTrendlineReversalEngine,
  evaluateFibonacciReversalEngine,
  evaluateHarmonicReversalEngine,
  evaluateSupplyDemandReversalEngine,
  evaluateVReversalEngine,
  evaluateCountertrendTradingEngine,
} from './reversal-trading-engines';
import {
  evaluateHorizontalRangeTradingEngine,
  evaluateBollingerRangeStrategyEngine,
  evaluateOscillatorRangeTradingEngine,
  evaluateChannelTradingEngine,
  evaluateSupportAndResistanceRangeEngine,
  evaluateAsianSessionRangeTradingEngine,
  evaluateMeanReversionRangeEngine,
  evaluateVwapRangeTradingEngine,
} from './range-trading-engines';
import {
  evaluateSmartMoneyConceptsSmcEngine,
  evaluateIctMethodologyEngine,
  evaluateOrderFlowTradingEngine,
  evaluateFootprintTradingEngine,
  evaluateLiquidityTradingEngine,
  evaluateMarketMakerModelEngine,
  evaluateWyckoffMethodEngine,
  evaluateAccumulationDistributionEngine,
  evaluateManipulationDistributionEngine,
  evaluateStopHuntStrategyEngine,
  evaluateInstitutionalCandleModelEngine,
  evaluatePremiumAndDiscountZonesEngine,
  evaluateSmtDivergenceEngine,
  evaluateKillZonesEngine,
  evaluateJudasSwingEngine,
  evaluatePowerOf3Po3Engine,
} from './smart-money-engines';
import {
  evaluateAlgorithmicTradingEngine,
  evaluateQuantitativeTradingEngine,
  evaluateHighFrequencyTradingHftEngine,
  evaluateStatisticalArbitrageEngine,
  evaluateMachineLearningTradingEngine,
  evaluateAiBasedTradingEngine,
  evaluateNeuralNetworkTradingEngine,
  evaluateSentimentAiTradingEngine,
  evaluateReinforcementLearningTradingEngine,
  evaluateGridAlgorithmsEngine,
  evaluateMartingaleSystemsEngine,
  evaluateAntiMartingaleSystemsEngine,
  evaluateVolatilityAlgorithmsEngine,
} from './quantitative-algorithmic-engines';
import {
  evaluateInterestRateTradingEngine,
  evaluateCentralBankTradingEngine,
  evaluateCpiTradingEngine,
  evaluateNfpTradingEngine,
  evaluateGdpTradingEngine,
  evaluateInflationTradingEngine,
  evaluateEmploymentDataTradingEngine,
  evaluateGeopoliticalTradingEngine,
  evaluateTradeBalanceTradingEngine,
  evaluateYieldDifferentialTradingEngine,
  evaluateMonetaryPolicyStrategyEngine,
  evaluateRiskOnRiskOffTradingEngine,
} from './fundamental-trading-engines';
import {
  evaluateNfpStrategyEngine,
  evaluateFomcStrategyEngine,
  evaluateCpiStrategyEngine,
  evaluateEcbStrategyEngine,
  evaluateBoeStrategyEngine,
  evaluateBojStrategyEngine,
  evaluateRateDecisionTradingEngine,
  evaluateFlashNewsTradingEngine,
  evaluateVolatilitySpikeTradingEngine,
  evaluateNewsFadeStrategyEngine,
} from './news-trading-engines';
import {
  evaluateCurrencyCorrelationTradingEngine,
  evaluateGoldForexCorrelationEngine,
  evaluateOilCadCorrelationEngine,
  evaluateBondYieldCorrelationEngine,
  evaluateDollarIndexDxyStrategyEngine,
  evaluateRiskSentimentCorrelationEngine,
  evaluateEquityForexCorrelationEngine,
} from './correlation-intermarket-engines';
import {
  evaluateAtrBreakoutEngine,
  evaluateVolatilityCompressionEngine,
  evaluateVolatilityExpansionEngine,
  evaluateVolatilityBollingerSqueezeEngine,
  evaluateImpliedVolatilityTradingEngine,
  evaluateNewsVolatilityStrategyEngine,
} from './volatility-based-engines';
import {
  evaluateDirectHedgeEngine,
  evaluateMultipleCurrencyHedgeEngine,
  evaluateCorrelationHedgeEngine,
  evaluateOptionsHedgeEngine,
  evaluateSyntheticHedgeEngine,
  evaluatePartialHedgeEngine,
} from './hedging-strategies-engines';
import {
  evaluateTriangularArbitrageEngine,
  evaluateLatencyArbitrageEngine,
  evaluateCrossBrokerArbitrageEngine,
  evaluateInterestArbitrageEngine,
  evaluateSwapArbitrageEngine,
} from './arbitrage-strategies-engines';
import {
  evaluateAsianSessionStrategyEngine,
  evaluateLondonSessionStrategyEngine,
  evaluateNewYorkSessionStrategyEngine,
  evaluateLondonNewYorkOverlapEngine,
  evaluateTokyoBreakoutEngine,
  evaluateSessionMomentumEngine,
  evaluateSessionReversalEngine,
} from './session-based-strategies-engines';
import {
  evaluateTrianglePatternsEngine,
  evaluateWedgePatternsEngine,
  evaluateFlagPatternsEngine,
  evaluatePennantPatternsEngine,
  evaluateCupAndHandleEngine,
  evaluateHarmonicPatternsEngine,
  evaluateButterflyPatternEngine,
  evaluateBatPatternEngine,
  evaluateCrabPatternEngine,
  evaluateGartleyPatternEngine,
  evaluateCypherPatternEngine,
} from './pattern-trading-strategies-engines';
import {
  evaluateDojiEngine,
  evaluateMorningStarEngine,
  evaluateEveningStarEngine,
  evaluateHammerEngine,
  evaluateShootingStarEngine,
  evaluateHaramiEngine,
  evaluateTweezerTopBottomEngine,
  evaluateThreeSoldiersEngine,
  evaluateThreeCrowsEngine,
} from './candlestick-trading-strategies-engines';
import {
  evaluateFixedLotStrategyEngine,
  evaluatePercentageRiskModelEngine,
  evaluateKellyCriterionEngine,
  evaluateVolatilityPositionSizingEngine,
  evaluateDynamicRiskAllocationEngine,
  evaluateEquityCurveManagementEngine,
  evaluatePortfolioRiskBalancingEngine,
  evaluateDrawdownProtectionEngine,
  evaluateDailyLossLimitStrategyEngine,
} from './risk-management-strategies-engines';
import {
  evaluateWyckoffTradingEngine,
  evaluateMarketProfileTradingEngine,
  evaluateVolumeProfileTradingEngine,
  evaluateAuctionMarketTheoryEngine,
  evaluateOrderBookTradingEngine,
  evaluateFootprintChartsEngine,
  evaluateLiquidityEngineeringEngine,
  evaluateQuantMacroTradingEngine,
  evaluateStatisticalModelingEngine,
  evaluateAiPredictiveTradingEngine,
  evaluateNeuralForecastingEngine,
  evaluateInstitutionalFlowAnalysisEngine,
  evaluateDarkPoolAnalysisEngine,
  evaluateSentimentEngineTradingEngine,
  evaluateCrossAssetFlowTradingEngine,
} from './advanced-professional-institutional-engines';
import {
  evaluateTrendMomentumEngine,
  evaluateSmcPriceActionEngine,
  evaluateFundamentalTechnicalEngine,
  evaluateAiTechnicalAnalysisEngine,
  evaluateNewsLiquidityEngine,
  evaluateScalpingOrderFlowEngine,
  evaluateSwingMacroAnalysisEngine,
} from './hybrid-strategies-engines';
import {
  evaluateMacroTrendTradingEngine,
  evaluateFundamentalPositionTradingEngine,
  evaluateCarryTradeStrategyEngine,
  evaluateLongTermTrendFollowingEngine,
  evaluateEconomicCycleTradingEngine,
  evaluateCentralBankPolicyTradingEngine,
  evaluateInterestRateDifferentialStrategyEngine,
  evaluateInflationBasedPositionTradingEngine,
  evaluateCommodityCurrencyPositionTradingEngine,
} from './position-trading-engines';

const DEFAULTS = {
  symbol: 'EURUSD',
  timeframe: 'H1',
};

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function contextFromConfig(config: Record<string, unknown>): StrategyEngineContext {
  return {
    symbol: String(config.symbol ?? DEFAULTS.symbol).toUpperCase(),
    timeframe: String(config.timeframe ?? DEFAULTS.timeframe).toUpperCase() as StrategyEngineContext['timeframe'],
  };
}

export const evaluateMovingAverageCrossoverEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(2, parseNumber(config.fastPeriod, 9));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 21));
  const maType = String(config.maType ?? 'ema').toLowerCase() === 'sma' ? 'sma' : 'ema';
  const closes = candles.map((item) => item.close);
  const fastSeries = maType === 'sma' ? sma(closes, fastPeriod) : ema(closes, fastPeriod);
  const slowSeries = maType === 'sma' ? sma(closes, slowPeriod) : ema(closes, slowPeriod);
  const last = closes.length - 1;
  const fastMa = fastSeries[last];
  const slowMa = slowSeries[last];
  const signal = crossover(
    fastSeries[last - 1] ?? null,
    fastMa,
    slowSeries[last - 1] ?? null,
    slowMa,
  );
  const bias = fastMa != null && slowMa != null
    ? fastMa > slowMa ? 'bullish' : fastMa < slowMa ? 'bearish' : 'neutral'
    : 'neutral';
  const spreadPct = fastMa != null && slowMa != null && slowMa !== 0
    ? Math.abs((fastMa - slowMa) / slowMa) * 100
    : 0;
  const decision = signal === 'bullish_cross' || (signal === 'none' && bias === 'bullish')
    ? 'buy'
    : signal === 'bearish_cross' || (signal === 'none' && bias === 'bearish')
      ? 'sell'
      : 'wait';

  return buildEvaluationResult({
    strategyId: 'moving-average-crossover',
    context,
    config: { ...config, fastPeriod, slowPeriod, maType },
    candles,
    decision,
    bias,
    confidence: 42 + (signal !== 'none' ? 24 : 0) + Math.min(20, spreadPct * 400),
    reasons: [
      `${maType.toUpperCase()}(${fastPeriod}) vs ${maType.toUpperCase()}(${slowPeriod}) institutional crossover scan`,
      bias === 'bullish' ? 'Fast average above slow — trend continuation bias' : bias === 'bearish' ? 'Fast average below slow — distribution bias' : 'Averages converging — wait for expansion',
      signal !== 'none' ? `Fresh ${signal.replace('_', ' ')} on latest bar` : 'No fresh crossover on latest bar',
    ],
    metrics: {
      fastMa: fastMa != null ? Number(fastMa.toFixed(5)) : null,
      slowMa: slowMa != null ? Number(slowMa.toFixed(5)) : null,
      spread: fastMa != null && slowMa != null ? Number((fastMa - slowMa).toFixed(5)) : null,
    },
    events: signal !== 'none'
      ? [{ label: signal.replace('_', ' '), detail: `Close ${closes[last]?.toFixed(5)}`, tone: signal === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateEmaPullbackEngine: StrategyEngine = (candles, config, context) => {
  const trendPeriod = Math.max(20, parseNumber(config.trendPeriod, 50));
  const pullbackPeriod = Math.max(5, parseNumber(config.pullbackPeriod, 21));
  const tolerancePct = parseNumber(config.tolerancePct, 0.15);
  const closes = candles.map((item) => item.close);
  const trendEma = ema(closes, trendPeriod);
  const pullbackEma = ema(closes, pullbackPeriod);
  const last = closes.length - 1;
  const close = closes[last];
  const trend = trendEma[last];
  const pullback = pullbackEma[last];
  const atrSeries = atr(candles, 14);
  const atrNow = atrSeries[last];

  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (trend != null && pullback != null) {
    bias = close > trend ? 'bullish' : close < trend ? 'bearish' : 'neutral';
    const distancePct = Math.abs((close - pullback) / close) * 100;
    const touchedPullback = distancePct <= tolerancePct;
    if (bias === 'bullish' && touchedPullback && close >= pullback) decision = 'buy';
    if (bias === 'bearish' && touchedPullback && close <= pullback) decision = 'sell';
  }

  const confidence = 38
    + (decision !== 'wait' ? 28 : 0)
    + (atrNow != null ? Math.min(15, (atrNow / close) * 10_000) : 0);

  return buildEvaluationResult({
    strategyId: 'ema-pullback-strategy',
    context,
    config: { ...config, trendPeriod, pullbackPeriod, tolerancePct },
    candles,
    decision,
    bias,
    confidence,
    reasons: [
      `Institutional EMA pullback model: EMA(${trendPeriod}) trend filter + EMA(${pullbackPeriod}) value zone`,
      bias === 'bullish' ? 'Price above trend EMA — only long pullbacks considered' : bias === 'bearish' ? 'Price below trend EMA — only short pullbacks considered' : 'No dominant higher-timeframe trend',
      decision === 'buy' ? 'Price reclaimed pullback EMA from above — continuation long' : decision === 'sell' ? 'Price rejected pullback EMA from below — continuation short' : 'Pullback not confirmed within tolerance band',
    ],
    metrics: {
      trendEma: trend != null ? Number(trend.toFixed(5)) : null,
      pullbackEma: pullback != null ? Number(pullback.toFixed(5)) : null,
      atr: atrNow != null ? Number(atrNow.toFixed(5)) : null,
    },
  });
};

export const evaluateMacdTrendEngine: StrategyEngine = (candles, config, context) => {
  const closes = candles.map((item) => item.close);
  const fastPeriod = Math.max(5, parseNumber(config.fastPeriod, 12));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 26));
  const signalPeriod = Math.max(3, parseNumber(config.signalPeriod, 9));
  const { macd: macdLine, signal, histogram } = macd(closes, fastPeriod, slowPeriod, signalPeriod);
  const last = closes.length - 1;
  const cross = crossover(macdLine[last - 1], macdLine[last], signal[last - 1], signal[last]);
  const hist = histogram[last];
  const bias = hist != null ? hist > 0 ? 'bullish' : hist < 0 ? 'bearish' : 'neutral' : 'neutral';
  const decision = cross === 'bullish_cross' ? 'buy' : cross === 'bearish_cross' ? 'sell' : bias === 'bullish' ? 'buy' : bias === 'bearish' ? 'sell' : 'wait';

  return buildEvaluationResult({
    strategyId: 'macd-trend-strategy',
    context,
    config: { ...config, fastPeriod, slowPeriod, signalPeriod },
    candles,
    decision,
    bias,
    confidence: 40 + (cross !== 'none' ? 25 : 0) + Math.min(20, Math.abs(hist ?? 0) * 10_000),
    reasons: [
      `MACD(${fastPeriod},${slowPeriod},${signalPeriod}) institutional momentum model`,
      cross !== 'none' ? `Signal line ${cross.replace('_', ' ')} detected` : 'No fresh MACD signal crossover',
      hist != null && hist > 0 ? 'Histogram expansion supports bullish momentum' : hist != null && hist < 0 ? 'Histogram compression supports bearish momentum' : 'Histogram neutral',
    ],
    metrics: {
      macd: macdLine[last] != null ? Number(macdLine[last]!.toFixed(6)) : null,
      signal: signal[last] != null ? Number(signal[last]!.toFixed(6)) : null,
      histogram: hist != null ? Number(hist.toFixed(6)) : null,
    },
    events: cross !== 'none'
      ? [{ label: cross.replace('_', ' '), detail: 'MACD / signal crossover', tone: cross === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateIchimokuTrendEngine: StrategyEngine = (candles, config, context) => {
  const tenkanPeriod = Math.max(5, parseNumber(config.tenkanPeriod, 9));
  const kijunPeriod = Math.max(tenkanPeriod + 1, parseNumber(config.kijunPeriod, 26));
  const senkouBPeriod = Math.max(kijunPeriod + 1, parseNumber(config.senkouBPeriod, 52));
  const displacement = 26;
  const { tenkan, kijun, senkouA, senkouB } = ichimoku(candles, tenkanPeriod, kijunPeriod, senkouBPeriod, displacement);
  const last = candles.length - 1;
  const close = candles[last].close;
  const spanA = senkouA[last];
  const spanB = senkouB[last];
  const tenkanNow = tenkan[last];
  const kijunNow = kijun[last];
  const cloudTop = spanA != null && spanB != null ? Math.max(spanA, spanB) : null;
  const cloudBottom = spanA != null && spanB != null ? Math.min(spanA, spanB) : null;
  const aboveCloud = cloudTop != null && close > cloudTop;
  const belowCloud = cloudBottom != null && close < cloudBottom;
  const inCloud = !aboveCloud && !belowCloud;
  const cloudBullish = spanA != null && spanB != null && spanA > spanB;
  const cloudBearish = spanA != null && spanB != null && spanA < spanB;
  const tkCross = crossover(tenkan[last - 1], tenkanNow, kijun[last - 1], kijunNow);
  const tenkanAboveKijun = tenkanNow != null && kijunNow != null && tenkanNow > kijunNow;
  const chikouBullish = last >= displacement && close > candles[last - displacement].close;
  const chikouBearish = last >= displacement && close < candles[last - displacement].close;

  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (aboveCloud && tenkanAboveKijun) bias = 'bullish';
  else if (belowCloud && !tenkanAboveKijun && tenkanNow != null && kijunNow != null) bias = 'bearish';
  else if (aboveCloud) bias = 'bullish';
  else if (belowCloud) bias = 'bearish';
  else if (tenkanAboveKijun) bias = 'bullish';
  else if (tenkanNow != null && kijunNow != null && tenkanNow < kijunNow) bias = 'bearish';

  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (tkCross === 'bullish_cross' && (aboveCloud || cloudBullish)) decision = 'buy';
  else if (tkCross === 'bearish_cross' && (belowCloud || cloudBearish)) decision = 'sell';
  else if (aboveCloud && tenkanAboveKijun && cloudBullish) decision = 'buy';
  else if (belowCloud && !tenkanAboveKijun && cloudBearish) decision = 'sell';
  else if (aboveCloud && tenkanAboveKijun) decision = 'buy';
  else if (belowCloud && tenkanNow != null && kijunNow != null && tenkanNow < kijunNow) decision = 'sell';
  else if (inCloud) decision = 'wait';

  const alignmentScore = [
    aboveCloud || belowCloud,
    tenkanAboveKijun || (tenkanNow != null && kijunNow != null && tenkanNow < kijunNow),
    cloudBullish || cloudBearish,
    chikouBullish || chikouBearish,
  ].filter(Boolean).length;

  const events = tkCross !== 'none'
    ? [{ label: tkCross.replace('_', ' '), detail: 'Tenkan / Kijun crossover', tone: tkCross === 'bullish_cross' ? 'emerald' as const : 'rose' as const, barIndex: last }]
    : [];

  return buildEvaluationResult({
    strategyId: 'ichimoku-trend-strategy',
    context,
    config: { ...config, tenkanPeriod, kijunPeriod, senkouBPeriod, displacement },
    candles,
    decision,
    bias,
    confidence: 38 + alignmentScore * 12 + (tkCross !== 'none' ? 16 : 0),
    reasons: [
      `Ichimoku(${tenkanPeriod},${kijunPeriod},${senkouBPeriod}) institutional cloud model`,
      aboveCloud
        ? 'Price above Kumo — bullish regime'
        : belowCloud
          ? 'Price below Kumo — bearish regime'
          : 'Price inside cloud — transitional / wait',
      tkCross !== 'none'
        ? `Tenkan/Kijun ${tkCross.replace('_', ' ')} on latest bar`
        : tenkanAboveKijun
          ? 'Tenkan above Kijun — bullish momentum'
          : tenkanNow != null && kijunNow != null && tenkanNow < kijunNow
            ? 'Tenkan below Kijun — bearish momentum'
            : 'TK lines converging',
      chikouBullish
        ? 'Chikou span above price 26 bars ago — bullish confirmation'
        : chikouBearish
          ? 'Chikou span below price 26 bars ago — bearish confirmation'
          : 'Chikou confirmation neutral',
    ],
    metrics: {
      tenkan: tenkanNow != null ? Number(tenkanNow.toFixed(5)) : null,
      kijun: kijunNow != null ? Number(kijunNow.toFixed(5)) : null,
      senkouA: spanA != null ? Number(spanA.toFixed(5)) : null,
      senkouB: spanB != null ? Number(spanB.toFixed(5)) : null,
      cloudPosition: aboveCloud ? 'above' : belowCloud ? 'below' : 'inside',
      tkCross: tkCross === 'none' ? null : tkCross,
    },
    events,
  });
};

export const evaluateSupertrendEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(5, parseNumber(config.period, 10));
  const multiplier = parseNumber(config.multiplier, 2);
  const { trend, value } = supertrend(candles, period, multiplier);
  const last = candles.length - 1;
  const currentTrend = trend[last];
  const prevTrend = trend[last - 1];
  const flipped = currentTrend != null && prevTrend != null && currentTrend !== prevTrend;
  const bias = currentTrend === 'bullish' ? 'bullish' : currentTrend === 'bearish' ? 'bearish' : 'neutral';
  const decision = flipped
    ? currentTrend === 'bullish' ? 'buy' : 'sell'
    : bias === 'bullish' ? 'buy' : bias === 'bearish' ? 'sell' : 'wait';

  return buildEvaluationResult({
    strategyId: 'supertrend-strategy',
    context,
    config: { ...config, period, multiplier },
    candles,
    decision,
    bias,
    confidence: 44 + (flipped ? 28 : 12),
    reasons: [
      `ATR-adaptive SuperTrend(${period}, ${multiplier}) institutional trail`,
      flipped ? `Trend flip to ${currentTrend} on latest bar` : `Trend remains ${currentTrend ?? 'undefined'}`,
      `SuperTrend value ${value[last]?.toFixed(5) ?? '—'} vs close ${candles[last].close.toFixed(5)}`,
    ],
    metrics: {
      supertrend: value[last] != null ? Number(value[last]!.toFixed(5)) : null,
      trend: currentTrend ?? null,
    },
    events: flipped
      ? [{ label: `${currentTrend} flip`, detail: 'SuperTrend regime change', tone: currentTrend === 'bullish' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateRsiEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(5, parseNumber(config.period, 14));
  const oversold = parseNumber(config.oversold, 30);
  const overbought = parseNumber(config.overbought, 70);
  const closes = candles.map((item) => item.close);
  const rsiSeries = rsi(closes, period);
  const last = closes.length - 1;
  const value = rsiSeries[last];
  const prev = rsiSeries[last - 1];
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (value != null) {
    if (value >= 55) bias = 'bullish';
    else if (value <= 45) bias = 'bearish';
    if (prev != null && prev <= oversold && value > oversold) decision = 'buy';
    if (prev != null && prev >= overbought && value < overbought) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'rsi-strategy',
    context,
    config: { ...config, period, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 0) + (value != null ? Math.min(20, Math.abs(value - 50) / 2) : 0),
    reasons: [
      `RSI(${period}) mean-reversion / momentum hybrid`,
      value != null ? `Current RSI ${value.toFixed(1)} (${oversold}/${overbought} bands)` : 'Insufficient RSI history',
      decision === 'buy' ? 'Bullish reversal from oversold' : decision === 'sell' ? 'Bearish reversal from overbought' : 'No band rejection signal',
    ],
    metrics: { rsi: value != null ? Number(value.toFixed(2)) : null },
  });
};

export const evaluateLondonBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(12, parseNumber(config.lookback, 24));
  const bufferPct = parseNumber(config.bufferPct, 0.05);
  const window = candles.slice(-lookback);
  const sessionHigh = Math.max(...window.map((item) => item.high));
  const sessionLow = Math.min(...window.map((item) => item.low));
  const last = candles[candles.length - 1];
  const buffer = last.close * (bufferPct / 100);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (last.close > sessionHigh - buffer) {
    bias = 'bullish';
    if (last.close > sessionHigh) decision = 'buy';
  } else if (last.close < sessionLow + buffer) {
    bias = 'bearish';
    if (last.close < sessionLow) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'london-breakout',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 40 + (decision !== 'wait' ? 32 : 8),
    reasons: [
      `Session range breakout over last ${lookback} bars (London-style institutional box)`,
      `Range high ${sessionHigh.toFixed(5)} / low ${sessionLow.toFixed(5)}`,
      decision === 'buy' ? 'Close broke above session high with buffer' : decision === 'sell' ? 'Close broke below session low with buffer' : 'Price inside session range — no breakout confirmation',
    ],
    metrics: {
      sessionHigh: Number(sessionHigh.toFixed(5)),
      sessionLow: Number(sessionLow.toFixed(5)),
      range: Number((sessionHigh - sessionLow).toFixed(5)),
    },
  });
};

export const evaluateNewYorkBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const expansionRatio = parseNumber(config.expansionRatio, 1.1);
  const window = candles.slice(-lookback);
  const sliceStart = Math.max(1, Math.floor(window.length / 3));
  const sliceEnd = Math.max(sliceStart + 2, Math.floor((window.length * 2) / 3));
  const preNyWindow = window.slice(sliceStart, sliceEnd);
  const nyWindow = window.slice(sliceEnd);
  const sessionHigh = Math.max(...preNyWindow.map((item) => item.high));
  const sessionLow = Math.min(...preNyWindow.map((item) => item.low));
  const sessionRange = Math.max(sessionHigh - sessionLow, 0.00001);
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  const preNyAvgRange = averageCandleRange(preNyWindow);
  const nyAvgRange = nyWindow.length ? averageCandleRange(nyWindow) : averageCandleRange(window.slice(-3));
  const nyExpanding = preNyAvgRange > 0 && nyAvgRange / preNyAvgRange >= expansionRatio;
  const lastRange = last.high - last.low;
  const displacementBar = preNyAvgRange > 0 && lastRange >= preNyAvgRange * expansionRatio;

  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  const brokeUp = last.close > sessionHigh + buffer;
  const brokeDown = last.close < sessionLow - buffer;

  if (last.close > sessionHigh - buffer) {
    bias = 'bullish';
    if (brokeUp && (nyExpanding || displacementBar)) decision = 'buy';
    else if (brokeUp) decision = 'buy';
  } else if (last.close < sessionLow + buffer) {
    bias = 'bearish';
    if (brokeDown && (nyExpanding || displacementBar)) decision = 'sell';
    else if (brokeDown) decision = 'sell';
  }

  const compressionPct = window.length > 0
    ? Number(((sessionRange / Math.max(averageCandleRange(window), 0.00001)) * 100).toFixed(1))
    : 0;

  return buildEvaluationResult({
    strategyId: 'new-york-breakout',
    context,
    config: { ...config, lookback, bufferPct, expansionRatio },
    candles,
    decision,
    bias,
    confidence: 36
      + (decision !== 'wait' ? 32 : 8)
      + (nyExpanding ? 10 : 0)
      + (displacementBar ? 8 : 0)
      + Math.min(12, (nyAvgRange / Math.max(preNyAvgRange, 0.00001)) * 4),
    reasons: [
      `New York breakout — pre-NY box from middle third (bars ${sliceStart}-${sliceEnd}) of ${lookback}-bar window`,
      `Consolidation high ${sessionHigh.toFixed(5)} / low ${sessionLow.toFixed(5)} · range ${sessionRange.toFixed(5)}`,
      nyExpanding
        ? `NY-window volatility expanding ${(nyAvgRange / Math.max(preNyAvgRange, 0.00001)).toFixed(2)}x vs pre-NY consolidation`
        : 'NY-window expansion muted — breakout lacks volatility confirmation',
      decision === 'buy'
        ? 'Close broke above pre-NY high with institutional buffer'
        : decision === 'sell'
          ? 'Close broke below pre-NY low with institutional buffer'
          : brokeUp || brokeDown
            ? 'Break outside box but awaiting stronger NY expansion confirmation'
            : 'Price inside pre-NY range — no New York breakout',
    ],
    metrics: {
      sessionHigh: Number(sessionHigh.toFixed(5)),
      sessionLow: Number(sessionLow.toFixed(5)),
      sessionRange: Number(sessionRange.toFixed(5)),
      preNyBars: preNyWindow.length,
      nyBars: nyWindow.length,
      compressionPct,
      nyExpansion: Number((nyAvgRange / Math.max(preNyAvgRange, 0.00001)).toFixed(2)),
      displacementBar: displacementBar ? 'yes' : 'no',
    },
    events: decision !== 'wait'
      ? [{
        label: decision === 'buy' ? 'ny breakout long' : 'ny breakout short',
        detail: `Break of pre-NY ${decision === 'buy' ? 'high' : 'low'} ${decision === 'buy' ? sessionHigh.toFixed(5) : sessionLow.toFixed(5)}`,
        tone: decision === 'buy' ? 'emerald' as const : 'rose' as const,
        barIndex: last.candleIndex,
      }]
      : [],
  });
};

export const evaluateBollingerSqueezeEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 20));
  const stdDev = parseNumber(config.stdDev, 2);
  const squeezeThreshold = parseNumber(config.squeezeThreshold, 1.2);
  const closes = candles.map((item) => item.close);
  const bands = bollinger(closes, period, stdDev);
  const last = closes.length - 1;
  const bandwidth = bands.bandwidth[last];
  const upper = bands.upper[last];
  const lower = bands.lower[last];
  const close = closes[last];
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  const squeezed = bandwidth != null && bandwidth <= squeezeThreshold;
  if (!squeezed && upper != null && lower != null) {
    if (close > upper) {
      bias = 'bullish';
      decision = 'buy';
    } else if (close < lower) {
      bias = 'bearish';
      decision = 'sell';
    }
  }

  return buildEvaluationResult({
    strategyId: 'bollinger-band-squeeze-breakout',
    context,
    config: { ...config, period, stdDev, squeezeThreshold },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 35 : 0) + (squeezed ? 10 : 0),
    reasons: [
      `Bollinger(${period}, ${stdDev}) volatility compression → expansion model`,
      bandwidth != null ? `Bandwidth ${bandwidth.toFixed(2)}% vs squeeze threshold ${squeezeThreshold}%` : 'Bandwidth unavailable',
      squeezed ? 'Volatility squeeze active — awaiting expansion break' : decision !== 'wait' ? 'Expansion breakout confirmed' : 'No squeeze breakout on latest bar',
    ],
    metrics: {
      bandwidth: bandwidth != null ? Number(bandwidth.toFixed(3)) : null,
      upper: upper != null ? Number(upper.toFixed(5)) : null,
      lower: lower != null ? Number(lower.toFixed(5)) : null,
    },
  });
};

export const evaluateOrderBlockEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const displacementMultiple = parseNumber(config.displacementMultiple, 1.6);
  const atrSeries = atr(candles, 14);
  const last = candles.length - 1;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  let blockHigh: number | null = null;
  let blockLow: number | null = null;

  for (let index = last - 3; index >= Math.max(2, last - lookback); index -= 1) {
    const atrNow = atrSeries[index] ?? 0;
    const body = Math.abs(candles[index].close - candles[index].open);
    const displacement = body >= atrNow * displacementMultiple;
    if (!displacement) continue;
    const bullish = candles[index].close > candles[index].open;
    const bearish = candles[index].close < candles[index].open;
    if (bullish) {
      blockLow = Math.min(candles[index].open, candles[index].close);
      blockHigh = candles[index].high;
      bias = 'bullish';
      if (candles[last].low <= blockHigh && candles[last].close > blockLow) decision = 'buy';
      break;
    }
    if (bearish) {
      blockHigh = Math.max(candles[index].open, candles[index].close);
      blockLow = candles[index].low;
      bias = 'bearish';
      if (candles[last].high >= blockLow && candles[last].close < blockHigh) decision = 'sell';
      break;
    }
  }

  return buildEvaluationResult({
    strategyId: 'order-block-trading',
    context,
    config: { ...config, lookback, displacementMultiple },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 36 : 0) + (blockHigh != null ? 12 : 0),
    reasons: [
      'Smart-money order block model using displacement candle + mitigation retest',
      blockHigh != null && blockLow != null ? `Active block zone ${blockLow.toFixed(5)} – ${blockHigh.toFixed(5)}` : 'No qualifying displacement block in lookback window',
      decision === 'buy' ? 'Bullish mitigation into demand block' : decision === 'sell' ? 'Bearish mitigation into supply block' : 'Awaiting block retest',
    ],
    metrics: {
      blockHigh: blockHigh != null ? Number(blockHigh.toFixed(5)) : null,
      blockLow: blockLow != null ? Number(blockLow.toFixed(5)) : null,
    },
  });
};

export const evaluateAdxTrendEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(7, parseNumber(config.period, 14));
  const threshold = parseNumber(config.threshold, 25);
  const { adx: adxSeries, plusDi, minusDi } = adx(candles, period);
  const last = candles.length - 1;
  const adxValue = adxSeries[last];
  const pdi = plusDi[last];
  const mdi = minusDi[last];
  const strongTrend = adxValue != null && adxValue >= threshold;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (pdi != null && mdi != null) {
    bias = pdi > mdi ? 'bullish' : pdi < mdi ? 'bearish' : 'neutral';
    if (strongTrend && bias === 'bullish') decision = 'buy';
    if (strongTrend && bias === 'bearish') decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'adx-trend-strategy',
    context,
    config: { ...config, period, threshold },
    candles,
    decision,
    bias,
    confidence: 34 + (strongTrend ? 28 : 0) + (adxValue != null ? Math.min(24, adxValue / 2) : 0),
    reasons: [
      `ADX(${period}) institutional trend-strength filter (threshold ${threshold})`,
      adxValue != null ? `ADX ${adxValue.toFixed(1)} — ${strongTrend ? 'directional regime active' : 'weak / ranging regime'}` : 'ADX unavailable',
      pdi != null && mdi != null ? `+DI ${pdi.toFixed(1)} vs -DI ${mdi.toFixed(1)}` : 'Directional index unavailable',
    ],
    metrics: {
      adx: adxValue != null ? Number(adxValue.toFixed(2)) : null,
      plusDi: pdi != null ? Number(pdi.toFixed(2)) : null,
      minusDi: mdi != null ? Number(mdi.toFixed(2)) : null,
    },
  });
};

export const evaluate200EmaTrendEngine: StrategyEngine = (candles, config, context) => {
  const targetPeriod = Math.max(100, parseNumber(config.period, 200));
  const slopeLookback = Math.max(2, parseNumber(config.slopeLookback, 5));
  const closes = candles.map((item) => item.close);
  const maxPeriod = Math.max(50, closes.length - slopeLookback - 1);
  const period = Math.min(targetPeriod, maxPeriod);
  const usingProxy = period < targetPeriod;
  const emaSeries = ema(closes, period);
  const last = closes.length - 1;
  const emaNow = emaSeries[last];
  const emaPrev = emaSeries[last - slopeLookback];
  const emaPrior = emaSeries[last - 1];
  const close = closes[last];
  const prevClose = closes[last - 1];
  const priceCross = crossover(prevClose, close, emaPrior, emaNow);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (emaNow != null && emaPrev != null) {
    const rising = emaNow > emaPrev;
    const falling = emaNow < emaPrev;
    if (close > emaNow && rising) {
      bias = 'bullish';
      decision = 'buy';
    } else if (close < emaNow && falling) {
      bias = 'bearish';
      decision = 'sell';
    } else if (close > emaNow) {
      bias = 'bullish';
      decision = priceCross === 'bullish_cross' ? 'buy' : 'wait';
    } else if (close < emaNow) {
      bias = 'bearish';
      decision = priceCross === 'bearish_cross' ? 'sell' : 'wait';
    }
  }

  const slopePct = emaNow != null && emaPrev != null && emaPrev !== 0
    ? ((emaNow - emaPrev) / emaPrev) * 100
    : 0;

  return buildEvaluationResult({
    strategyId: '200-ema-trend-strategy',
    context,
    config: { ...config, period, targetPeriod, slopeLookback, usingProxy },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 30 : 8) + (priceCross !== 'none' ? 12 : 0) + (emaNow != null ? Math.min(18, Math.abs((close - emaNow) / close) * 5000) : 0),
    reasons: [
      usingProxy
        ? `EMA(${period}) proxy active — ${closes.length} bars in capture; full EMA(${targetPeriod}) needs wider history`
        : `Institutional EMA(${period}) long-horizon trend filter`,
      emaNow != null && emaPrev != null ? `EMA slope ${emaNow > emaPrev ? 'rising' : emaNow < emaPrev ? 'falling' : 'flat'} (${slopePct.toFixed(3)}%)` : 'EMA slope unavailable',
      close > (emaNow ?? close) ? 'Price above EMA — institutional bid support' : 'Price below EMA — institutional offer pressure',
      priceCross !== 'none' ? `Price ${priceCross.replace('_', ' ')} EMA on latest bar` : 'No fresh price/EMA crossover',
    ],
    metrics: {
      ema: emaNow != null ? Number(emaNow.toFixed(5)) : null,
      effectivePeriod: period,
      targetPeriod,
      distancePct: emaNow != null ? Number((Math.abs((close - emaNow) / close) * 100).toFixed(3)) : null,
      slopePct: Number(slopePct.toFixed(4)),
    },
    events: priceCross !== 'none'
      ? [{ label: priceCross.replace('_', ' '), detail: `Price / EMA(${period}) crossover`, tone: priceCross === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateAsianSessionBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(18, parseNumber(config.lookback, 36));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const window = candles.slice(-lookback);
  const asianEnd = Math.max(3, Math.floor(window.length / 3));
  const asianWindow = window.slice(0, asianEnd);
  const sessionHigh = Math.max(...asianWindow.map((item) => item.high));
  const sessionLow = Math.min(...asianWindow.map((item) => item.low));
  const last = candles[candles.length - 1];
  const buffer = last.close * (bufferPct / 100);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (last.close > sessionHigh - buffer) {
    bias = 'bullish';
    if (last.close > sessionHigh) decision = 'buy';
  } else if (last.close < sessionLow + buffer) {
    bias = 'bearish';
    if (last.close < sessionLow) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'asian-session-breakout',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 34 : 6),
    reasons: [
      `Asian session box from first ${asianEnd} bars of ${lookback}-bar window`,
      `Range high ${sessionHigh.toFixed(5)} / low ${sessionLow.toFixed(5)}`,
      decision === 'buy' ? 'Expansion above Asian high confirmed' : decision === 'sell' ? 'Expansion below Asian low confirmed' : 'Price inside Asian range',
    ],
    metrics: {
      sessionHigh: Number(sessionHigh.toFixed(5)),
      sessionLow: Number(sessionLow.toFixed(5)),
      asianBars: asianEnd,
    },
  });
};

export const evaluateOpeningRangeBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(12, parseNumber(config.lookback, 24));
  const orbBars = Math.max(3, parseNumber(config.orbBars, 6));
  const bufferPct = parseNumber(config.bufferPct, 0.03);
  const window = candles.slice(-lookback);
  const orbWindow = window.slice(0, Math.min(orbBars, window.length));
  const orbHigh = Math.max(...orbWindow.map((item) => item.high));
  const orbLow = Math.min(...orbWindow.map((item) => item.low));
  const last = candles[candles.length - 1];
  const buffer = last.close * (bufferPct / 100);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (last.close > orbHigh + buffer) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close < orbLow - buffer) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close > orbHigh - buffer) {
    bias = 'bullish';
  } else if (last.close < orbLow + buffer) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'opening-range-breakout-orb',
    context,
    config: { ...config, lookback, orbBars, bufferPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 36 : 10),
    reasons: [
      `Opening range built from first ${orbWindow.length} bars`,
      `ORB high ${orbHigh.toFixed(5)} / low ${orbLow.toFixed(5)}`,
      decision === 'buy' ? 'Close confirmed above ORB high' : decision === 'sell' ? 'Close confirmed below ORB low' : 'Price inside opening range',
    ],
    metrics: {
      orbHigh: Number(orbHigh.toFixed(5)),
      orbLow: Number(orbLow.toFixed(5)),
      orbBars: orbWindow.length,
    },
  });
};

function evaluatePriorExtremeBreakoutEngine(
  strategyId: string,
  candles: StrategyPriceCandle[],
  config: Record<string, unknown>,
  context: StrategyEngineContext,
  defaults: { lookback: number; minLookback: number; bufferPct: number; periodLabel: string },
): StrategyEvaluationResult {
  const lookback = Math.max(defaults.minLookback, parseNumber(config.lookback, defaults.lookback));
  const bufferPct = parseNumber(config.bufferPct, defaults.bufferPct);
  const priorWindow = candles.slice(-lookback - 1, -1);
  const rangeHigh = priorWindow.length ? Math.max(...priorWindow.map((item) => item.high)) : 0;
  const rangeLow = priorWindow.length ? Math.min(...priorWindow.map((item) => item.low)) : 0;
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (last.close > rangeHigh - buffer) {
    bias = 'bullish';
    if (last.close > rangeHigh + buffer) decision = 'buy';
  } else if (last.close < rangeLow + buffer) {
    bias = 'bearish';
    if (last.close < rangeLow - buffer) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId,
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 34 : 6),
    reasons: [
      `${defaults.periodLabel} high/low breakout over prior ${priorWindow.length} bars (excluding latest)`,
      `Range high ${rangeHigh.toFixed(5)} / low ${rangeLow.toFixed(5)}`,
      decision === 'buy'
        ? `Close confirmed above ${defaults.periodLabel.toLowerCase()} high with buffer`
        : decision === 'sell'
          ? `Close confirmed below ${defaults.periodLabel.toLowerCase()} low with buffer`
          : `Price inside ${defaults.periodLabel.toLowerCase()} range — no breakout`,
    ],
    metrics: {
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
      range: Number((rangeHigh - rangeLow).toFixed(5)),
      priorBars: priorWindow.length,
    },
    events: decision !== 'wait'
      ? [{
        label: decision === 'buy' ? `${defaults.periodLabel.toLowerCase()} breakout long` : `${defaults.periodLabel.toLowerCase()} breakout short`,
        detail: `Break of ${decision === 'buy' ? 'high' : 'low'} ${decision === 'buy' ? rangeHigh.toFixed(5) : rangeLow.toFixed(5)}`,
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: last.candleIndex,
      }]
      : [],
  });
}

export const evaluateDailyHighLowBreakoutEngine: StrategyEngine = (candles, config, context) =>
  evaluatePriorExtremeBreakoutEngine('daily-high-low-breakout', candles, config, context, {
    lookback: 24,
    minLookback: 12,
    bufferPct: 0.04,
    periodLabel: 'Daily',
  });

export const evaluateWeeklyBreakoutEngine: StrategyEngine = (candles, config, context) =>
  evaluatePriorExtremeBreakoutEngine('weekly-breakout', candles, config, context, {
    lookback: 100,
    minLookback: 40,
    bufferPct: 0.05,
    periodLabel: 'Weekly',
  });

export const evaluateTriangleBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(24, parseNumber(config.lookback, 45));
  const bufferPct = parseNumber(config.bufferPct, 0.03);
  const window = candles.slice(-lookback);
  const third = Math.max(3, Math.floor(window.length / 3));
  const early = window.slice(0, third);
  const mid = window.slice(third, third * 2);
  const late = window.slice(third * 2, -1);
  const patternWindow = late.length >= 3 ? late : window.slice(-Math.max(3, Math.floor(window.length / 4)), -1);
  const earlyHigh = Math.max(...early.map((item) => item.high));
  const midHigh = Math.max(...mid.map((item) => item.high));
  const lateHigh = patternWindow.length ? Math.max(...patternWindow.map((item) => item.high)) : midHigh;
  const earlyLow = Math.min(...early.map((item) => item.low));
  const midLow = Math.min(...mid.map((item) => item.low));
  const lateLow = patternWindow.length ? Math.min(...patternWindow.map((item) => item.low)) : midLow;
  const convergingHighs = earlyHigh > midHigh && midHigh >= lateHigh * 0.998;
  const convergingLows = earlyLow < midLow && midLow <= lateLow * 1.002;
  const symmetrical = convergingHighs && convergingLows;
  const ascending = convergingLows && !convergingHighs && Math.abs(earlyHigh - lateHigh) / Math.max(earlyHigh, 0.00001) < 0.004;
  const descending = convergingHighs && !convergingLows && Math.abs(earlyLow - lateLow) / Math.max(earlyLow, 0.00001) < 0.004;
  const patternKind = symmetrical ? 'symmetrical' : ascending ? 'ascending' : descending ? 'descending' : 'unconfirmed';
  const apexHigh = Math.max(lateHigh, midHigh);
  const apexLow = Math.min(lateLow, midLow);
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  const patternValid = symmetrical || ascending || descending;
  if (patternValid && last.close > apexHigh - buffer) {
    bias = 'bullish';
    if (last.close > apexHigh + buffer) decision = 'buy';
  } else if (patternValid && last.close < apexLow + buffer) {
    bias = 'bearish';
    if (last.close < apexLow - buffer) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'triangle-breakout',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 30 + (patternValid ? 14 : 0) + (decision !== 'wait' ? 32 : 6),
    reasons: [
      `Triangle pattern scan over ${lookback} bars (${patternKind})`,
      patternValid
        ? `Converging structure — apex high ${apexHigh.toFixed(5)} / low ${apexLow.toFixed(5)}`
        : 'No converging triangle structure detected in lookback window',
      decision === 'buy'
        ? 'Close confirmed above triangle apex high'
        : decision === 'sell'
          ? 'Close confirmed below triangle apex low'
          : patternValid
            ? 'Pattern staged — awaiting apex breakout confirmation'
            : 'No triangle breakout signal',
    ],
    metrics: {
      patternKind,
      apexHigh: Number(apexHigh.toFixed(5)),
      apexLow: Number(apexLow.toFixed(5)),
      convergingHighs: convergingHighs ? 'yes' : 'no',
      convergingLows: convergingLows ? 'yes' : 'no',
    },
    events: decision !== 'wait'
      ? [{
        label: `${patternKind} triangle breakout`,
        detail: decision === 'buy' ? 'Break above apex high' : 'Break below apex low',
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: last.candleIndex,
      }]
      : [],
  });
};

export const evaluateRectangleBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const bufferPct = parseNumber(config.bufferPct, 0.03);
  const flatnessPct = parseNumber(config.flatnessPct, 18);
  const window = candles.slice(-lookback, -1);
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const rangeSize = Math.max(rangeHigh - rangeLow, 0.00001);
  const highSpread = Math.max(...window.map((item) => item.high)) - Math.min(...window.map((item) => item.high));
  const lowSpread = Math.max(...window.map((item) => item.low)) - Math.min(...window.map((item) => item.low));
  const flatTop = (highSpread / rangeSize) * 100 <= flatnessPct;
  const flatBottom = (lowSpread / rangeSize) * 100 <= flatnessPct;
  const isRectangle = flatTop && flatBottom;
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (isRectangle && last.close > rangeHigh + buffer) {
    bias = 'bullish';
    decision = 'buy';
  } else if (isRectangle && last.close < rangeLow - buffer) {
    bias = 'bearish';
    decision = 'sell';
  } else if (isRectangle && last.close > rangeHigh - buffer) {
    bias = 'bullish';
  } else if (isRectangle && last.close < rangeLow + buffer) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'rectangle-breakout',
    context,
    config: { ...config, lookback, bufferPct, flatnessPct },
    candles,
    decision,
    bias,
    confidence: 32 + (isRectangle ? 12 : 0) + (decision !== 'wait' ? 34 : 4),
    reasons: [
      `Rectangle range scan over ${window.length} bars (flatness threshold ${flatnessPct}%)`,
      isRectangle
        ? `Flat box high ${rangeHigh.toFixed(5)} / low ${rangeLow.toFixed(5)} · width ${rangeSize.toFixed(5)}`
        : `Range not flat enough — top spread ${((highSpread / rangeSize) * 100).toFixed(1)}% / bottom ${((lowSpread / rangeSize) * 100).toFixed(1)}%`,
      decision === 'buy'
        ? 'Close confirmed above rectangle high'
        : decision === 'sell'
          ? 'Close confirmed below rectangle low'
          : isRectangle
            ? 'Rectangle formed — awaiting boundary breakout'
            : 'No rectangle breakout setup',
    ],
    metrics: {
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
      rangeSize: Number(rangeSize.toFixed(5)),
      flatTop: flatTop ? 'yes' : 'no',
      flatBottom: flatBottom ? 'yes' : 'no',
    },
    events: decision !== 'wait'
      ? [{
        label: 'rectangle breakout',
        detail: decision === 'buy' ? 'Upside break of flat range' : 'Downside break of flat range',
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: last.candleIndex,
      }]
      : [],
  });
};

export const evaluateVolatilityBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const atrPeriod = Math.max(7, parseNumber(config.atrPeriod, 14));
  const compressionRatio = parseNumber(config.compressionRatio, 0.75);
  const expansionMultiple = parseNumber(config.expansionMultiple, 1.4);
  const atrSeries = atr(candles, atrPeriod);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const baseline = candles.slice(Math.max(0, lastIndex - atrPeriod * 2), lastIndex);
  const baselineAvgRange = averageCandleRange(baseline);
  const recent = candles.slice(Math.max(0, lastIndex - 5), lastIndex);
  const recentAvgRange = averageCandleRange(recent);
  const atrNow = atrSeries[lastIndex] ?? baselineAvgRange;
  const compressed = baselineAvgRange > 0 && recentAvgRange / baselineAvgRange <= compressionRatio;
  const lastRange = last.high - last.low;
  const expanding = atrNow > 0 && lastRange >= atrNow * expansionMultiple;
  const bullishBar = last.close > last.open && last.close >= last.low + lastRange * 0.65;
  const bearishBar = last.close < last.open && last.close <= last.high - lastRange * 0.65;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (compressed && expanding && bullishBar) {
    bias = 'bullish';
    decision = 'buy';
  } else if (compressed && expanding && bearishBar) {
    bias = 'bearish';
    decision = 'sell';
  } else if (expanding && bullishBar) {
    bias = 'bullish';
  } else if (expanding && bearishBar) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'volatility-breakout',
    context,
    config: { ...config, atrPeriod, compressionRatio, expansionMultiple },
    candles,
    decision,
    bias,
    confidence: 30 + (compressed ? 12 : 0) + (expanding ? 14 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      `Volatility breakout — ATR(${atrPeriod}) compression → expansion model`,
      compressed
        ? `Recent range compressed to ${((recentAvgRange / Math.max(baselineAvgRange, 0.00001)) * 100).toFixed(0)}% of baseline`
        : 'No clear compression phase in recent window',
      expanding
        ? `Latest bar range ${lastRange.toFixed(5)} expands ${(lastRange / Math.max(atrNow, 0.00001)).toFixed(2)}× ATR`
        : `Latest bar not expanding beyond ${expansionMultiple}× ATR threshold`,
      decision === 'buy'
        ? 'Bullish expansion bar closing near high'
        : decision === 'sell'
          ? 'Bearish expansion bar closing near low'
          : 'Awaiting volatility expansion breakout',
    ],
    metrics: {
      atr: atrNow != null ? Number(atrNow.toFixed(5)) : null,
      lastRange: Number(lastRange.toFixed(5)),
      expansionAtrMultiple: Number((lastRange / Math.max(atrNow, 0.00001)).toFixed(2)),
      compressionPct: Number(((recentAvgRange / Math.max(baselineAvgRange, 0.00001)) * 100).toFixed(1)),
    },
    events: decision !== 'wait'
      ? [{
        label: 'volatility expansion',
        detail: decision === 'buy' ? 'Bullish ATR expansion breakout' : 'Bearish ATR expansion breakout',
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: last.candleIndex,
      }]
      : [],
  });
};

export const evaluateNewsBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(6, parseNumber(config.quietBars, 12));
  const impulseRatio = parseNumber(config.impulseRatio, 2.2);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const quietWindow = candles.slice(Math.max(0, lastIndex - quietBars), lastIndex);
  const quietAvgRange = averageCandleRange(quietWindow);
  const lastRange = last.high - last.low;
  const impulse = quietAvgRange > 0 && lastRange >= quietAvgRange * impulseRatio;
  const bullishImpulse = impulse && last.close > last.open && last.close >= last.low + lastRange * 0.7;
  const bearishImpulse = impulse && last.close < last.open && last.close <= last.high - lastRange * 0.7;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (bullishImpulse) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishImpulse) {
    bias = 'bearish';
    decision = 'sell';
  } else if (impulse && last.close > last.open) {
    bias = 'bullish';
  } else if (impulse && last.close < last.open) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'news-breakout',
    context,
    config: { ...config, quietBars, impulseRatio },
    candles,
    decision,
    bias,
    confidence: 28 + (quietAvgRange > 0 ? 10 : 0) + (impulse ? 18 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [
      `News-style impulse breakout after ${quietWindow.length}-bar quiet baseline`,
      quietAvgRange > 0
        ? `Quiet average range ${quietAvgRange.toFixed(5)} vs impulse bar ${lastRange.toFixed(5)} (${(lastRange / quietAvgRange).toFixed(2)}×)`
        : 'Quiet baseline unavailable',
      decision === 'buy'
        ? 'Bullish displacement bar — event expansion long'
        : decision === 'sell'
          ? 'Bearish displacement bar — event expansion short'
          : impulse
            ? 'Impulse detected but close location not decisive'
            : 'No news-style displacement on latest bar',
    ],
    metrics: {
      quietAvgRange: Number(quietAvgRange.toFixed(5)),
      impulseRange: Number(lastRange.toFixed(5)),
      impulseMultiple: Number((lastRange / Math.max(quietAvgRange, 0.00001)).toFixed(2)),
    },
    events: decision !== 'wait'
      ? [{
        label: 'news impulse',
        detail: decision === 'buy' ? 'Bullish event displacement' : 'Bearish event displacement',
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: last.candleIndex,
      }]
      : [],
  });
};

export const evaluateRangeExpansionBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const baselineBars = Math.max(10, parseNumber(config.baselineBars, 20));
  const expansionRatio = parseNumber(config.expansionRatio, 1.35);
  const bufferPct = parseNumber(config.bufferPct, 0.03);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const baseline = candles.slice(Math.max(0, lastIndex - baselineBars - 3), lastIndex - 3);
  const recent = candles.slice(Math.max(0, lastIndex - 3), lastIndex);
  const baselineAvg = averageCandleRange(baseline);
  const recentAvg = averageCandleRange(recent.length ? recent : [last]);
  const expanding = baselineAvg > 0 && recentAvg / baselineAvg >= expansionRatio;
  const recentHigh = recent.length ? Math.max(...recent.map((item) => item.high)) : last.high;
  const recentLow = recent.length ? Math.min(...recent.map((item) => item.low)) : last.low;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (expanding && last.close > recentHigh - buffer) {
    bias = 'bullish';
    if (last.close > recentHigh + buffer) decision = 'buy';
  } else if (expanding && last.close < recentLow + buffer) {
    bias = 'bearish';
    if (last.close < recentLow - buffer) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'range-expansion-breakout',
    context,
    config: { ...config, baselineBars, expansionRatio, bufferPct },
    candles,
    decision,
    bias,
    confidence: 32 + (expanding ? 16 : 0) + (decision !== 'wait' ? 32 : 6),
    reasons: [
      `Range expansion breakout — baseline ${baseline.length} bars vs recent ${recent.length || 1} bars`,
      expanding
        ? `Recent range expanded ${(recentAvg / Math.max(baselineAvg, 0.00001)).toFixed(2)}× vs baseline (threshold ${expansionRatio}×)`
        : `Expansion ratio ${(recentAvg / Math.max(baselineAvg, 0.00001)).toFixed(2)}× below ${expansionRatio}× threshold`,
      decision === 'buy'
        ? 'Close confirmed above expansion window high'
        : decision === 'sell'
          ? 'Close confirmed below expansion window low'
          : expanding
            ? 'Expansion active — awaiting directional close beyond window'
            : 'No range expansion breakout',
    ],
    metrics: {
      baselineAvgRange: Number(baselineAvg.toFixed(5)),
      recentAvgRange: Number(recentAvg.toFixed(5)),
      expansionMultiple: Number((recentAvg / Math.max(baselineAvg, 0.00001)).toFixed(2)),
      windowHigh: Number(recentHigh.toFixed(5)),
      windowLow: Number(recentLow.toFixed(5)),
    },
    events: decision !== 'wait'
      ? [{
        label: 'range expansion',
        detail: decision === 'buy' ? 'Upside range expansion breakout' : 'Downside range expansion breakout',
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: last.candleIndex,
      }]
      : [],
  });
};

export const evaluateLiquidityBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const bufferPct = parseNumber(config.bufferPct, 0.02);
  const window = candles.slice(-lookback - 1, -1);
  const poolHigh = Math.max(...window.map((item) => item.high));
  const poolLow = Math.min(...window.map((item) => item.low));
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  const bullishContinuation = last.high > poolHigh + buffer && last.close > poolHigh + buffer;
  const bearishContinuation = last.low < poolLow - buffer && last.close < poolLow - buffer;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (bullishContinuation) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishContinuation) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close > poolHigh - buffer) {
    bias = 'bullish';
  } else if (last.close < poolLow + buffer) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'liquidity-breakout',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 36 : 6),
    reasons: [
      `Liquidity pool breakout over ${lookback}-bar lookback`,
      `Pool high ${poolHigh.toFixed(5)} / low ${poolLow.toFixed(5)}`,
      bullishContinuation
        ? 'Buy-side liquidity swept with continuation close above pool high'
        : bearishContinuation
          ? 'Sell-side liquidity swept with continuation close below pool low'
          : 'No liquidity continuation breakout on latest bar',
    ],
    metrics: {
      poolHigh: Number(poolHigh.toFixed(5)),
      poolLow: Number(poolLow.toFixed(5)),
    },
    events: decision !== 'wait'
      ? [{
        label: 'liquidity continuation',
        detail: decision === 'buy' ? 'Continuation above liquidity pool' : 'Continuation below liquidity pool',
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: last.candleIndex,
      }]
      : [],
  });
};

export const evaluateFakeBreakoutReversalEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const bufferPct = parseNumber(config.bufferPct, 0.02);
  const window = candles.slice(-lookback - 2, -2);
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const trapBar = candles[candles.length - 2];
  const confirmBar = candles[candles.length - 1]!;
  if (!trapBar) {
    return buildEvaluationResult({
      strategyId: 'fake-breakout-reversal',
      context,
      config: { ...config, lookback, bufferPct },
      candles,
      decision: 'wait',
      bias: 'neutral',
      confidence: 20,
      reasons: ['Insufficient bars for fake breakout trap detection'],
      metrics: {},
    });
  }
  const buffer = confirmBar.close * (bufferPct / 100);
  const bearTrap = trapBar.high > rangeHigh + buffer && trapBar.close < rangeHigh;
  const bullTrap = trapBar.low < rangeLow - buffer && trapBar.close > rangeLow;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (bearTrap && confirmBar.close < rangeHigh - buffer && confirmBar.close < confirmBar.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (bullTrap && confirmBar.close > rangeLow + buffer && confirmBar.close > confirmBar.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearTrap) {
    bias = 'bearish';
  } else if (bullTrap) {
    bias = 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'fake-breakout-reversal',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 30 + ((bearTrap || bullTrap) ? 16 : 0) + (decision !== 'wait' ? 32 : 0),
    reasons: [
      `Fake breakout reversal — ${lookback}-bar range trap detection`,
      `Range high ${rangeHigh.toFixed(5)} / low ${rangeLow.toFixed(5)}`,
      bearTrap
        ? 'Bear trap: prior bar swept above range high then closed back inside'
        : bullTrap
          ? 'Bull trap: prior bar swept below range low then closed back inside'
          : 'No trap wick on prior bar',
      decision === 'sell'
        ? 'Fade confirmed — bearish reversal after bull trap'
        : decision === 'buy'
          ? 'Fade confirmed — bullish reversal after bear trap'
          : (bearTrap || bullTrap)
            ? 'Trap detected — awaiting confirmation close'
            : 'No fake breakout reversal signal',
    ],
    metrics: {
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
      bearTrap: bearTrap ? 'yes' : 'no',
      bullTrap: bullTrap ? 'yes' : 'no',
    },
    events: decision !== 'wait'
      ? [{
        label: 'fake breakout fade',
        detail: decision === 'buy' ? 'Fade bull trap — long reversal' : 'Fade bear trap — short reversal',
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: confirmBar.candleIndex,
      }]
      : [],
  });
};

export const evaluateConsolidationBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(18, parseNumber(config.lookback, 36));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const compressionRatio = parseNumber(config.compressionRatio, 0.7);
  const expansionRatio = parseNumber(config.expansionRatio, 1.15);
  const window = candles.slice(-lookback);
  const sliceStart = Math.max(1, Math.floor(window.length / 3));
  const sliceEnd = Math.max(sliceStart + 2, Math.floor((window.length * 2) / 3));
  const consolidation = window.slice(sliceStart, sliceEnd);
  const postWindow = window.slice(sliceEnd);
  const boxHigh = Math.max(...consolidation.map((item) => item.high));
  const boxLow = Math.min(...consolidation.map((item) => item.low));
  const fullAvgRange = averageCandleRange(window);
  const boxAvgRange = averageCandleRange(consolidation);
  const postAvgRange = postWindow.length ? averageCandleRange(postWindow) : averageCandleRange(window.slice(-3));
  const compressed = fullAvgRange > 0 && boxAvgRange / fullAvgRange <= compressionRatio;
  const expanding = boxAvgRange > 0 && postAvgRange / boxAvgRange >= expansionRatio;
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  const brokeUp = last.close > boxHigh + buffer;
  const brokeDown = last.close < boxLow - buffer;
  if (last.close > boxHigh - buffer) {
    bias = 'bullish';
    if (compressed && brokeUp && (expanding || postAvgRange >= boxAvgRange)) decision = 'buy';
  } else if (last.close < boxLow + buffer) {
    bias = 'bearish';
    if (compressed && brokeDown && (expanding || postAvgRange >= boxAvgRange)) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'consolidation-breakout',
    context,
    config: { ...config, lookback, bufferPct, compressionRatio, expansionRatio },
    candles,
    decision,
    bias,
    confidence: 32 + (compressed ? 12 : 0) + (expanding ? 10 : 0) + (decision !== 'wait' ? 30 : 4),
    reasons: [
      `Consolidation breakout — middle-third box (bars ${sliceStart}-${sliceEnd}) of ${lookback}-bar window`,
      compressed
        ? `Box compressed to ${((boxAvgRange / Math.max(fullAvgRange, 0.00001)) * 100).toFixed(0)}% of window average range`
        : 'Consolidation box not sufficiently compressed',
      `Box high ${boxHigh.toFixed(5)} / low ${boxLow.toFixed(5)}`,
      expanding
        ? `Post-consolidation expansion ${(postAvgRange / Math.max(boxAvgRange, 0.00001)).toFixed(2)}× vs box baseline`
        : 'Expansion confirmation muted',
      decision === 'buy'
        ? 'Close broke above consolidation high with expansion'
        : decision === 'sell'
          ? 'Close broke below consolidation low with expansion'
          : 'Inside consolidation or awaiting expansion breakout',
    ],
    metrics: {
      boxHigh: Number(boxHigh.toFixed(5)),
      boxLow: Number(boxLow.toFixed(5)),
      compressionPct: Number(((boxAvgRange / Math.max(fullAvgRange, 0.00001)) * 100).toFixed(1)),
      expansionMultiple: Number((postAvgRange / Math.max(boxAvgRange, 0.00001)).toFixed(2)),
    },
    events: decision !== 'wait'
      ? [{
        label: 'consolidation breakout',
        detail: decision === 'buy' ? 'Break above consolidation box' : 'Break below consolidation box',
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: last.candleIndex,
      }]
      : [],
  });
};

export const evaluateFairValueGapEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 60));
  const minGapPct = parseNumber(config.minGapPct, 0.02);
  const last = candles.length - 1;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  let gapHigh: number | null = null;
  let gapLow: number | null = null;

  for (let index = last - 2; index >= Math.max(2, last - lookback); index -= 1) {
    const left = candles[index - 1];
    const middle = candles[index];
    const right = candles[index + 1];
    const bullishGap = right.low > left.high;
    const bearishGap = right.high < left.low;
    const gapSize = bullishGap
      ? ((right.low - left.high) / middle.close) * 100
      : bearishGap
        ? ((left.low - right.high) / middle.close) * 100
        : 0;
    if (gapSize < minGapPct) continue;

    if (bullishGap) {
      gapLow = left.high;
      gapHigh = right.low;
      bias = 'bullish';
      const lastCandle = candles[last];
      if (lastCandle.low <= gapHigh && lastCandle.close > gapLow) decision = 'buy';
      break;
    }
    if (bearishGap) {
      gapHigh = left.low;
      gapLow = right.high;
      bias = 'bearish';
      const lastCandle = candles[last];
      if (lastCandle.high >= gapLow && lastCandle.close < gapHigh) decision = 'sell';
      break;
    }
  }

  return buildEvaluationResult({
    strategyId: 'fair-value-gap-fvg',
    context,
    config: { ...config, lookback, minGapPct },
    candles,
    decision,
    bias,
    confidence: 32 + (decision !== 'wait' ? 38 : 0) + (gapHigh != null ? 14 : 0),
    reasons: [
      'ICT-style fair value gap (3-candle imbalance) detection',
      gapHigh != null && gapLow != null ? `Active FVG zone ${gapLow.toFixed(5)} – ${gapHigh.toFixed(5)}` : 'No qualifying FVG in lookback window',
      decision === 'buy' ? 'Bullish mitigation into demand gap' : decision === 'sell' ? 'Bearish mitigation into supply gap' : 'Awaiting gap retest',
    ],
    metrics: {
      gapHigh: gapHigh != null ? Number(gapHigh.toFixed(5)) : null,
      gapLow: gapLow != null ? Number(gapLow.toFixed(5)) : null,
    },
  });
};

export const evaluatePinBarEngine: StrategyEngine = (candles, config, context) => {
  const wickRatio = parseNumber(config.wickRatio, 2);
  const bodyMaxPct = parseNumber(config.bodyMaxPct, 35);
  const last = candles.length - 1;
  const candle = candles[last];
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const bodyPct = range === 0 ? 0 : (body / range) * 100;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  const bullishPin = bodyPct <= bodyMaxPct && lowerWick >= body * wickRatio && upperWick <= body;
  const bearishPin = bodyPct <= bodyMaxPct && upperWick >= body * wickRatio && lowerWick <= body;
  if (bullishPin) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishPin) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'pin-bar-strategy',
    context,
    config: { ...config, wickRatio, bodyMaxPct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 36 : 0) + Math.min(16, (Math.max(upperWick, lowerWick) / (range || 1)) * 100),
    reasons: [
      `Pin bar rejection model (wick ≥ ${wickRatio}× body, body ≤ ${bodyMaxPct}% of range)`,
      bullishPin ? 'Bullish pin bar — long lower wick rejection' : bearishPin ? 'Bearish pin bar — long upper wick rejection' : 'Latest bar is not a qualifying pin bar',
      `Range ${range.toFixed(5)} / body ${body.toFixed(5)}`,
    ],
    metrics: {
      upperWick: Number(upperWick.toFixed(5)),
      lowerWick: Number(lowerWick.toFixed(5)),
      bodyPct: Number(bodyPct.toFixed(1)),
    },
    events: decision !== 'wait'
      ? [{ label: decision === 'buy' ? 'bullish pin' : 'bearish pin', detail: 'Institutional rejection candle', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateBreakAndRetestEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const retestTolerancePct = parseNumber(config.retestTolerancePct, 0.08);
  const last = candles.length - 1;
  const window = candles.slice(-lookback, -1);
  const swingHigh = Math.max(...window.map((item) => item.high));
  const swingLow = Math.min(...window.map((item) => item.low));
  const close = candles[last].close;
  const tolerance = close * (retestTolerancePct / 100);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  const brokeAbove = window.some((item) => item.close > swingHigh) && close > swingHigh - tolerance;
  const brokeBelow = window.some((item) => item.close < swingLow) && close < swingLow + tolerance;
  const retestHoldAbove = brokeAbove && Math.abs(close - swingHigh) <= tolerance && close >= swingHigh;
  const retestRejectBelow = brokeBelow && Math.abs(close - swingLow) <= tolerance && close <= swingLow;

  if (retestHoldAbove) {
    bias = 'bullish';
    decision = 'buy';
  } else if (retestRejectBelow) {
    bias = 'bearish';
    decision = 'sell';
  } else if (close > swingHigh) {
    bias = 'bullish';
  } else if (close < swingLow) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'break-and-retest',
    context,
    config: { ...config, lookback, retestTolerancePct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 35 : 8),
    reasons: [
      `Structure break + retest over ${lookback} bars`,
      `Swing high ${swingHigh.toFixed(5)} / low ${swingLow.toFixed(5)}`,
      decision === 'buy' ? 'Break above structure with successful retest hold' : decision === 'sell' ? 'Break below structure with retest rejection' : 'No confirmed break-and-retest on latest bar',
    ],
    metrics: {
      swingHigh: Number(swingHigh.toFixed(5)),
      swingLow: Number(swingLow.toFixed(5)),
    },
  });
};

export const evaluateBollingerMeanReversionEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 20));
  const stdDev = parseNumber(config.stdDev, 2);
  const rsiPeriod = Math.max(5, parseNumber(config.rsiPeriod, 14));
  const closes = candles.map((item) => item.close);
  const bands = bollinger(closes, period, stdDev);
  const rsiSeries = rsi(closes, rsiPeriod);
  const last = closes.length - 1;
  const close = closes[last];
  const upper = bands.upper[last];
  const lower = bands.lower[last];
  const middle = bands.middle[last];
  const rsiValue = rsiSeries[last];
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  if (lower != null && close <= lower && rsiValue != null && rsiValue <= 40) {
    bias = 'bullish';
    decision = 'buy';
  } else if (upper != null && close >= upper && rsiValue != null && rsiValue >= 60) {
    bias = 'bearish';
    decision = 'sell';
  } else if (middle != null) {
    bias = close > middle ? 'bullish' : close < middle ? 'bearish' : 'neutral';
  }

  return buildEvaluationResult({
    strategyId: 'bollinger-mean-reversion',
    context,
    config: { ...config, period, stdDev, rsiPeriod },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 0) + (rsiValue != null ? Math.min(18, Math.abs(rsiValue - 50) / 2) : 0),
    reasons: [
      `Bollinger(${period}, ${stdDev}) + RSI(${rsiPeriod}) mean reversion confluence`,
      rsiValue != null ? `RSI ${rsiValue.toFixed(1)}` : 'RSI unavailable',
      decision === 'buy' ? 'Price at lower band with oversold RSI — snap-back long' : decision === 'sell' ? 'Price at upper band with overbought RSI — fade short' : 'No band extreme reversion signal',
    ],
    metrics: {
      upper: upper != null ? Number(upper.toFixed(5)) : null,
      lower: lower != null ? Number(lower.toFixed(5)) : null,
      rsi: rsiValue != null ? Number(rsiValue.toFixed(2)) : null,
    },
  });
};

export const evaluateLiquidityGrabEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const sweepBufferPct = parseNumber(config.sweepBufferPct, 0.02);
  const window = candles.slice(-lookback - 1, -1);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex];
  const recentHigh = Math.max(...window.map((item) => item.high));
  const recentLow = Math.min(...window.map((item) => item.low));
  const sweepBuffer = last.close * (sweepBufferPct / 100);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  const bearishGrab = last.high > recentHigh + sweepBuffer && last.close < recentHigh;
  const bullishGrab = last.low < recentLow - sweepBuffer && last.close > recentLow;
  if (bullishGrab) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishGrab) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'liquidity-grab-strategy',
    context,
    config: { ...config, lookback, sweepBufferPct },
    candles,
    decision,
    bias,
    confidence: 33 + (decision !== 'wait' ? 38 : 0),
    reasons: [
      `Liquidity grab / stop hunt over ${lookback} bars`,
      `Recent high ${recentHigh.toFixed(5)} / low ${recentLow.toFixed(5)}`,
      bullishGrab ? 'Sweep below lows with close back inside — bullish grab' : bearishGrab ? 'Sweep above highs with close back inside — bearish grab' : 'No liquidity grab on latest bar',
    ],
    metrics: {
      recentHigh: Number(recentHigh.toFixed(5)),
      recentLow: Number(recentLow.toFixed(5)),
    },
    events: decision !== 'wait'
      ? [{ label: 'liquidity grab', detail: decision === 'buy' ? 'Buy-side liquidity sweep reversal' : 'Sell-side liquidity sweep reversal', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: lastIndex }]
      : [],
  });
};

export const evaluateStochasticEngine: StrategyEngine = (candles, config, context) => {
  const kPeriod = Math.max(5, parseNumber(config.kPeriod, 14));
  const dPeriod = Math.max(2, parseNumber(config.dPeriod, 3));
  const oversold = parseNumber(config.oversold, 20);
  const overbought = parseNumber(config.overbought, 80);
  const { k, d } = stochastic(candles, kPeriod, dPeriod);
  const last = candles.length - 1;
  const kNow = k[last];
  const kPrev = k[last - 1];
  const dNow = d[last];
  const dPrev = d[last - 1];
  const cross = crossover(kPrev, kNow, dPrev, dNow);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  if (kNow != null) {
    if (kNow >= 55) bias = 'bullish';
    else if (kNow <= 45) bias = 'bearish';
    if (cross === 'bullish_cross' && kNow <= oversold + 15) decision = 'buy';
    if (cross === 'bearish_cross' && kNow >= overbought - 15) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'stochastic-strategy',
    context,
    config: { ...config, kPeriod, dPeriod, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 35 + (cross !== 'none' ? 28 : 0) + (kNow != null ? Math.min(20, Math.abs(kNow - 50) / 2) : 0),
    reasons: [
      `Stochastic(${kPeriod}, ${dPeriod}) oscillator crossover model`,
      kNow != null && dNow != null ? `%K ${kNow.toFixed(1)} / %D ${dNow.toFixed(1)} (${oversold}/${overbought} zones)` : 'Stochastic unavailable',
      cross !== 'none' ? `${cross.replace('_', ' ')} detected` : 'No fresh stochastic crossover',
    ],
    metrics: {
      k: kNow != null ? Number(kNow.toFixed(2)) : null,
      d: dNow != null ? Number(dNow.toFixed(2)) : null,
    },
    events: cross !== 'none'
      ? [{ label: cross.replace('_', ' '), detail: 'Stochastic %K / %D crossover', tone: cross === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

function projectTrendlinePrice(line: TrendlineDetection, candleIndex: number): number {
  const slope = (line.endPrice - line.startPrice) / Math.max(1, line.endCandleIndex - line.startCandleIndex);
  return line.startPrice + slope * (candleIndex - line.startCandleIndex);
}

export const evaluateTrendlineBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const minValidity = parseNumber(config.minValidity, 0.45);
  const breakLookback = Math.max(1, parseNumber(config.breakLookback, 3));
  const bufferPct = parseNumber(config.bufferPct, 0.03);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const analysis = analyzeTrendlines(reconstructed);
  const lastIndex = candles.length - 1;
  const lastCandle = candles[lastIndex]!;
  const lastBarIndex = lastCandle.candleIndex;
  const buffer = lastCandle.close * (bufferPct / 100);

  const dominant = analysis.trendlines.find((line) => line.validityScore >= minValidity) ?? analysis.trendlines[0] ?? null;
  const recentBreak = analysis.breaks
    .filter((event) => event.candleIndex >= lastBarIndex - breakLookback)
    .sort((a, b) => b.breakQualityScore - a.breakQualityScore)[0] ?? null;

  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  if (recentBreak) {
    if (recentBreak.breakDirection === 'bullish_break') {
      bias = 'bullish';
      decision = recentBreak.breakQualityScore >= 0.5 && recentBreak.falseBreakProbability <= 0.55 ? 'buy' : 'wait';
    } else if (recentBreak.breakDirection === 'bearish_break') {
      bias = 'bearish';
      decision = recentBreak.breakQualityScore >= 0.5 && recentBreak.falseBreakProbability <= 0.55 ? 'sell' : 'wait';
    }
  } else if (dominant) {
    bias = dominant.direction === 'bullish' ? 'bullish' : dominant.direction === 'bearish' ? 'bearish' : 'neutral';
    const projected = projectTrendlinePrice(dominant, lastBarIndex);
    const brokeUp = lastCandle.close > projected + buffer;
    const brokeDown = lastCandle.close < projected - buffer;
    if (dominant.breakProbability >= minValidity && brokeUp && dominant.direction !== 'bullish') {
      decision = 'buy';
      bias = 'bullish';
    } else if (dominant.breakProbability >= minValidity && brokeDown && dominant.direction !== 'bearish') {
      decision = 'sell';
      bias = 'bearish';
    } else if (analysis.summary.directionalBias === 'BUY_CONTEXT' && dominant.breakStatus === 'break_pressure_active') {
      decision = 'buy';
      bias = 'bullish';
    } else if (analysis.summary.directionalBias === 'SELL_CONTEXT' && dominant.breakStatus === 'break_pressure_active') {
      decision = 'sell';
      bias = 'bearish';
    }
  }

  const confidence = 34
    + (decision !== 'wait' ? 30 : 0)
    + (dominant ? Math.round(dominant.validityScore * 24) : 0)
    + (recentBreak ? Math.round(recentBreak.breakQualityScore * 20) : 0);

  const events = recentBreak
    ? [{
      label: recentBreak.breakDirection.replace('_', ' '),
      detail: recentBreak.explanationText,
      tone: recentBreak.breakDirection === 'bullish_break' ? 'emerald' as const : 'rose' as const,
      barIndex: recentBreak.candleIndex,
    }]
    : dominant && decision !== 'wait'
      ? [{
        label: 'trendline break',
        detail: dominant.aiExplanation,
        tone: decision === 'buy' ? 'emerald' as const : 'rose' as const,
        barIndex: lastBarIndex,
      }]
      : [];

  return buildEvaluationResult({
    strategyId: 'trendline-breakout',
    context,
    config: { ...config, minValidity, breakLookback, bufferPct },
    candles,
    decision,
    bias,
    confidence,
    reasons: [
      'Institutional trendline engine: swing RANSAC + break-quality + liquidity-trap scoring',
      dominant
        ? `Dominant ${dominant.trendlineKind.replace(/_/g, ' ')} (${dominant.direction}) validity ${(dominant.validityScore * 100).toFixed(0)}%`
        : analysis.summary.explanation,
      recentBreak
        ? `Fresh break quality ${(recentBreak.breakQualityScore * 100).toFixed(0)}% — false-break risk ${(recentBreak.falseBreakProbability * 100).toFixed(0)}%`
        : decision !== 'wait'
          ? `Close broke projected trendline with ${dominant?.breakStatus ?? 'break'} pressure`
          : dominant?.breakStatus === 'break_watch'
            ? 'Break watch active — awaiting close confirmation beyond trendline'
            : 'No confirmed trendline breakout on latest bar',
    ],
    metrics: {
      trendlines: analysis.trendlines.length,
      validity: dominant != null ? Number((dominant.validityScore * 100).toFixed(1)) : null,
      breakProbability: dominant != null ? Number((dominant.breakProbability * 100).toFixed(1)) : null,
      projectedPrice: dominant != null ? Number(projectTrendlinePrice(dominant, lastBarIndex).toFixed(5)) : null,
      touchCount: dominant?.touchCount ?? null,
    },
    events,
  });
};

export const evaluateHigherHighsHigherLowsEngine: StrategyEngine = (candles, config, context) => {
  const swingDepth = Math.max(2, parseNumber(config.swingDepth, 5));
  const minStrength = parseNumber(config.minStrength, 0.35);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const analysis = analyzeSwingPoints(reconstructed, {
    depths: [2, 4, swingDepth],
    zigzagPercent: 0.08,
  });

  const usable = analysis.swings.filter((swing) => swing.strengthScore >= minStrength);
  const highs = usable.filter((swing) => swing.swingKind === 'high').slice(-3);
  const lows = usable.filter((swing) => swing.swingKind === 'low').slice(-3);
  const lastHigh = highs.at(-1);
  const prevHigh = highs.at(-2);
  const lastLow = lows.at(-1);
  const prevLow = lows.at(-2);

  const higherHigh = lastHigh != null && prevHigh != null && lastHigh.priceLevel > prevHigh.priceLevel;
  const lowerHigh = lastHigh != null && prevHigh != null && lastHigh.priceLevel < prevHigh.priceLevel;
  const higherLow = lastLow != null && prevLow != null && lastLow.priceLevel > prevLow.priceLevel;
  const lowerLow = lastLow != null && prevLow != null && lastLow.priceLevel < prevLow.priceLevel;

  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  if (higherHigh && higherLow) {
    bias = 'bullish';
    decision = 'buy';
  } else if (lowerHigh && lowerLow) {
    bias = 'bearish';
    decision = 'sell';
  } else if (higherHigh || higherLow) {
    bias = 'bullish';
  } else if (lowerHigh || lowerLow) {
    bias = 'bearish';
  } else if (analysis.summary.trendState === 'bullish') {
    bias = 'bullish';
  } else if (analysis.summary.trendState === 'bearish') {
    bias = 'bearish';
  }

  const sequenceScore = (higherHigh ? 25 : 0) + (higherLow ? 25 : 0) + (lowerHigh ? -25 : 0) + (lowerLow ? -25 : 0);
  const confidence = 32
    + (decision !== 'wait' ? 32 : 12)
    + Math.min(24, Math.abs(sequenceScore))
    + Math.round(analysis.summary.confidence * 20);

  const events = decision !== 'wait' && lastHigh != null
    ? [{
      label: decision === 'buy' ? 'bullish structure' : 'bearish structure',
      detail: `${higherHigh ? 'HH' : lowerHigh ? 'LH' : '—'} / ${higherLow ? 'HL' : lowerLow ? 'LL' : '—'} at swing ${lastHigh.candleIndex}`,
      tone: decision === 'buy' ? 'emerald' as const : 'rose' as const,
      barIndex: lastHigh.candleIndex,
    }]
    : [];

  return buildEvaluationResult({
    strategyId: 'higher-highs-and-higher-lows',
    context,
    config: { ...config, swingDepth, minStrength },
    candles,
    decision,
    bias,
    confidence,
    reasons: [
      'Institutional swing-point market structure: HH/HL bullish vs LH/LL bearish',
      lastHigh != null && prevHigh != null
        ? `Swing highs ${prevHigh.priceLevel.toFixed(5)} → ${lastHigh.priceLevel.toFixed(5)} (${higherHigh ? 'HH' : lowerHigh ? 'LH' : 'equal'})`
        : 'Insufficient validated swing highs',
      lastLow != null && prevLow != null
        ? `Swing lows ${prevLow.priceLevel.toFixed(5)} → ${lastLow.priceLevel.toFixed(5)} (${higherLow ? 'HL' : lowerLow ? 'LL' : 'equal'})`
        : 'Insufficient validated swing lows',
      decision === 'buy'
        ? 'Full bullish sequence — trend continuation long bias'
        : decision === 'sell'
          ? 'Full bearish sequence — trend continuation short bias'
          : 'Mixed structure — await HH/HL or LH/LL confirmation',
    ],
    metrics: {
      swingCount: usable.length,
      lastHigh: lastHigh != null ? Number(lastHigh.priceLevel.toFixed(5)) : null,
      lastLow: lastLow != null ? Number(lastLow.priceLevel.toFixed(5)) : null,
      trendState: analysis.summary.trendState,
      structuralBias: analysis.summary.structuralBias,
    },
    events,
  });
};

function averageCandleRange(candles: StrategyPriceCandle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / candles.length;
}

export const evaluateTrendContinuationPatternEngine: StrategyEngine = (candles, config, context) => {
  const trendPeriod = Math.max(20, parseNumber(config.trendPeriod, 50));
  const impulseLookback = Math.max(12, parseNumber(config.impulseLookback, 24));
  const patternBars = Math.max(6, parseNumber(config.patternBars, 12));
  const compressionThreshold = parseNumber(config.compressionThreshold, 0.72);
  const breakoutBufferPct = parseNumber(config.breakoutBufferPct, 0.03);
  const closes = candles.map((item) => item.close);
  const trendEma = ema(closes, trendPeriod);
  const atrSeries = atr(candles, 14);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const setupStart = Math.max(0, lastIndex - patternBars);
  const impulseStart = Math.max(0, setupStart - impulseLookback);
  const impulseWindow = candles.slice(impulseStart, setupStart);
  const setupWindow = candles.slice(setupStart, lastIndex);
  const fallbackSetup = setupWindow.length > 0 ? setupWindow : candles.slice(Math.max(0, lastIndex - patternBars), lastIndex);
  const patternHigh = Math.max(...fallbackSetup.map((item) => item.high));
  const patternLow = Math.min(...fallbackSetup.map((item) => item.low));
  const patternRange = patternHigh - patternLow;
  const impulseStartClose = impulseWindow[0]?.close ?? candles[0]?.close ?? last.close;
  const impulseEndClose = impulseWindow.at(-1)?.close ?? fallbackSetup[0]?.close ?? last.close;
  const impulseMove = impulseEndClose - impulseStartClose;
  const impulseRange = Math.max(
    Math.max(...(impulseWindow.length ? impulseWindow : candles.slice(0, setupStart || lastIndex)).map((item) => item.high))
      - Math.min(...(impulseWindow.length ? impulseWindow : candles.slice(0, setupStart || lastIndex)).map((item) => item.low)),
    averageCandleRange(candles.slice(Math.max(0, lastIndex - 30), lastIndex)),
  );
  const impulseAtr = atrSeries[setupStart - 1] ?? atrSeries[lastIndex - patternBars] ?? atrSeries[lastIndex] ?? averageCandleRange(candles.slice(-20));
  const impulseAtrMultiple = impulseAtr > 0 ? Math.abs(impulseMove) / impulseAtr : 0;
  const setupAverageRange = averageCandleRange(fallbackSetup);
  const impulseAverageRange = averageCandleRange(impulseWindow.length ? impulseWindow : candles.slice(Math.max(0, setupStart - impulseLookback), setupStart));
  const compressionRatio = impulseAverageRange > 0
    ? setupAverageRange / impulseAverageRange
    : patternRange > 0 && impulseRange > 0
      ? patternRange / impulseRange
      : 1;
  const compressed = compressionRatio <= compressionThreshold;
  const emaNow = trendEma[lastIndex];
  const emaPrev = trendEma[Math.max(0, lastIndex - Math.min(patternBars, 10))];
  const emaSlopePct = emaNow != null && emaPrev != null && emaPrev !== 0
    ? ((emaNow - emaPrev) / emaPrev) * 100
    : 0;
  const trendBullish = emaNow != null && last.close > emaNow && emaSlopePct >= 0;
  const trendBearish = emaNow != null && last.close < emaNow && emaSlopePct <= 0;
  const impulseBullish = impulseMove > 0 && impulseAtrMultiple >= 1.1;
  const impulseBearish = impulseMove < 0 && impulseAtrMultiple >= 1.1;
  const setupSlope = fallbackSetup.length >= 2
    ? fallbackSetup.at(-1)!.close - fallbackSetup[0]!.close
    : 0;
  const firstHalf = fallbackSetup.slice(0, Math.max(1, Math.floor(fallbackSetup.length / 2)));
  const secondHalf = fallbackSetup.slice(Math.max(1, Math.floor(fallbackSetup.length / 2)));
  const firstHalfRange = Math.max(...firstHalf.map((item) => item.high)) - Math.min(...firstHalf.map((item) => item.low));
  const secondHalfRange = secondHalf.length
    ? Math.max(...secondHalf.map((item) => item.high)) - Math.min(...secondHalf.map((item) => item.low))
    : firstHalfRange;
  const counterTrendFlag = (trendBullish && setupSlope < 0) || (trendBearish && setupSlope > 0);
  const pennantCompression = firstHalfRange > 0 && secondHalfRange / firstHalfRange <= 0.85;
  const patternKind = counterTrendFlag
    ? 'flag'
    : pennantCompression
      ? 'pennant'
      : compressed
        ? 'range compression'
        : 'unconfirmed';
  const buffer = last.close * (breakoutBufferPct / 100);
  const bullishBreakout = last.close > patternHigh + buffer && last.close > last.open;
  const bearishBreakout = last.close < patternLow - buffer && last.close < last.open;

  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (trendBullish && impulseBullish) {
    bias = 'bullish';
    if (compressed && bullishBreakout) decision = 'buy';
  } else if (trendBearish && impulseBearish) {
    bias = 'bearish';
    if (compressed && bearishBreakout) decision = 'sell';
  } else if (trendBullish || impulseBullish) {
    bias = 'bullish';
  } else if (trendBearish || impulseBearish) {
    bias = 'bearish';
  }

  const institutionalScore = [
    trendBullish || trendBearish,
    impulseBullish || impulseBearish,
    compressed,
    counterTrendFlag || pennantCompression,
    decision !== 'wait',
  ].filter(Boolean).length;

  return buildEvaluationResult({
    strategyId: 'trend-continuation-pattern-strategy',
    context,
    config: { ...config, trendPeriod, impulseLookback, patternBars, compressionThreshold, breakoutBufferPct },
    candles,
    decision,
    bias,
    confidence: 28 + institutionalScore * 12 + (decision !== 'wait' ? 18 : 0) + Math.min(10, impulseAtrMultiple * 2),
    reasons: [
      `Continuation pattern engine: EMA(${trendPeriod}) regime + ${impulseLookback}-bar impulse + ${patternBars}-bar pattern box`,
      trendBullish
        ? 'Trend regime bullish: price above rising EMA'
        : trendBearish
          ? 'Trend regime bearish: price below falling EMA'
          : 'Trend regime not fully aligned',
      impulseBullish
        ? `Bullish impulse leg validated at ${impulseAtrMultiple.toFixed(2)} ATR`
        : impulseBearish
          ? `Bearish impulse leg validated at ${impulseAtrMultiple.toFixed(2)} ATR`
          : `Impulse leg weak at ${impulseAtrMultiple.toFixed(2)} ATR`,
      compressed
        ? `${patternKind} setup compressed to ${(compressionRatio * 100).toFixed(0)}% of impulse range behavior`
        : `Pattern still too wide: compression ratio ${(compressionRatio * 100).toFixed(0)}%`,
      decision === 'buy'
        ? 'Trend-aligned bullish breakout closed above continuation boundary'
        : decision === 'sell'
          ? 'Trend-aligned bearish breakout closed below continuation boundary'
          : 'Awaiting close-confirmed breakout in trend direction',
    ],
    metrics: {
      patternKind,
      trendEma: emaNow != null ? Number(emaNow.toFixed(5)) : null,
      emaSlopePct: Number(emaSlopePct.toFixed(4)),
      impulseAtrMultiple: Number(impulseAtrMultiple.toFixed(2)),
      compressionRatio: Number(compressionRatio.toFixed(3)),
      patternHigh: Number(patternHigh.toFixed(5)),
      patternLow: Number(patternLow.toFixed(5)),
      breakoutBufferPct,
    },
    events: decision !== 'wait'
      ? [{
        label: `${patternKind} breakout`,
        detail: decision === 'buy' ? 'Continuation break above consolidation high' : 'Continuation break below consolidation low',
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: lastIndex,
      }]
      : compressed && bias !== 'neutral'
        ? [{
          label: `${patternKind} setup`,
          detail: 'Continuation structure is staged; breakout confirmation pending',
          tone: 'violet',
          barIndex: lastIndex,
        }]
        : [],
  });
};

function distanceToZone(price: number, zone: SupportResistanceZone): number {
  if (price >= zone.zoneLow && price <= zone.zoneHigh) return 0;
  return Math.min(Math.abs(price - zone.zoneLow), Math.abs(price - zone.zoneHigh));
}

function nearestZone(
  price: number,
  zones: SupportResistanceZone[],
  side: 'support' | 'resistance',
): SupportResistanceZone | null {
  const directional = zones.filter((zone) => {
    if (side === 'support') return zone.zoneType === 'support' || zone.zoneType === 'dynamic' || zone.zoneType === 'psychological';
    return zone.zoneType === 'resistance' || zone.zoneType === 'dynamic' || zone.zoneType === 'psychological';
  });
  return directional.sort((left, right) => distanceToZone(price, left) - distanceToZone(price, right))[0] ?? null;
}

export const evaluateDynamicSupportResistanceTrendEngine: StrategyEngine = (candles, config, context) => {
  const trendPeriod = Math.max(20, parseNumber(config.trendPeriod, 50));
  const valuePeriod = Math.max(8, parseNumber(config.valuePeriod, 21));
  const zoneLookback = Math.max(30, parseNumber(config.zoneLookback, 80));
  const atrTolerance = parseNumber(config.atrTolerance, 0.65);
  const minZoneStrength = parseNumber(config.minZoneStrength, 0.38);
  const closes = candles.map((item) => item.close);
  const trendEma = ema(closes, trendPeriod);
  const valueEma = ema(closes, valuePeriod);
  const atrSeries = atr(candles, 14);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const prior = candles[lastIndex - 1] ?? last;
  const trendNow = trendEma[lastIndex];
  const trendPrev = trendEma[Math.max(0, lastIndex - 8)];
  const valueNow = valueEma[lastIndex];
  const atrNow = atrSeries[lastIndex] ?? averageCandleRange(candles.slice(-20));
  const tolerance = Math.max(last.close * 0.00015, atrNow * atrTolerance);
  const emaSlopePct = trendNow != null && trendPrev != null && trendPrev !== 0
    ? ((trendNow - trendPrev) / trendPrev) * 100
    : 0;
  const trendBullish = trendNow != null && last.close >= trendNow && emaSlopePct >= 0;
  const trendBearish = trendNow != null && last.close <= trendNow && emaSlopePct <= 0;

  const reconstructed = strategyCandlesToReconstructed(candles.slice(-zoneLookback));
  const analysis = analyzeSupportResistance(reconstructed);
  const qualifiedZones = analysis.zones.filter((zone) => zone.strengthScore >= minZoneStrength);
  const supportZone = nearestZone(last.close, qualifiedZones, 'support');
  const resistanceZone = nearestZone(last.close, qualifiedZones, 'resistance');
  const supportDistance = supportZone ? distanceToZone(last.close, supportZone) : Number.POSITIVE_INFINITY;
  const resistanceDistance = resistanceZone ? distanceToZone(last.close, resistanceZone) : Number.POSITIVE_INFINITY;
  const valueDistance = valueNow != null ? Math.abs(last.close - valueNow) : Number.POSITIVE_INFINITY;
  const nearSupport = supportZone != null && supportDistance <= tolerance;
  const nearResistance = resistanceZone != null && resistanceDistance <= tolerance;
  const nearValue = valueNow != null && valueDistance <= tolerance;
  const range = Math.max(last.high - last.low, 0.00001);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const bullishRejection = lowerWick / range >= 0.34 && last.close >= Math.max(last.open, prior.close);
  const bearishRejection = upperWick / range >= 0.34 && last.close <= Math.min(last.open, prior.close);
  const reclaimedValue = valueNow != null && prior.close < valueNow && last.close >= valueNow;
  const rejectedValue = valueNow != null && prior.close > valueNow && last.close <= valueNow;

  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let selectedZone: SupportResistanceZone | null = null;
  let entrySource = 'none';

  if (trendBullish) {
    bias = 'bullish';
    selectedZone = supportZone;
    if ((nearSupport || nearValue) && (bullishRejection || reclaimedValue)) {
      decision = 'buy';
      entrySource = nearSupport ? 'institutional support retest' : 'dynamic EMA value retest';
    } else if (nearSupport || nearValue) {
      entrySource = nearSupport ? 'support retest pending rejection' : 'dynamic value retest pending rejection';
    }
  } else if (trendBearish) {
    bias = 'bearish';
    selectedZone = resistanceZone;
    if ((nearResistance || nearValue) && (bearishRejection || rejectedValue)) {
      decision = 'sell';
      entrySource = nearResistance ? 'institutional resistance retest' : 'dynamic EMA value retest';
    } else if (nearResistance || nearValue) {
      entrySource = nearResistance ? 'resistance retest pending rejection' : 'dynamic value retest pending rejection';
    }
  } else if (last.close > (trendNow ?? last.close)) {
    bias = 'bullish';
  } else if (last.close < (trendNow ?? last.close)) {
    bias = 'bearish';
  }

  const zoneStrength = selectedZone?.strengthScore ?? 0;
  const rejectionScore = decision === 'buy'
    ? Math.max(lowerWick / range, reclaimedValue ? 0.55 : 0)
    : decision === 'sell'
      ? Math.max(upperWick / range, rejectedValue ? 0.55 : 0)
      : Math.max(lowerWick, upperWick) / range;

  return buildEvaluationResult({
    strategyId: 'dynamic-support-and-resistance-trend-trading',
    context,
    config: { ...config, trendPeriod, valuePeriod, zoneLookback, atrTolerance, minZoneStrength },
    candles,
    decision,
    bias,
    confidence: 30
      + (trendBullish || trendBearish ? 18 : 0)
      + (nearSupport || nearResistance || nearValue ? 16 : 0)
      + Math.round(zoneStrength * 18)
      + Math.min(16, rejectionScore * 18)
      + (decision !== 'wait' ? 12 : 0),
    reasons: [
      `Dynamic S/R trend engine: EMA(${trendPeriod}) regime + EMA(${valuePeriod}) value band + institutional zone map`,
      trendBullish
        ? 'Bullish trend regime: price above rising trend EMA'
        : trendBearish
          ? 'Bearish trend regime: price below falling trend EMA'
          : 'Trend regime is transitional; retest entries disabled',
      selectedZone
        ? `${selectedZone.zoneType} zone ${selectedZone.zoneLow.toFixed(5)}-${selectedZone.zoneHigh.toFixed(5)} strength ${(selectedZone.strengthScore * 100).toFixed(0)}%`
        : 'No qualified institutional zone near current price',
      nearValue
        ? `Price is inside dynamic value tolerance around EMA(${valuePeriod})`
        : valueNow != null
          ? `Price is ${(valueDistance / Math.max(atrNow, 0.00001)).toFixed(2)} ATR from dynamic value`
          : 'Dynamic value EMA unavailable',
      decision === 'buy'
        ? `Long continuation confirmed from ${entrySource}`
        : decision === 'sell'
          ? `Short continuation confirmed from ${entrySource}`
          : entrySource === 'none'
            ? 'No defended trend retest on the latest bar'
            : `${entrySource}; awaiting stronger rejection close`,
    ],
    metrics: {
      trendEma: trendNow != null ? Number(trendNow.toFixed(5)) : null,
      valueEma: valueNow != null ? Number(valueNow.toFixed(5)) : null,
      emaSlopePct: Number(emaSlopePct.toFixed(4)),
      atr: Number(atrNow.toFixed(5)),
      entrySource,
      selectedZoneType: selectedZone?.zoneType ?? null,
      selectedZoneMidpoint: selectedZone ? Number(selectedZone.midpointPrice.toFixed(5)) : null,
      selectedZoneStrength: selectedZone ? Number((selectedZone.strengthScore * 100).toFixed(1)) : null,
      zoneDistanceAtr: selectedZone ? Number((distanceToZone(last.close, selectedZone) / Math.max(atrNow, 0.00001)).toFixed(2)) : null,
      valueDistanceAtr: valueNow != null ? Number((valueDistance / Math.max(atrNow, 0.00001)).toFixed(2)) : null,
      rejectionScore: Number((rejectionScore * 100).toFixed(1)),
      qualifiedZones: qualifiedZones.length,
    },
    events: decision !== 'wait'
      ? [{
        label: decision === 'buy' ? 'support trend retest' : 'resistance trend retest',
        detail: `${entrySource} with ${Math.round(rejectionScore * 100)}% rejection score`,
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: lastIndex,
      }]
      : selectedZone && (nearSupport || nearResistance || nearValue)
        ? [{
          label: 'trend retest watch',
          detail: `${entrySource} at ${selectedZone.zoneType} zone`,
          tone: 'violet',
          barIndex: lastIndex,
        }]
        : [],
  });
};

export const evaluateFibonacciTrendContinuationEngine: StrategyEngine = (candles, config, context) => {
  const trendPeriod = Math.max(20, parseNumber(config.trendPeriod, 50));
  const swingLookback = Math.max(30, parseNumber(config.swingLookback, 55));
  const minRetracement = parseNumber(config.minRetracement, 0.382);
  const maxRetracement = Math.max(minRetracement + 0.05, parseNumber(config.maxRetracement, 0.618));
  const toleranceAtr = parseNumber(config.toleranceAtr, 0.25);
  const closes = candles.map((item) => item.close);
  const trendEma = ema(closes, trendPeriod);
  const atrSeries = atr(candles, 14);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const prior = candles[lastIndex - 1] ?? last;
  const trendNow = trendEma[lastIndex];
  const trendPrev = trendEma[Math.max(0, lastIndex - 10)];
  const atrNow = atrSeries[lastIndex] ?? averageCandleRange(candles.slice(-20));
  const emaSlopePct = trendNow != null && trendPrev != null && trendPrev !== 0
    ? ((trendNow - trendPrev) / trendPrev) * 100
    : 0;
  const trendBullish = trendNow != null && last.close >= trendNow && emaSlopePct >= 0;
  const trendBearish = trendNow != null && last.close <= trendNow && emaSlopePct <= 0;
  const windowStart = Math.max(0, candles.length - swingLookback);
  const window = candles.slice(windowStart);
  const highPoint = window.reduce((best, candle, offset) => (
    candle.high > best.price ? { price: candle.high, index: windowStart + offset } : best
  ), { price: Number.NEGATIVE_INFINITY, index: windowStart });
  const lowPoint = window.reduce((best, candle, offset) => (
    candle.low < best.price ? { price: candle.low, index: windowStart + offset } : best
  ), { price: Number.POSITIVE_INFINITY, index: windowStart });
  const impulseBullish = lowPoint.index < highPoint.index;
  const impulseBearish = highPoint.index < lowPoint.index;
  const impulseLow = impulseBullish ? lowPoint.price : lowPoint.price;
  const impulseHigh = impulseBearish ? highPoint.price : highPoint.price;
  const impulseRange = Math.max(impulseHigh - impulseLow, 0.00001);
  const impulseAtrMultiple = atrNow > 0 ? impulseRange / atrNow : 0;
  const bullishRetracement = (impulseHigh - last.close) / impulseRange;
  const bearishRetracement = (last.close - impulseLow) / impulseRange;
  const activeRetracement = trendBullish && impulseBullish
    ? bullishRetracement
    : trendBearish && impulseBearish
      ? bearishRetracement
      : trendBullish
        ? bullishRetracement
        : bearishRetracement;
  const fib382Bull = impulseHigh - impulseRange * 0.382;
  const fib50Bull = impulseHigh - impulseRange * 0.5;
  const fib618Bull = impulseHigh - impulseRange * 0.618;
  const fib382Bear = impulseLow + impulseRange * 0.382;
  const fib50Bear = impulseLow + impulseRange * 0.5;
  const fib618Bear = impulseLow + impulseRange * 0.618;
  const tolerance = Math.max(atrNow * toleranceAtr, last.close * 0.0001);
  const inBullishPocket = activeRetracement >= minRetracement - tolerance / impulseRange
    && activeRetracement <= maxRetracement + tolerance / impulseRange
    && last.close <= fib382Bull + tolerance
    && last.close >= fib618Bull - tolerance;
  const inBearishPocket = activeRetracement >= minRetracement - tolerance / impulseRange
    && activeRetracement <= maxRetracement + tolerance / impulseRange
    && last.close >= fib382Bear - tolerance
    && last.close <= fib618Bear + tolerance;
  const range = Math.max(last.high - last.low, 0.00001);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const bullishRejection = lowerWick / range >= 0.32 && last.close >= Math.max(last.open, prior.close);
  const bearishRejection = upperWick / range >= 0.32 && last.close <= Math.min(last.open, prior.close);
  const reclaimedBullMid = prior.close < fib50Bull && last.close >= fib50Bull;
  const rejectedBearMid = prior.close > fib50Bear && last.close <= fib50Bear;

  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let setupState = 'no qualified Fibonacci trend setup';
  if (trendBullish && impulseBullish && impulseAtrMultiple >= 1.2) {
    bias = 'bullish';
    setupState = inBullishPocket ? 'bullish Fibonacci value pocket' : 'bullish trend outside Fibonacci pocket';
    if (inBullishPocket && (bullishRejection || reclaimedBullMid)) decision = 'buy';
  } else if (trendBearish && impulseBearish && impulseAtrMultiple >= 1.2) {
    bias = 'bearish';
    setupState = inBearishPocket ? 'bearish Fibonacci value pocket' : 'bearish trend outside Fibonacci pocket';
    if (inBearishPocket && (bearishRejection || rejectedBearMid)) decision = 'sell';
  } else if (trendBullish || impulseBullish) {
    bias = 'bullish';
  } else if (trendBearish || impulseBearish) {
    bias = 'bearish';
  }

  const retracementQuality = activeRetracement >= minRetracement && activeRetracement <= maxRetracement
    ? 1
    : Math.max(0, 1 - Math.min(Math.abs(activeRetracement - 0.5), 0.5) * 2);
  const rejectionScore = decision === 'buy'
    ? Math.max(lowerWick / range, reclaimedBullMid ? 0.55 : 0)
    : decision === 'sell'
      ? Math.max(upperWick / range, rejectedBearMid ? 0.55 : 0)
      : Math.max(lowerWick, upperWick) / range;
  const extension127 = decision === 'sell'
    ? impulseLow - impulseRange * 0.272
    : impulseHigh + impulseRange * 0.272;
  const extension161 = decision === 'sell'
    ? impulseLow - impulseRange * 0.618
    : impulseHigh + impulseRange * 0.618;

  return buildEvaluationResult({
    strategyId: 'fibonacci-trend-continuation',
    context,
    config: { ...config, trendPeriod, swingLookback, minRetracement, maxRetracement, toleranceAtr },
    candles,
    decision,
    bias,
    confidence: 30
      + (trendBullish || trendBearish ? 18 : 0)
      + (impulseAtrMultiple >= 1.2 ? 16 : 0)
      + Math.round(retracementQuality * 18)
      + Math.min(14, rejectionScore * 16)
      + (decision !== 'wait' ? 12 : 0),
    reasons: [
      `Fibonacci continuation engine: EMA(${trendPeriod}) trend filter + ${swingLookback}-bar impulse anchors`,
      trendBullish
        ? 'Bullish trend regime: price above rising EMA'
        : trendBearish
          ? 'Bearish trend regime: price below falling EMA'
          : 'Trend regime transitional; Fibonacci entries disabled',
      impulseBullish
        ? `Bullish impulse anchored from ${impulseLow.toFixed(5)} to ${impulseHigh.toFixed(5)}`
        : impulseBearish
          ? `Bearish impulse anchored from ${impulseHigh.toFixed(5)} to ${impulseLow.toFixed(5)}`
          : 'Impulse anchor order is not usable',
      `Current retracement ${(activeRetracement * 100).toFixed(1)}% vs pocket ${(minRetracement * 100).toFixed(1)}%-${(maxRetracement * 100).toFixed(1)}%`,
      decision === 'buy'
        ? 'Bullish Fibonacci continuation confirmed by rejection/reclaim in value pocket'
        : decision === 'sell'
          ? 'Bearish Fibonacci continuation confirmed by rejection/reclaim in value pocket'
          : `${setupState}; awaiting valid rejection close`,
    ],
    metrics: {
      setupState,
      trendEma: trendNow != null ? Number(trendNow.toFixed(5)) : null,
      emaSlopePct: Number(emaSlopePct.toFixed(4)),
      impulseLow: Number(impulseLow.toFixed(5)),
      impulseHigh: Number(impulseHigh.toFixed(5)),
      impulseAtrMultiple: Number(impulseAtrMultiple.toFixed(2)),
      retracementPct: Number((activeRetracement * 100).toFixed(1)),
      fib382: Number((bias === 'bearish' ? fib382Bear : fib382Bull).toFixed(5)),
      fib50: Number((bias === 'bearish' ? fib50Bear : fib50Bull).toFixed(5)),
      fib618: Number((bias === 'bearish' ? fib618Bear : fib618Bull).toFixed(5)),
      extension127: Number(extension127.toFixed(5)),
      extension161: Number(extension161.toFixed(5)),
      rejectionScore: Number((rejectionScore * 100).toFixed(1)),
    },
    events: decision !== 'wait'
      ? [{
        label: decision === 'buy' ? 'fib continuation long' : 'fib continuation short',
        detail: `${(activeRetracement * 100).toFixed(1)}% retracement reaction with ${Math.round(rejectionScore * 100)}% rejection score`,
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: lastIndex,
      }]
      : (inBullishPocket || inBearishPocket) && bias !== 'neutral'
        ? [{
          label: 'fib value pocket',
          detail: `Retracement ${(activeRetracement * 100).toFixed(1)}% inside continuation pocket`,
          tone: 'violet',
          barIndex: lastIndex,
        }]
        : [],
  });
};

function projectChannelLine(startIndex: number, startPrice: number, endIndex: number, endPrice: number, index: number): number {
  if (endIndex === startIndex) return startPrice;
  const ratio = (index - startIndex) / (endIndex - startIndex);
  return startPrice + (endPrice - startPrice) * ratio;
}

function mapChannelAction(action: ChannelDetection['recommendedAction']): StrategySignalSide {
  if (action === 'BUY') return 'buy';
  if (action === 'SELL') return 'sell';
  return 'wait';
}

export const evaluateChannelTrendTradingEngine: StrategyEngine = (candles, config, context) => {
  const minQuality = parseNumber(config.minQuality, 0.36);
  const boundaryBufferPct = parseNumber(config.boundaryBufferPct, 0.04);
  const minBreakoutProbability = parseNumber(config.minBreakoutProbability, 0.56);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const analysis = analyzeChannels(reconstructed);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const lastBarIndex = last.candleIndex;
  const atrSeries = atr(candles, 14);
  const atrNow = atrSeries[lastIndex] ?? averageCandleRange(candles.slice(-14));
  const buffer = last.close * (boundaryBufferPct / 100);
  const range = Math.max(last.high - last.low, 0.00001);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);

  const channel = analysis.channels.find((item) => item.qualityScore >= minQuality) ?? analysis.channels[0] ?? null;
  const topPressure = [...analysis.breakoutPressure]
    .filter((item) => item.boundary === 'upper')
    .sort((a, b) => b.pressureScore - a.pressureScore)[0] ?? null;
  const bottomPressure = [...analysis.breakoutPressure]
    .filter((item) => item.boundary === 'lower')
    .sort((a, b) => b.pressureScore - a.pressureScore)[0] ?? null;

  const upperBound = channel
    ? projectChannelLine(channel.startCandleIndex, channel.upperStartPrice, channel.endCandleIndex, channel.upperEndPrice, lastBarIndex)
    : null;
  const lowerBound = channel
    ? projectChannelLine(channel.startCandleIndex, channel.lowerStartPrice, channel.endCandleIndex, channel.lowerEndPrice, lastBarIndex)
    : null;

  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let entrySource = 'none';

  if (channel && upperBound != null && lowerBound != null) {
    const channelSpan = Math.max(upperBound - lowerBound, 0.00001);
    const positionInChannel = (last.close - lowerBound) / channelSpan;
    const nearLower = last.low <= lowerBound + atrNow * 0.35;
    const nearUpper = last.high >= upperBound - atrNow * 0.35;
    const brokeUpper = last.close > upperBound + buffer;
    const brokeLower = last.close < lowerBound - buffer;
    const bullishRejection = nearLower && last.close > lowerBound && (last.close >= last.open || lowerWick / range >= 0.35);
    const bearishRejection = nearUpper && last.close < upperBound && (last.close <= last.open || upperWick / range >= 0.35);

    if (channel.liquidityRisk >= 0.74) {
      entrySource = 'liquidity trap risk elevated';
    } else if (channel.direction === 'ascending') {
      bias = 'bullish';
      if (brokeUpper && channel.breakoutProbability >= minBreakoutProbability) {
        decision = 'buy';
        entrySource = 'ascending channel upper breakout';
      } else if (bullishRejection) {
        decision = 'buy';
        entrySource = 'lower boundary rejection in ascending channel';
      } else if (nearLower && last.close > (lowerBound + upperBound) / 2) {
        decision = 'buy';
        entrySource = 'demand-side channel pullback';
      } else if (brokeLower) {
        decision = 'sell';
        entrySource = 'ascending channel failure break';
        bias = 'bearish';
      }
    } else if (channel.direction === 'descending') {
      bias = 'bearish';
      if (brokeLower && channel.breakoutProbability >= minBreakoutProbability) {
        decision = 'sell';
        entrySource = 'descending channel lower breakout';
      } else if (bearishRejection) {
        decision = 'sell';
        entrySource = 'upper boundary rejection in descending channel';
      } else if (nearUpper && last.close < (lowerBound + upperBound) / 2) {
        decision = 'sell';
        entrySource = 'supply-side channel pullback';
      } else if (brokeUpper) {
        decision = 'buy';
        entrySource = 'descending channel failure break';
        bias = 'bullish';
      }
    } else {
      bias = positionInChannel > 0.58 ? 'bullish' : positionInChannel < 0.42 ? 'bearish' : 'neutral';
      if (bullishRejection && positionInChannel <= 0.35) {
        decision = 'buy';
        entrySource = 'horizontal channel lower boundary bounce';
      } else if (bearishRejection && positionInChannel >= 0.65) {
        decision = 'sell';
        entrySource = 'horizontal channel upper boundary fade';
      } else if (brokeUpper && (topPressure?.pressureScore ?? 0) >= 0.5) {
        decision = 'buy';
        entrySource = 'horizontal channel upside breakout';
      } else if (brokeLower && (bottomPressure?.pressureScore ?? 0) >= 0.5) {
        decision = 'sell';
        entrySource = 'horizontal channel downside breakout';
      }
    }

    if (decision === 'wait') {
      const mapped = mapChannelAction(channel.recommendedAction);
      if (mapped !== 'wait' && channel.breakoutProbability >= minBreakoutProbability && channel.liquidityRisk < 0.74) {
        decision = mapped;
        entrySource = `institutional channel action ${channel.recommendedAction}`;
        bias = mapped === 'buy' ? 'bullish' : 'bearish';
      }
    }
  }

  const rejectionScore = decision === 'buy'
    ? lowerWick / range
    : decision === 'sell'
      ? upperWick / range
      : Math.max(lowerWick, upperWick) / range;

  const events = decision !== 'wait'
    ? [{
      label: decision === 'buy' ? 'channel trend long' : 'channel trend short',
      detail: entrySource,
      tone: decision === 'buy' ? 'emerald' as const : 'rose' as const,
      barIndex: lastBarIndex,
    }]
    : channel && (nearLowerBoundary(last, lowerBound, atrNow) || nearUpperBoundary(last, upperBound, atrNow))
      ? [{
        label: channel.direction === 'ascending' ? 'channel pullback' : channel.direction === 'descending' ? 'channel retest' : 'channel boundary touch',
        detail: channel.institutionalInterpretation,
        tone: 'violet' as const,
        barIndex: lastBarIndex,
      }]
      : [];

  return buildEvaluationResult({
    strategyId: 'channel-trend-trading',
    context,
    config: { ...config, minQuality, boundaryBufferPct, minBreakoutProbability },
    candles,
    decision,
    bias,
    confidence: 28
      + (channel ? Math.round(channel.qualityScore * 24) : 0)
      + (decision !== 'wait' ? 22 : 0)
      + Math.round((channel?.breakoutProbability ?? 0) * 16)
      + Math.min(14, rejectionScore * 14)
      + (channel && channel.liquidityRisk >= 0.74 ? -12 : 0),
    reasons: [
      'Institutional channel engine: swing parallel + regression corridor + breakout pressure scoring',
      channel
        ? `${channel.channelType.replace(/_/g, ' ')} (${channel.direction}) quality ${(channel.qualityScore * 100).toFixed(0)}%`
        : analysis.summary.explanation,
      channel
        ? `Containment ${(channel.containmentScore * 100).toFixed(0)}% · breakout probability ${(channel.breakoutProbability * 100).toFixed(0)}% · liquidity risk ${(channel.liquidityRisk * 100).toFixed(0)}%`
        : 'No institutional-quality channel detected on latest capture',
      channel?.institutionalInterpretation ?? 'Awaiting valid parallel channel formation',
      decision === 'buy'
        ? `Long channel trend confirmed: ${entrySource}`
        : decision === 'sell'
          ? `Short channel trend confirmed: ${entrySource}`
          : entrySource === 'none'
            ? 'No qualified boundary retest or breakout on latest bar'
            : `${entrySource}; standing aside until confirmation improves`,
    ],
    metrics: {
      channelType: channel?.channelType ?? null,
      channelDirection: channel?.direction ?? null,
      qualityScore: channel ? Number((channel.qualityScore * 100).toFixed(1)) : null,
      containmentPct: channel ? Number((channel.containmentScore * 100).toFixed(1)) : null,
      breakoutProbability: channel ? Number((channel.breakoutProbability * 100).toFixed(1)) : null,
      liquidityRisk: channel ? Number((channel.liquidityRisk * 100).toFixed(1)) : null,
      upperBound: upperBound != null ? Number(upperBound.toFixed(5)) : null,
      lowerBound: lowerBound != null ? Number(lowerBound.toFixed(5)) : null,
      positionInChannel: channel && upperBound != null && lowerBound != null
        ? Number((((last.close - lowerBound) / Math.max(upperBound - lowerBound, 0.00001)) * 100).toFixed(1))
        : null,
      entrySource,
      touchCount: channel?.touchCount ?? null,
      falseBreakCount: channel?.falseBreakCount ?? null,
    },
    events,
  });
};

function nearLowerBoundary(candle: StrategyPriceCandle, lowerBound: number | null, atrNow: number): boolean {
  return lowerBound != null && candle.low <= lowerBound + atrNow * 0.35;
}

function nearUpperBoundary(candle: StrategyPriceCandle, upperBound: number | null, atrNow: number): boolean {
  return upperBound != null && candle.high >= upperBound - atrNow * 0.35;
}

export const evaluateTrendAccelerationEngine: StrategyEngine = (candles, config, context) => {
  const trendPeriod = Math.max(10, parseNumber(config.trendPeriod, 21));
  const slopeLookback = Math.max(3, parseNumber(config.slopeLookback, 5));
  const adxPeriod = Math.max(7, parseNumber(config.adxPeriod, 14));
  const minAdx = parseNumber(config.minAdx, 20);
  const expansionRatio = parseNumber(config.expansionRatio, 1.15);
  const closes = candles.map((item) => item.close);
  const trendEma = ema(closes, trendPeriod);
  const atrSeries = atr(candles, 14);
  const { adx: adxSeries, plusDi, minusDi } = adx(candles, adxPeriod);
  const { histogram } = macd(closes, 12, 26, 9);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const lb = slopeLookback;
  const lb2 = Math.min(lastIndex, lb * 2);

  const emaNow = trendEma[lastIndex];
  const emaLb = trendEma[lastIndex - lb];
  const emaLb2 = trendEma[lastIndex - lb2];
  const slopeNow = emaNow != null && emaLb != null && emaLb !== 0
    ? ((emaNow - emaLb) / emaLb) * 100
    : 0;
  const slopePrev = emaLb != null && emaLb2 != null && emaLb2 !== 0
    ? ((emaLb - emaLb2) / emaLb2) * 100
    : 0;
  const slopeAccel = slopeNow - slopePrev;

  const adxNow = adxSeries[lastIndex];
  const adxPrev = adxSeries[Math.max(0, lastIndex - lb)];
  const adxRising = adxNow != null && adxPrev != null && adxNow > adxPrev;
  const adxStrong = adxNow != null && adxNow >= minAdx;

  const histNow = histogram[lastIndex];
  const histPrev = histogram[lastIndex - lb];
  const histExpandingBull = histNow != null && histPrev != null && histNow > 0 && histNow > histPrev;
  const histExpandingBear = histNow != null && histPrev != null && histNow < 0 && histNow < histPrev;

  const recentAvg = averageCandleRange(candles.slice(-lb));
  const priorAvg = averageCandleRange(candles.slice(-lb2, -lb));
  const rangeExpanding = priorAvg > 0 && recentAvg / priorAvg >= expansionRatio;

  const atrNow = atrSeries[lastIndex] ?? averageCandleRange(candles.slice(-14));
  const lastRange = last.high - last.low;
  const displacementBar = atrNow > 0 && lastRange >= atrNow * 1.2;
  const closeVelocity = lb > 0 ? (closes[lastIndex] - closes[lastIndex - lb]) / lb : 0;

  const pdi = plusDi[lastIndex];
  const mdi = minusDi[lastIndex];
  const bullishTrend = emaNow != null && last.close > emaNow && slopeNow > 0;
  const bearishTrend = emaNow != null && last.close < emaNow && slopeNow < 0;
  const bullishAccel = bullishTrend && slopeAccel > 0;
  const bearishAccel = bearishTrend && slopeAccel < 0;
  const decelerating = (bullishTrend && slopeAccel <= 0) || (bearishTrend && slopeAccel >= 0);

  const bullishSignals = [
    bullishAccel,
    adxRising && adxStrong,
    pdi != null && mdi != null && pdi > mdi,
    histExpandingBull,
    rangeExpanding || displacementBar,
    closeVelocity > 0,
  ];
  const bearishSignals = [
    bearishAccel,
    adxRising && adxStrong,
    pdi != null && mdi != null && pdi < mdi,
    histExpandingBear,
    rangeExpanding || displacementBar,
    closeVelocity < 0,
  ];
  const bullishScore = bullishSignals.filter(Boolean).length;
  const bearishScore = bearishSignals.filter(Boolean).length;

  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let phase = 'neutral';

  if (bullishScore >= 4 && !decelerating) {
    bias = 'bullish';
    decision = 'buy';
    phase = 'bullish acceleration';
  } else if (bearishScore >= 4 && !decelerating) {
    bias = 'bearish';
    decision = 'sell';
    phase = 'bearish acceleration';
  } else if (bullishScore >= 3 && bullishAccel) {
    bias = 'bullish';
    decision = rangeExpanding || displacementBar ? 'buy' : 'wait';
    phase = decision === 'buy' ? 'bullish acceleration forming' : 'bullish acceleration pending burst';
  } else if (bearishScore >= 3 && bearishAccel) {
    bias = 'bearish';
    decision = rangeExpanding || displacementBar ? 'sell' : 'wait';
    phase = decision === 'sell' ? 'bearish acceleration forming' : 'bearish acceleration pending burst';
  } else if (bullishTrend) {
    bias = 'bullish';
    phase = decelerating ? 'bullish trend decelerating' : 'bullish trend without acceleration';
  } else if (bearishTrend) {
    bias = 'bearish';
    phase = decelerating ? 'bearish trend decelerating' : 'bearish trend without acceleration';
  } else {
    phase = 'no directional acceleration';
  }

  if (decelerating && decision !== 'wait') {
    decision = 'wait';
    phase = `${bias} trend deceleration — stand aside`;
  }

  const accelScore = Math.max(bullishScore, bearishScore);

  return buildEvaluationResult({
    strategyId: 'trend-acceleration-strategy',
    context,
    config: { ...config, trendPeriod, slopeLookback, adxPeriod, minAdx, expansionRatio },
    candles,
    decision,
    bias,
    confidence: 26
      + accelScore * 9
      + (decision !== 'wait' ? 16 : 0)
      + (adxStrong ? Math.min(14, (adxNow ?? 0) / 3) : 0)
      + (displacementBar ? 8 : 0)
      - (decelerating ? 10 : 0),
    reasons: [
      `Trend acceleration engine: EMA(${trendPeriod}) slope delta + ADX(${adxPeriod}) rise + MACD histogram expansion`,
      `EMA slope ${slopeNow.toFixed(3)}% · acceleration ${slopeAccel.toFixed(3)}% · phase: ${phase}`,
      adxNow != null
        ? `ADX ${adxNow.toFixed(1)} ${adxRising ? 'rising' : 'flat/falling'} · +DI ${pdi?.toFixed(1) ?? '—'} vs -DI ${mdi?.toFixed(1) ?? '—'}`
        : 'ADX unavailable',
      histNow != null
        ? `MACD histogram ${histNow.toFixed(6)} ${histExpandingBull || histExpandingBear ? 'expanding' : 'contracting'}`
        : 'MACD histogram unavailable',
      rangeExpanding || displacementBar
        ? `Volatility burst confirmed — recent range ${(recentAvg / Math.max(priorAvg, 0.00001)).toFixed(2)}x prior${displacementBar ? ' with displacement bar' : ''}`
        : 'Awaiting volatility expansion to confirm institutional acceleration',
      decision === 'buy'
        ? 'Bullish trend acceleration — institutional momentum speed-up'
        : decision === 'sell'
          ? 'Bearish trend acceleration — institutional momentum speed-up'
          : decelerating
            ? 'Trend deceleration detected — no acceleration entry'
            : 'Acceleration criteria incomplete on latest bar',
    ],
    metrics: {
      phase,
      emaSlopePct: Number(slopeNow.toFixed(4)),
      slopeAccelerationPct: Number(slopeAccel.toFixed(4)),
      adx: adxNow != null ? Number(adxNow.toFixed(2)) : null,
      adxRising: adxRising ? 'yes' : 'no',
      plusDi: pdi != null ? Number(pdi.toFixed(2)) : null,
      minusDi: mdi != null ? Number(mdi.toFixed(2)) : null,
      histogram: histNow != null ? Number(histNow.toFixed(6)) : null,
      rangeExpansion: priorAvg > 0 ? Number((recentAvg / priorAvg).toFixed(2)) : null,
      closeVelocity: Number(closeVelocity.toFixed(5)),
      accelerationScore: accelScore,
      displacementBar: displacementBar ? 'yes' : 'no',
    },
    events: decision !== 'wait'
      ? [{
        label: decision === 'buy' ? 'trend acceleration long' : 'trend acceleration short',
        detail: `${phase} · score ${accelScore}/6 · ADX ${adxNow?.toFixed(1) ?? '—'}`,
        tone: decision === 'buy' ? 'emerald' as const : 'rose' as const,
        barIndex: last.candleIndex,
      }]
      : (bullishAccel || bearishAccel) && accelScore >= 2
        ? [{
          label: 'acceleration forming',
          detail: phase,
          tone: 'violet' as const,
          barIndex: last.candleIndex,
        }]
        : [],
  });
};

function institutionalTextBias(text: string): StrategyBias {
  const lower = text.toLowerCase();
  if (lower.includes('bullish') || lower.includes('buy')) return 'bullish';
  if (lower.includes('bearish') || lower.includes('sell')) return 'bearish';
  return 'neutral';
}

export const evaluateInstitutionalTrendFollowingEngine: StrategyEngine = (candles, config, context) => {
  const fastTrendPeriod = Math.max(20, parseNumber(config.fastTrendPeriod, 50));
  const slowTrendPeriod = Math.max(fastTrendPeriod + 1, parseNumber(config.slowTrendPeriod, 100));
  const adxPeriod = Math.max(7, parseNumber(config.adxPeriod, 14));
  const minAdx = parseNumber(config.minAdx, 22);
  const minConsensus = Math.max(3, Math.min(5, parseNumber(config.minConsensus, 4)));
  const maxTrapRisk = parseNumber(config.maxTrapRisk, 0.65);

  const reconstructed = strategyCandlesToReconstructed(candles);
  const structure = analyzeMarketStructure(reconstructed, String(config.timeframe ?? context.timeframe));
  const swings = analyzeSwingPoints(reconstructed, { depths: [1, 2, 4], zigzagPercent: 0.08 });
  const closes = candles.map((item) => item.close);
  const effectiveSlowPeriod = Math.min(slowTrendPeriod, Math.max(fastTrendPeriod + 1, candles.length - 10));
  const fastEma = ema(closes, fastTrendPeriod);
  const slowEma = ema(closes, effectiveSlowPeriod);
  const { adx: adxSeries, plusDi, minusDi } = adx(candles, adxPeriod);
  const { trend: supertrendTrend } = supertrend(candles, 10, 2);

  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const fastNow = fastEma[lastIndex];
  const slowNow = slowEma[lastIndex];
  const adxNow = adxSeries[lastIndex];
  const pdi = plusDi[lastIndex];
  const mdi = minusDi[lastIndex];
  const stTrend = supertrendTrend[lastIndex];

  const structureBias = institutionalTextBias(structure.finalBias.institutionalBias);
  const structureBull = structureBias === 'bullish' || structure.finalBias.tradeDecision === 'BUY';
  const structureBear = structureBias === 'bearish' || structure.finalBias.tradeDecision === 'SELL';
  const trapRisk = structure.finalBias.retailTrapRisk;

  const swingBull = swings.summary.trendState === 'bullish' || swings.summary.structuralBias === 'BUY_CONTEXT';
  const swingBear = swings.summary.trendState === 'bearish' || swings.summary.structuralBias === 'SELL_CONTEXT';

  const emaStackBull = fastNow != null && slowNow != null && last.close > fastNow && fastNow > slowNow;
  const emaStackBear = fastNow != null && slowNow != null && last.close < fastNow && fastNow < slowNow;

  const adxRegimeBull = adxNow != null && adxNow >= minAdx && pdi != null && mdi != null && pdi > mdi;
  const adxRegimeBear = adxNow != null && adxNow >= minAdx && pdi != null && mdi != null && pdi < mdi;

  const supertrendBull = stTrend === 'bullish';
  const supertrendBear = stTrend === 'bearish';

  const pillars = [
    { id: 'structure', bull: structureBull, bear: structureBear, label: 'Market structure' },
    { id: 'swings', bull: swingBull, bear: swingBear, label: 'Swing sequence' },
    { id: 'emaStack', bull: emaStackBull, bear: emaStackBear, label: `EMA(${fastTrendPeriod}/${effectiveSlowPeriod}) stack` },
    { id: 'adx', bull: adxRegimeBull, bear: adxRegimeBear, label: `ADX(${adxPeriod}) regime` },
    { id: 'supertrend', bull: supertrendBull, bear: supertrendBear, label: 'SuperTrend alignment' },
  ];

  const bullishScore = pillars.filter((pillar) => pillar.bull).length;
  const bearishScore = pillars.filter((pillar) => pillar.bear).length;
  const alignedPillars = pillars.filter((pillar) => pillar.bull || pillar.bear);
  const conflicted = bullishScore > 0 && bearishScore > 0 && Math.abs(bullishScore - bearishScore) <= 1;

  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let regime = 'transitional';

  if (trapRisk > maxTrapRisk) {
    regime = 'liquidity trap risk elevated';
  } else if (bullishScore >= minConsensus && bullishScore > bearishScore) {
    bias = 'bullish';
    decision = 'buy';
    regime = 'institutional bullish consensus';
  } else if (bearishScore >= minConsensus && bearishScore > bullishScore) {
    bias = 'bearish';
    decision = 'sell';
    regime = 'institutional bearish consensus';
  } else if (bullishScore >= minConsensus - 1 && bullishScore > bearishScore + 1) {
    bias = 'bullish';
    regime = 'bullish consensus forming';
  } else if (bearishScore >= minConsensus - 1 && bearishScore > bullishScore + 1) {
    bias = 'bearish';
    regime = 'bearish consensus forming';
  } else if (conflicted) {
    regime = 'mixed institutional signals';
  } else {
    regime = 'insufficient consensus';
  }

  if (trapRisk > maxTrapRisk) {
    decision = 'wait';
  }

  const consensusScore = Math.max(bullishScore, bearishScore);
  const structureConfidence = Math.round((structure.finalBias.confidenceScore ?? 0) * 100);

  return buildEvaluationResult({
    strategyId: 'institutional-trend-following',
    context,
    config: {
      ...config,
      fastTrendPeriod,
      slowTrendPeriod: effectiveSlowPeriod,
      adxPeriod,
      minAdx,
      minConsensus,
      maxTrapRisk,
    },
    candles,
    decision,
    bias,
    confidence: 24
      + consensusScore * 11
      + (decision !== 'wait' ? 18 : 0)
      + Math.min(16, structureConfidence / 6)
      + (trapRisk <= maxTrapRisk ? 8 : -12),
    reasons: [
      `Institutional trend fusion — ${consensusScore}/5 pillars aligned · regime: ${regime}`,
      structure.finalBias.reasoningText,
      `Swing structure ${swings.summary.trendState} · ${swings.summary.explanation}`,
      emaStackBull
        ? `Dual EMA stack bullish — price above EMA(${fastTrendPeriod}) above EMA(${effectiveSlowPeriod})`
        : emaStackBear
          ? `Dual EMA stack bearish — price below EMA(${fastTrendPeriod}) below EMA(${effectiveSlowPeriod})`
          : 'EMA stack mixed — no clean institutional value ladder',
      adxNow != null
        ? `ADX ${adxNow.toFixed(1)} · +DI ${pdi?.toFixed(1) ?? '—'} / -DI ${mdi?.toFixed(1) ?? '—'} · SuperTrend ${stTrend ?? '—'}`
        : 'ADX regime unavailable',
      trapRisk > maxTrapRisk
        ? `Retail trap risk ${(trapRisk * 100).toFixed(0)}% exceeds threshold — no entry`
        : decision === 'buy'
          ? 'Full institutional bullish consensus — trend-following long bias'
          : decision === 'sell'
            ? 'Full institutional bearish consensus — trend-following short bias'
            : 'Awaiting stronger multi-pillar institutional agreement',
    ],
    metrics: {
      regime,
      consensusScore,
      bullishPillars: bullishScore,
      bearishPillars: bearishScore,
      structureBias: structure.finalBias.institutionalBias,
      swingTrend: swings.summary.trendState,
      trapRiskPct: Number((trapRisk * 100).toFixed(1)),
      fastEma: fastNow != null ? Number(fastNow.toFixed(5)) : null,
      slowEma: slowNow != null ? Number(slowNow.toFixed(5)) : null,
      adx: adxNow != null ? Number(adxNow.toFixed(2)) : null,
      supertrend: stTrend ?? null,
      structureConfidence,
      pillars: pillars.map((pillar) => `${pillar.id}:${pillar.bull ? 'bull' : pillar.bear ? 'bear' : 'neutral'}`).join(','),
    },
    events: decision !== 'wait'
      ? [{
        label: decision === 'buy' ? 'institutional trend long' : 'institutional trend short',
        detail: `${consensusScore}/5 pillars · ${regime}`,
        tone: decision === 'buy' ? 'emerald' as const : 'rose' as const,
        barIndex: last.candleIndex,
      }]
      : alignedPillars.length >= 3
        ? [{
          label: 'consensus forming',
          detail: pillars.filter((pillar) => pillar.bull || pillar.bear).map((pillar) => pillar.label).join(' · '),
          tone: 'violet' as const,
          barIndex: last.candleIndex,
        }]
        : [],
  });
};

function mapMtfFinalDecision(finalDecision: string): StrategySignalSide {
  const text = finalDecision.toUpperCase();
  if (text.includes('BUY')) return 'buy';
  if (text.includes('SELL')) return 'sell';
  return 'wait';
}

function mapMtfBias(finalBias: string): StrategyBias {
  const text = finalBias.toLowerCase();
  if (text.includes('bullish')) return 'bullish';
  if (text.includes('bearish')) return 'bearish';
  return 'neutral';
}

export function buildMultiTimeframeTrendEvaluation(input: {
  symbol: string;
  candleMap: Partial<Record<MtfTimeframe, StrategyPriceCandle[]>>;
  captureMap: Partial<Record<MtfTimeframe, string | null>>;
  config: Record<string, unknown>;
  context: StrategyEngineContext;
}): StrategyEvaluationResult {
  const reconstructed: Partial<Record<MtfTimeframe, ReturnType<typeof strategyCandlesToReconstructed>>> = {};
  for (const timeframe of MTF_TIMEFRAMES) {
    const candles = input.candleMap[timeframe];
    if (candles?.length) {
      reconstructed[timeframe] = strategyCandlesToReconstructed(candles);
    }
  }

  const analysis = analyzeMultiTimeframe(input.symbol, reconstructed, input.captureMap);
  const { decision, snapshots, alignments, conflicts } = analysis;
  const signal = mapMtfFinalDecision(decision.finalDecision);
  const bias = mapMtfBias(decision.finalBias);
  const averageAlignment = alignments.length
    ? alignments.reduce((sum, item) => sum + item.alignmentScore, 0) / alignments.length
    : 0;
  const loadedTimeframes = MTF_TIMEFRAMES.filter((timeframe) => (input.candleMap[timeframe]?.length ?? 0) >= 12);
  const allCandles = loadedTimeframes.flatMap((timeframe) => input.candleMap[timeframe] ?? []);

  const events = alignments
    .filter((item) => item.alignmentState === 'aligned_bullish' || item.alignmentState === 'aligned_bearish')
    .slice(0, 6)
    .map((item) => ({
      label: `${item.leftTimeframe}/${item.rightTimeframe}`,
      detail: item.explanationText,
      tone: item.alignmentState === 'aligned_bullish' ? 'emerald' as const : 'rose' as const,
    }));

  const tfBiasMetrics = Object.fromEntries(
    snapshots.map((snapshot) => [`bias${snapshot.timeframe}`, snapshot.bias]),
  );

  return buildEvaluationResult({
    strategyId: 'multi-timeframe-trend-confirmation',
    context: input.context,
    config: {
      ...input.config,
      timeframes: loadedTimeframes.join(','),
      controllingTimeframe: decision.controllingTimeframe,
      scalpOnly: decision.scalpOnly,
    },
    candles: allCandles,
    decision: signal,
    bias,
    confidence: Math.round(decision.confidenceScore * 100),
    reasons: [
      `Multi-timeframe institutional stack — ${loadedTimeframes.length}/5 timeframes loaded`,
      decision.marketNarrative,
      decision.lowerTimeframeConfirmation,
      conflicts[0]
        ? `Conflict watch: ${conflicts[0].description}`
        : `Adjacent timeframe alignment average ${Math.round(averageAlignment * 100)}%`,
    ],
    metrics: {
      finalDecision: decision.finalDecision,
      controllingTimeframe: decision.controllingTimeframe,
      alignmentAvgPct: Number((averageAlignment * 100).toFixed(1)),
      conflictSeverity: conflicts[0] != null ? Number((conflicts[0].severityScore * 100).toFixed(1)) : 0,
      loadedTimeframes: loadedTimeframes.length,
      scalpOnly: decision.scalpOnly ? 'yes' : 'no',
      ...tfBiasMetrics,
    },
    events,
  });
}

export const STRATEGY_ENGINES: Record<string, StrategyEngine> = {
  'moving-average-crossover': evaluateMovingAverageCrossoverEngine,
  'ema-pullback-strategy': evaluateEmaPullbackEngine,
  'trendline-breakout': evaluateTrendlineBreakoutEngine,
  'higher-highs-and-higher-lows': evaluateHigherHighsHigherLowsEngine,
  'trend-continuation-pattern-strategy': evaluateTrendContinuationPatternEngine,
  'dynamic-support-and-resistance-trend-trading': evaluateDynamicSupportResistanceTrendEngine,
  'fibonacci-trend-continuation': evaluateFibonacciTrendContinuationEngine,
  'channel-trend-trading': evaluateChannelTrendTradingEngine,
  'trend-acceleration-strategy': evaluateTrendAccelerationEngine,
  'institutional-trend-following': evaluateInstitutionalTrendFollowingEngine,
  'macd-trend-strategy': evaluateMacdTrendEngine,
  'ichimoku-trend-strategy': evaluateIchimokuTrendEngine,
  'supertrend-strategy': evaluateSupertrendEngine,
  'rsi-strategy': evaluateRsiEngine,
  'london-breakout': evaluateLondonBreakoutEngine,
  'new-york-breakout': evaluateNewYorkBreakoutEngine,
  'bollinger-band-squeeze-breakout': evaluateBollingerSqueezeEngine,
  'order-block-trading': evaluateOrderBlockEngine,
  'adx-trend-strategy': evaluateAdxTrendEngine,
  '200-ema-trend-strategy': evaluate200EmaTrendEngine,
  'asian-session-breakout': evaluateAsianSessionBreakoutEngine,
  'opening-range-breakout-orb': evaluateOpeningRangeBreakoutEngine,
  'daily-high-low-breakout': evaluateDailyHighLowBreakoutEngine,
  'weekly-breakout': evaluateWeeklyBreakoutEngine,
  'triangle-breakout': evaluateTriangleBreakoutEngine,
  'rectangle-breakout': evaluateRectangleBreakoutEngine,
  'volatility-breakout': evaluateVolatilityBreakoutEngine,
  'news-breakout': evaluateNewsBreakoutEngine,
  'range-expansion-breakout': evaluateRangeExpansionBreakoutEngine,
  'liquidity-breakout': evaluateLiquidityBreakoutEngine,
  'fake-breakout-reversal': evaluateFakeBreakoutReversalEngine,
  'consolidation-breakout': evaluateConsolidationBreakoutEngine,
  '1-minute-scalping': evaluate1MinuteScalpingEngine,
  '5-minute-scalping': evaluate5MinuteScalpingEngine,
  'tick-scalping': evaluateTickScalpingEngine,
  'spread-scalping': evaluateSpreadScalpingEngine,
  'order-flow-scalping': evaluateOrderFlowScalpingEngine,
  'dom-scalping': evaluateDomScalpingEngine,
  'momentum-scalping': evaluateMomentumScalpingEngine,
  'ema-scalping': evaluateEmaScalpingEngine,
  'vwap-scalping': evaluateVwapScalpingEngine,
  'rsi-scalping': evaluateRsiScalpingEngine,
  'stochastic-scalping': evaluateStochasticScalpingEngine,
  'price-action-scalping': evaluatePriceActionScalpingEngine,
  'liquidity-grab-scalping': evaluateLiquidityGrabScalpingEngine,
  'news-scalping': evaluateNewsScalpingEngine,
  'session-scalping': evaluateSessionScalpingEngine,
  'high-frequency-scalping': evaluateHighFrequencyScalpingEngine,
  'algorithmic-scalping': evaluateAlgorithmicScalpingEngine,
  'intraday-trend-trading': evaluateIntradayTrendTradingEngine,
  'intraday-breakout': evaluateIntradayBreakoutEngine,
  'momentum-day-trading': evaluateMomentumDayTradingEngine,
  'vwap-day-trading': evaluateVwapDayTradingEngine,
  'opening-session-trading': evaluateOpeningSessionTradingEngine,
  'mean-reversion-day-trading': evaluateMeanReversionDayTradingEngine,
  'gap-trading': evaluateGapTradingEngine,
  'reversal-day-trading': evaluateReversalDayTradingEngine,
  'news-based-day-trading': evaluateNewsBasedDayTradingEngine,
  'correlation-day-trading': evaluateCorrelationDayTradingEngine,
  'pivot-point-day-trading': evaluatePivotPointDayTradingEngine,
  'range-day-trading': evaluateRangeDayTradingEngine,
  'smart-money-day-trading': evaluateSmartMoneyDayTradingEngine,
  'swing-pullback-strategy': evaluateSwingPullbackStrategyEngine,
  'fibonacci-swing-trading': evaluateFibonacciSwingTradingEngine,
  'swing-reversal-strategy': evaluateSwingReversalStrategyEngine,
  'trend-swing-trading': evaluateTrendSwingTradingEngine,
  'channel-swing-trading': evaluateChannelSwingTradingEngine,
  'harmonic-swing-trading': evaluateHarmonicSwingTradingEngine,
  'elliott-wave-swing-trading': evaluateElliottWaveSwingTradingEngine,
  'macd-swing-trading': evaluateMacdSwingTradingEngine,
  'rsi-swing-trading': evaluateRsiSwingTradingEngine,
  'support-and-resistance-swing-trading': evaluateSupportAndResistanceSwingTradingEngine,
  'candlestick-swing-trading': evaluateCandlestickSwingTradingEngine,
  'weekly-swing-trading': evaluateWeeklySwingTradingEngine,
  'position-swing-trading': evaluatePositionSwingTradingEngine,
  'macro-trend-trading': evaluateMacroTrendTradingEngine,
  'fundamental-position-trading': evaluateFundamentalPositionTradingEngine,
  'carry-trade-strategy': evaluateCarryTradeStrategyEngine,
  'long-term-trend-following': evaluateLongTermTrendFollowingEngine,
  'economic-cycle-trading': evaluateEconomicCycleTradingEngine,
  'central-bank-policy-trading': evaluateCentralBankPolicyTradingEngine,
  'interest-rate-differential-strategy': evaluateInterestRateDifferentialStrategyEngine,
  'inflation-based-position-trading': evaluateInflationBasedPositionTradingEngine,
  'commodity-currency-position-trading': evaluateCommodityCurrencyPositionTradingEngine,
  'fair-value-gap-fvg': evaluateFairValueGapEngine,
  'pin-bar-strategy': evaluatePinBarEngine,
  'break-and-retest': evaluateBreakAndRetestEngine,
  'support-and-resistance': evaluateSupportAndResistanceEngine,
  'supply-and-demand': evaluateSupplyAndDemandEngine,
  'candlestick-trading': evaluateCandlestickTradingEngine,
  'engulfing-pattern': evaluateEngulfingPatternEngine,
  'inside-bar-strategy': evaluateInsideBarStrategyEngine,
  'fakey-pattern': evaluateFakeyPatternEngine,
  'market-structure-trading': evaluateMarketStructureTradingEngine,
  'liquidity-sweep-strategy': evaluateLiquiditySweepStrategyEngine,
  'mitigation-block-strategy': evaluateMitigationBlockStrategyEngine,
  'breaker-block-strategy': evaluateBreakerBlockStrategyEngine,
  'institutional-candle-trading': evaluateInstitutionalCandleTradingEngine,
  'ict-trading-strategy': evaluateIctTradingStrategyEngine,
  'bos-break-of-structure': evaluateBosBreakOfStructureEngine,
  'choch-change-of-character': evaluateChochChangeOfCharacterEngine,
  'bollinger-mean-reversion': evaluateBollingerMeanReversionEngine,
  'rsi-overbought-oversold': evaluateRsiOverboughtOversoldEngine,
  'vwap-reversion': evaluateVwapReversionEngine,
  'statistical-reversion': evaluateStatisticalReversionEngine,
  'range-reversal': evaluateRangeReversalEngine,
  'channel-reversion': evaluateChannelReversionEngine,
  'z-score-reversion': evaluateZScoreReversionEngine,
  'deviation-reversion': evaluateDeviationReversionEngine,
  'reversion-scalping': evaluateReversionScalpingEngine,
  'momentum-breakout': evaluateMomentumBreakoutEngine,
  'volume-momentum': evaluateVolumeMomentumEngine,
  'news-momentum': evaluateNewsMomentumEngine,
  'macd-momentum': evaluateMacdMomentumEngine,
  'rsi-momentum': evaluateRsiMomentumEngine,
  'volatility-momentum': evaluateVolatilityMomentumEngine,
  'currency-strength-momentum': evaluateCurrencyStrengthMomentumEngine,
  'relative-strength-momentum': evaluateRelativeStrengthMomentumEngine,
  'double-top-bottom': evaluateDoubleTopBottomEngine,
  'head-and-shoulders': evaluateHeadAndShouldersEngine,
  'rsi-divergence': evaluateRsiDivergenceEngine,
  'macd-divergence': evaluateMacdDivergenceEngine,
  'exhaustion-reversal': evaluateExhaustionReversalEngine,
  'climactic-reversal': evaluateClimacticReversalEngine,
  'trendline-reversal': evaluateTrendlineReversalEngine,
  'fibonacci-reversal': evaluateFibonacciReversalEngine,
  'harmonic-reversal': evaluateHarmonicReversalEngine,
  'supply-demand-reversal': evaluateSupplyDemandReversalEngine,
  'v-reversal': evaluateVReversalEngine,
  'countertrend-trading': evaluateCountertrendTradingEngine,
  'horizontal-range-trading': evaluateHorizontalRangeTradingEngine,
  'bollinger-range-strategy': evaluateBollingerRangeStrategyEngine,
  'oscillator-range-trading': evaluateOscillatorRangeTradingEngine,
  'channel-trading': evaluateChannelTradingEngine,
  'support-and-resistance-range': evaluateSupportAndResistanceRangeEngine,
  'asian-session-range-trading': evaluateAsianSessionRangeTradingEngine,
  'mean-reversion-range': evaluateMeanReversionRangeEngine,
  'vwap-range-trading': evaluateVwapRangeTradingEngine,
  'smart-money-concepts-smc': evaluateSmartMoneyConceptsSmcEngine,
  'ict-methodology': evaluateIctMethodologyEngine,
  'order-flow-trading': evaluateOrderFlowTradingEngine,
  'footprint-trading': evaluateFootprintTradingEngine,
  'liquidity-trading': evaluateLiquidityTradingEngine,
  'market-maker-model': evaluateMarketMakerModelEngine,
  'wyckoff-method': evaluateWyckoffMethodEngine,
  'accumulation-distribution': evaluateAccumulationDistributionEngine,
  'manipulation-distribution': evaluateManipulationDistributionEngine,
  'stop-hunt-strategy': evaluateStopHuntStrategyEngine,
  'institutional-candle-model': evaluateInstitutionalCandleModelEngine,
  'premium-and-discount-zones': evaluatePremiumAndDiscountZonesEngine,
  'smt-divergence': evaluateSmtDivergenceEngine,
  'kill-zones': evaluateKillZonesEngine,
  'judas-swing': evaluateJudasSwingEngine,
  'power-of-3-po3': evaluatePowerOf3Po3Engine,
  'algorithmic-trading': evaluateAlgorithmicTradingEngine,
  'quantitative-trading': evaluateQuantitativeTradingEngine,
  'high-frequency-trading-hft': evaluateHighFrequencyTradingHftEngine,
  'statistical-arbitrage': evaluateStatisticalArbitrageEngine,
  'machine-learning-trading': evaluateMachineLearningTradingEngine,
  'ai-based-trading': evaluateAiBasedTradingEngine,
  'neural-network-trading': evaluateNeuralNetworkTradingEngine,
  'sentiment-ai-trading': evaluateSentimentAiTradingEngine,
  'reinforcement-learning-trading': evaluateReinforcementLearningTradingEngine,
  'grid-algorithms': evaluateGridAlgorithmsEngine,
  'martingale-systems': evaluateMartingaleSystemsEngine,
  'anti-martingale-systems': evaluateAntiMartingaleSystemsEngine,
  'volatility-algorithms': evaluateVolatilityAlgorithmsEngine,
  'interest-rate-trading': evaluateInterestRateTradingEngine,
  'central-bank-trading': evaluateCentralBankTradingEngine,
  'cpi-trading': evaluateCpiTradingEngine,
  'nfp-trading': evaluateNfpTradingEngine,
  'gdp-trading': evaluateGdpTradingEngine,
  'inflation-trading': evaluateInflationTradingEngine,
  'employment-data-trading': evaluateEmploymentDataTradingEngine,
  'geopolitical-trading': evaluateGeopoliticalTradingEngine,
  'trade-balance-trading': evaluateTradeBalanceTradingEngine,
  'yield-differential-trading': evaluateYieldDifferentialTradingEngine,
  'monetary-policy-strategy': evaluateMonetaryPolicyStrategyEngine,
  'risk-on-risk-off-trading': evaluateRiskOnRiskOffTradingEngine,
  'nfp-strategy': evaluateNfpStrategyEngine,
  'fomc-strategy': evaluateFomcStrategyEngine,
  'cpi-strategy': evaluateCpiStrategyEngine,
  'ecb-strategy': evaluateEcbStrategyEngine,
  'boe-strategy': evaluateBoeStrategyEngine,
  'boj-strategy': evaluateBojStrategyEngine,
  'rate-decision-trading': evaluateRateDecisionTradingEngine,
  'flash-news-trading': evaluateFlashNewsTradingEngine,
  'volatility-spike-trading': evaluateVolatilitySpikeTradingEngine,
  'news-fade-strategy': evaluateNewsFadeStrategyEngine,
  'currency-correlation-trading': evaluateCurrencyCorrelationTradingEngine,
  'gold-forex-correlation': evaluateGoldForexCorrelationEngine,
  'oil-cad-correlation': evaluateOilCadCorrelationEngine,
  'bond-yield-correlation': evaluateBondYieldCorrelationEngine,
  'dollar-index-dxy-strategy': evaluateDollarIndexDxyStrategyEngine,
  'risk-sentiment-correlation': evaluateRiskSentimentCorrelationEngine,
  'equity-forex-correlation': evaluateEquityForexCorrelationEngine,
  'atr-breakout': evaluateAtrBreakoutEngine,
  'volatility-compression': evaluateVolatilityCompressionEngine,
  'volatility-expansion': evaluateVolatilityExpansionEngine,
  'bollinger-squeeze': evaluateVolatilityBollingerSqueezeEngine,
  'implied-volatility-trading': evaluateImpliedVolatilityTradingEngine,
  'news-volatility-strategy': evaluateNewsVolatilityStrategyEngine,
  'direct-hedge': evaluateDirectHedgeEngine,
  'multiple-currency-hedge': evaluateMultipleCurrencyHedgeEngine,
  'correlation-hedge': evaluateCorrelationHedgeEngine,
  'options-hedge': evaluateOptionsHedgeEngine,
  'synthetic-hedge': evaluateSyntheticHedgeEngine,
  'partial-hedge': evaluatePartialHedgeEngine,
  'triangular-arbitrage': evaluateTriangularArbitrageEngine,
  'latency-arbitrage': evaluateLatencyArbitrageEngine,
  'cross-broker-arbitrage': evaluateCrossBrokerArbitrageEngine,
  'interest-arbitrage': evaluateInterestArbitrageEngine,
  'swap-arbitrage': evaluateSwapArbitrageEngine,
  'asian-session-strategy': evaluateAsianSessionStrategyEngine,
  'london-session-strategy': evaluateLondonSessionStrategyEngine,
  'new-york-session-strategy': evaluateNewYorkSessionStrategyEngine,
  'london-new-york-overlap': evaluateLondonNewYorkOverlapEngine,
  'tokyo-breakout': evaluateTokyoBreakoutEngine,
  'session-momentum': evaluateSessionMomentumEngine,
  'session-reversal': evaluateSessionReversalEngine,
  'triangle-patterns': evaluateTrianglePatternsEngine,
  'wedge-patterns': evaluateWedgePatternsEngine,
  'flag-patterns': evaluateFlagPatternsEngine,
  'pennant-patterns': evaluatePennantPatternsEngine,
  'cup-and-handle': evaluateCupAndHandleEngine,
  'harmonic-patterns': evaluateHarmonicPatternsEngine,
  'butterfly-pattern': evaluateButterflyPatternEngine,
  'bat-pattern': evaluateBatPatternEngine,
  'crab-pattern': evaluateCrabPatternEngine,
  'gartley-pattern': evaluateGartleyPatternEngine,
  'cypher-pattern': evaluateCypherPatternEngine,
  'doji': evaluateDojiEngine,
  'morning-star': evaluateMorningStarEngine,
  'evening-star': evaluateEveningStarEngine,
  'hammer': evaluateHammerEngine,
  'shooting-star': evaluateShootingStarEngine,
  'harami': evaluateHaramiEngine,
  'tweezer-top-bottom': evaluateTweezerTopBottomEngine,
  'three-soldiers': evaluateThreeSoldiersEngine,
  'three-crows': evaluateThreeCrowsEngine,
  'fixed-lot-strategy': evaluateFixedLotStrategyEngine,
  'percentage-risk-model': evaluatePercentageRiskModelEngine,
  'kelly-criterion': evaluateKellyCriterionEngine,
  'volatility-position-sizing': evaluateVolatilityPositionSizingEngine,
  'dynamic-risk-allocation': evaluateDynamicRiskAllocationEngine,
  'equity-curve-management': evaluateEquityCurveManagementEngine,
  'portfolio-risk-balancing': evaluatePortfolioRiskBalancingEngine,
  'drawdown-protection': evaluateDrawdownProtectionEngine,
  'daily-loss-limit-strategy': evaluateDailyLossLimitStrategyEngine,
  'wyckoff-trading': evaluateWyckoffTradingEngine,
  'market-profile-trading': evaluateMarketProfileTradingEngine,
  'volume-profile-trading': evaluateVolumeProfileTradingEngine,
  'auction-market-theory': evaluateAuctionMarketTheoryEngine,
  'order-book-trading': evaluateOrderBookTradingEngine,
  'footprint-charts': evaluateFootprintChartsEngine,
  'liquidity-engineering': evaluateLiquidityEngineeringEngine,
  'quant-macro-trading': evaluateQuantMacroTradingEngine,
  'statistical-modeling': evaluateStatisticalModelingEngine,
  'ai-predictive-trading': evaluateAiPredictiveTradingEngine,
  'neural-forecasting': evaluateNeuralForecastingEngine,
  'institutional-flow-analysis': evaluateInstitutionalFlowAnalysisEngine,
  'dark-pool-analysis': evaluateDarkPoolAnalysisEngine,
  'sentiment-engine-trading': evaluateSentimentEngineTradingEngine,
  'cross-asset-flow-trading': evaluateCrossAssetFlowTradingEngine,
  'trend-momentum': evaluateTrendMomentumEngine,
  'smc-price-action': evaluateSmcPriceActionEngine,
  'fundamental-technical': evaluateFundamentalTechnicalEngine,
  'ai-technical-analysis': evaluateAiTechnicalAnalysisEngine,
  'news-liquidity': evaluateNewsLiquidityEngine,
  'scalping-order-flow': evaluateScalpingOrderFlowEngine,
  'swing-macro-analysis': evaluateSwingMacroAnalysisEngine,
  'liquidity-grab-strategy': evaluateLiquidityGrabEngine,
  'macd-strategy': evaluateMacdStrategyEngine,
  'bollinger-bands-strategy': evaluateBollingerBandsStrategyEngine,
  'atr-strategy': evaluateAtrStrategyEngine,
  'adx-strategy': evaluateAdxStrategyEngine,
  'cci-strategy': evaluateCciStrategyEngine,
  'parabolic-sar-strategy': evaluateParabolicSarStrategyEngine,
  'ichimoku-strategy': evaluateIchimokuStrategyEngine,
  'moving-average-strategy': evaluateMovingAverageStrategyEngine,
  'keltner-channel-strategy': evaluateKeltnerChannelStrategyEngine,
  'donchian-channel-strategy': evaluateDonchianChannelStrategyEngine,
  'momentum-indicator-strategy': evaluateMomentumIndicatorStrategyEngine,
  'williams-r-strategy': evaluateWilliamsRStrategyEngine,
  'tdi-strategy': evaluateTdiStrategyEngine,
  'alligator-indicator-strategy': evaluateAlligatorIndicatorStrategyEngine,
  'stochastic-strategy': evaluateStochasticEngine,
};

export function evaluateStrategyEngine(
  strategyId: string,
  candles: StrategyPriceCandle[],
  config: Record<string, unknown>,
) {
  const engine = STRATEGY_ENGINES[strategyId];
  if (!engine) {
    throw new Error(`Strategy engine not implemented: ${strategyId}`);
  }
  const context = contextFromConfig(config);
  return engine(candles, config, context);
}
