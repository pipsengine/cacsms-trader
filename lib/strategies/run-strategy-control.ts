import { attachGroupLeaders } from './book-ranking-utils';
import { STRATEGY_CONTROL_MODULE_MAP, type StrategyControlSlug } from './strategy-control-modules';
import { runAutonomousOverviewEvaluations } from './run-strategy-evaluation';
import type {
  StrategyControlOverviewEntry,
  StrategyControlPayload,
  StrategyControlRankingRow,
  StrategyControlResult,
  StrategyControlSignalSide,
} from './strategy-control-types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function decisionWeight(decision: StrategyControlSignalSide): number {
  if (decision === 'buy' || decision === 'sell') return 1;
  return 0.35;
}

function biasCoherence(decision: StrategyControlSignalSide, bias: string): number {
  if (decision === 'buy' && bias === 'bullish') return 1;
  if (decision === 'sell' && bias === 'bearish') return 1;
  if (decision === 'wait' && bias === 'neutral') return 0.7;
  if (decision === 'wait') return 0.5;
  return 0.25;
}

function compositeScore(entry: StrategyControlOverviewEntry): number {
  if (entry.error) return 0;
  const base = entry.confidence * decisionWeight(entry.decision);
  const coherence = biasCoherence(entry.decision, entry.bias) * 18;
  return Math.round(clamp(base + coherence, 0, 100));
}

function healthyEntries(entries: StrategyControlOverviewEntry[]): StrategyControlOverviewEntry[] {
  return entries.filter((item) => !item.error);
}

function topRankings(entries: StrategyControlOverviewEntry[], limit = 12): StrategyControlRankingRow[] {
  return [...entries]
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      score: compositeScore(entry),
      decision: entry.decision,
      confidence: entry.confidence,
      bias: entry.bias,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function bookDecision(entries: StrategyControlOverviewEntry[]): StrategyControlSignalSide | 'neutral' {
  const healthy = healthyEntries(entries);
  const buy = healthy.filter((item) => item.decision === 'buy').length;
  const sell = healthy.filter((item) => item.decision === 'sell').length;
  if (buy > sell * 1.15) return 'buy';
  if (sell > buy * 1.15) return 'sell';
  return 'neutral';
}

function rotationSlot(isoTime: string, bucketMinutes: number): number {
  const ms = Date.parse(isoTime);
  return Math.floor(ms / (bucketMinutes * 60_000));
}

function runAiStrategySelector(entries: StrategyControlOverviewEntry[], evaluatedAt: string): StrategyControlResult {
  const rankings = topRankings(entries, 15);
  const top = rankings[0];
  const actionable = rankings.filter((item) => item.decision !== 'wait').length;
  const decision = top?.decision !== 'wait' ? top.decision : bookDecision(entries);
  return {
    moduleId: 'ai-strategy-selector',
    label: STRATEGY_CONTROL_MODULE_MAP['ai-strategy-selector'].label,
    summary: top ? `Top selection: ${top.label} (${top.score}/100)` : 'Awaiting healthy strategy evaluations.',
    decision,
    confidence: top?.score ?? 0,
    reasons: [
      `AI strategy selector — ranked ${healthyEntries(entries).length} healthy engines`,
      top ? `Leader ${top.label} · ${top.decision} · ${top.confidence}% confidence` : 'No leader available',
      `${actionable} actionable candidates in top 15`,
    ],
    metrics: { candidateCount: healthyEntries(entries).length, actionableTop15: actionable, topScore: top?.score ?? 0 },
    rankings,
    evaluatedAt,
  };
}

function runAutonomousStrategyRotation(entries: StrategyControlOverviewEntry[], evaluatedAt: string, symbol: string): StrategyControlResult {
  const slot = rotationSlot(evaluatedAt, 15);
  const groups = [...new Set(healthyEntries(entries).map((item) => item.group))].sort();
  const activeGroup = groups.length > 0 ? groups[slot % groups.length]! : 'none';
  const basket = healthyEntries(entries)
    .filter((item) => item.group === activeGroup)
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      score: compositeScore(entry),
      decision: entry.decision,
      confidence: entry.confidence,
      bias: entry.bias,
      detail: `Rotation slot ${slot}`,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
  const nextGroup = groups.length > 0 ? groups[(slot + 1) % groups.length]! : 'none';
  const leader = basket[0];
  const decision = leader?.decision !== 'wait' ? leader.decision : 'wait';
  return {
    moduleId: 'autonomous-strategy-rotation',
    label: STRATEGY_CONTROL_MODULE_MAP['autonomous-strategy-rotation'].label,
    summary: `Rotation focus: ${activeGroup.replace(/-/g, ' ')} (${basket.length} engines)`,
    decision,
    confidence: leader?.score ?? 0,
    reasons: [
      `Autonomous rotation — 15-minute slot ${slot} for ${symbol}`,
      `Active group ${activeGroup} · next ${nextGroup}`,
      leader ? `Group leader ${leader.label}` : 'No leader in rotation basket',
    ],
    metrics: { rotationSlot: slot, activeGroup, nextGroup, basketSize: basket.length },
    rankings: basket,
    evaluatedAt,
  };
}

function runStrategyScoringEngine(entries: StrategyControlOverviewEntry[], evaluatedAt: string): StrategyControlResult {
  const rankings = topRankings(entries, 20);
  const avgScore = rankings.length > 0 ? Math.round(rankings.reduce((sum, item) => sum + item.score, 0) / rankings.length) : 0;
  const top = rankings[0];
  return {
    moduleId: 'strategy-scoring-engine',
    label: STRATEGY_CONTROL_MODULE_MAP['strategy-scoring-engine'].label,
    summary: `Book average score ${avgScore}/100 · top ${top?.label ?? 'n/a'}`,
    decision: bookDecision(entries),
    confidence: avgScore,
    reasons: [
      'Strategy scoring — composite decision × confidence + bias coherence',
      `Average top-20 score ${avgScore}`,
      top ? `Highest ${top.label} at ${top.score}` : 'No scores available',
    ],
    metrics: { averageScore: avgScore, scoredEngines: healthyEntries(entries).length, topScore: top?.score ?? 0 },
    rankings,
    evaluatedAt,
  };
}

function runStrategyConfidenceEngine(entries: StrategyControlOverviewEntry[], evaluatedAt: string): StrategyControlResult {
  const healthy = healthyEntries(entries);
  const confidences = healthy.map((item) => item.confidence);
  const mean = confidences.length > 0 ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0;
  const sorted = [...confidences].sort((left, right) => left - right);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : 0;
  const high = healthy.filter((item) => item.confidence >= 60).length;
  const rankings = topRankings(entries, 12).map((row) => ({ ...row, detail: `Confidence ${row.confidence}%` }));
  return {
    moduleId: 'strategy-confidence-engine',
    label: STRATEGY_CONTROL_MODULE_MAP['strategy-confidence-engine'].label,
    summary: `Book confidence μ=${mean.toFixed(1)}% · median ${median}% · ${high} high-confidence`,
    decision: mean >= 55 ? bookDecision(entries) : 'wait',
    confidence: Math.round(mean),
    reasons: [
      'Strategy confidence — book-wide confidence aggregation',
      `${healthy.length} healthy engines · ${high} above 60% confidence`,
      `Median confidence ${median}%`,
    ],
    metrics: { meanConfidence: Number(mean.toFixed(2)), medianConfidence: median, highConfidenceCount: high },
    rankings,
    evaluatedAt,
  };
}

function runStrategyOptimizationEngine(entries: StrategyControlOverviewEntry[], evaluatedAt: string): StrategyControlResult {
  const healthy = healthyEntries(entries);
  const waitRatio = healthy.length > 0 ? healthy.filter((item) => item.decision === 'wait').length / healthy.length : 1;
  const rankings = healthy
    .filter((item) => item.confidence < 40 && item.decision !== 'wait')
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      score: compositeScore(entry),
      decision: entry.decision,
      confidence: entry.confidence,
      bias: entry.bias,
      detail: 'Low-confidence actionable — optimize thresholds',
    }))
    .sort((left, right) => left.confidence - right.confidence)
    .slice(0, 15);
  return {
    moduleId: 'strategy-optimization-engine',
    label: STRATEGY_CONTROL_MODULE_MAP['strategy-optimization-engine'].label,
    summary: `${rankings.length} engines flagged for optimization · wait ratio ${(waitRatio * 100).toFixed(0)}%`,
    decision: 'wait',
    confidence: Math.round((1 - waitRatio) * 100),
    reasons: [
      'Strategy optimization — surfaces low-confidence actionable signals',
      `Wait ratio ${(waitRatio * 100).toFixed(1)}% across healthy book`,
      `${rankings.length} candidates for parameter tightening`,
    ],
    metrics: { waitRatioPct: Number((waitRatio * 100).toFixed(2)), optimizationCandidates: rankings.length },
    rankings,
    evaluatedAt,
  };
}

function runStrategyAdaptationEngine(entries: StrategyControlOverviewEntry[], evaluatedAt: string): StrategyControlResult {
  const healthy = healthyEntries(entries);
  const bullish = healthy.filter((item) => item.bias === 'bullish').length;
  const bearish = healthy.filter((item) => item.bias === 'bearish').length;
  const neutral = healthy.length - bullish - bearish;
  const regime = bullish > bearish * 1.1 ? 'bullish' : bearish > bullish * 1.1 ? 'bearish' : 'neutral';
  const groupScores: Record<string, { score: number; count: number }> = {};
  for (const entry of healthy) {
    const bucket = groupScores[entry.group] ?? { score: 0, count: 0 };
    bucket.score += compositeScore(entry) * (entry.bias === regime || regime === 'neutral' ? 1.1 : 0.9);
    bucket.count += 1;
    groupScores[entry.group] = bucket;
  }
  const rankings = Object.entries(groupScores)
    .map(([group, stats]) => ({
      id: group,
      label: group.replace(/-/g, ' '),
      group,
      score: Math.round(stats.score / Math.max(stats.count, 1)),
      decision: (regime === 'bullish' ? 'buy' : regime === 'bearish' ? 'sell' : 'wait') as StrategyControlSignalSide,
      confidence: Math.round(stats.score / Math.max(stats.count, 1)),
      bias: regime,
      detail: `${stats.count} engines`,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);
  return {
    moduleId: 'strategy-adaptation-engine',
    label: STRATEGY_CONTROL_MODULE_MAP['strategy-adaptation-engine'].label,
    summary: `Regime ${regime} · favor ${rankings[0]?.label ?? 'balanced'} groups`,
    decision: regime === 'bullish' ? 'buy' : regime === 'bearish' ? 'sell' : 'neutral',
    confidence: Math.round((Math.max(bullish, bearish, neutral) / Math.max(healthy.length, 1)) * 100),
    reasons: [
      `Strategy adaptation — book regime ${regime}`,
      `Bias mix bull ${bullish} · bear ${bearish} · neutral ${neutral}`,
      rankings[0] ? `Favor group ${rankings[0].label}` : 'No group adaptation signal',
    ],
    metrics: { regime, bullishCount: bullish, bearishCount: bearish, neutralCount: neutral },
    rankings,
    evaluatedAt,
  };
}

function runStrategyRiskProfiler(entries: StrategyControlOverviewEntry[], evaluatedAt: string): StrategyControlResult {
  const healthy = healthyEntries(entries);
  const rankings = healthy
    .map((entry) => {
      const aggression = entry.decision !== 'wait' ? 1 : 0;
      const variancePenalty = entry.confidence < 35 ? 12 : 0;
      const riskScore = Math.round(clamp(aggression * 40 + (100 - entry.confidence) * 0.35 + variancePenalty, 0, 100));
      return {
        id: entry.id,
        label: entry.label,
        group: entry.group,
        score: riskScore,
        decision: entry.decision,
        confidence: entry.confidence,
        bias: entry.bias,
        detail: riskScore >= 65 ? 'High risk tier' : riskScore >= 40 ? 'Medium risk tier' : 'Low risk tier',
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 15);
  const avgRisk = rankings.length > 0 ? Math.round(rankings.reduce((sum, item) => sum + item.score, 0) / rankings.length) : 0;
  const highRisk = rankings.filter((item) => item.score >= 65).length;
  return {
    moduleId: 'strategy-risk-profiler',
    label: STRATEGY_CONTROL_MODULE_MAP['strategy-risk-profiler'].label,
    summary: `Average risk tier score ${avgRisk} · ${highRisk} high-risk engines`,
    decision: highRisk > 5 ? 'sell' : 'wait',
    confidence: avgRisk,
    reasons: [
      'Strategy risk profiler — aggression + inverse confidence risk tiers',
      `${highRisk} engines in high-risk tier`,
      `Book error count ${entries.filter((item) => item.error).length}`,
    ],
    metrics: { averageRiskScore: avgRisk, highRiskCount: highRisk, errorCount: entries.filter((item) => item.error).length },
    rankings,
    evaluatedAt,
  };
}

function runMultiStrategyOrchestration(entries: StrategyControlOverviewEntry[], evaluatedAt: string): StrategyControlResult {
  const healthy = healthyEntries(entries);
  const buys = healthy.filter((item) => item.decision === 'buy').sort((left, right) => right.confidence - left.confidence);
  const sells = healthy.filter((item) => item.decision === 'sell').sort((left, right) => right.confidence - left.confidence);
  const conflicts = Math.min(buys.length, sells.length);
  const stack: StrategyControlRankingRow[] = [
    ...buys.slice(0, 5).map((entry) => ({
      id: entry.id, label: entry.label, group: entry.group, score: compositeScore(entry),
      decision: entry.decision, confidence: entry.confidence, bias: entry.bias, detail: 'Long stack',
    })),
    ...sells.slice(0, 5).map((entry) => ({
      id: entry.id, label: entry.label, group: entry.group, score: compositeScore(entry),
      decision: entry.decision, confidence: entry.confidence, bias: entry.bias, detail: 'Short stack',
    })),
  ];
  const net = buys.length - sells.length;
  const decision: StrategyControlSignalSide | 'neutral' = net > 2 ? 'buy' : net < -2 ? 'sell' : 'neutral';
  const topBuy = buys[0];
  const topSell = sells[0];
  return {
    moduleId: 'multi-strategy-orchestration',
    label: STRATEGY_CONTROL_MODULE_MAP['multi-strategy-orchestration'].label,
    summary: `Orchestration stack ${buys.length} long / ${sells.length} short · ${conflicts} conflict bands`,
    decision,
    confidence: Math.round(clamp(Math.abs(net) * 8 + (topBuy?.confidence ?? 0) * 0.2 + (topSell?.confidence ?? 0) * 0.2, 0, 100)),
    reasons: [
      'Multi-strategy orchestration — complementary stack with conflict detection',
      `${buys.length} buy signals · ${sells.length} sell signals`,
      conflicts > 3 ? 'Elevated cross-book conflict — prefer wait' : 'Conflict within normal band',
      topBuy ? `Top long ${topBuy.label}` : 'No long stack leader',
      topSell ? `Top short ${topSell.label}` : 'No short stack leader',
    ],
    metrics: { buyCount: buys.length, sellCount: sells.length, conflictBand: conflicts, netDirectional: net },
    rankings: stack,
    evaluatedAt,
  };
}

const RUNNERS: Record<StrategyControlSlug, (entries: StrategyControlOverviewEntry[], evaluatedAt: string, symbol: string) => StrategyControlResult> = {
  'ai-strategy-selector': (entries, evaluatedAt) => runAiStrategySelector(entries, evaluatedAt),
  'autonomous-strategy-rotation': runAutonomousStrategyRotation,
  'strategy-scoring-engine': (entries, evaluatedAt) => runStrategyScoringEngine(entries, evaluatedAt),
  'strategy-confidence-engine': (entries, evaluatedAt) => runStrategyConfidenceEngine(entries, evaluatedAt),
  'strategy-optimization-engine': (entries, evaluatedAt) => runStrategyOptimizationEngine(entries, evaluatedAt),
  'strategy-adaptation-engine': (entries, evaluatedAt) => runStrategyAdaptationEngine(entries, evaluatedAt),
  'strategy-risk-profiler': (entries, evaluatedAt) => runStrategyRiskProfiler(entries, evaluatedAt),
  'multi-strategy-orchestration': (entries, evaluatedAt) => runMultiStrategyOrchestration(entries, evaluatedAt),
};

export function evaluateStrategyControlModule(
  moduleId: StrategyControlSlug,
  entries: StrategyControlOverviewEntry[],
  evaluatedAt: string,
  symbol: string,
): StrategyControlResult {
  return RUNNERS[moduleId](entries, evaluatedAt, symbol);
}

export async function runStrategyControlModule(moduleId: StrategyControlSlug): Promise<StrategyControlPayload> {
  const overview = await runAutonomousOverviewEvaluations();
  const evaluatedAt = overview.evaluatedAt;
  const entries = overview.strategies as StrategyControlOverviewEntry[];
  const result = evaluateStrategyControlModule(moduleId, entries, evaluatedAt, overview.symbol);
  result.rankings = attachGroupLeaders(result.rankings, entries);
  return {
    ok: true,
    moduleId,
    symbol: overview.symbol,
    pipelineMode: overview.pipelineMode,
    activeSymbols: overview.activeSymbols,
    bridgeOnline: overview.bridgeOnline,
    refreshIntervalMs: 15_000,
    evaluatedAt,
    result,
  };
}
