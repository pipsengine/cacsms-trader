import { attachGroupLeaders, decisionEntropy } from './book-ranking-utils';
import { RESEARCH_EVOLUTION_MODULE_MAP, type ResearchEvolutionSlug } from './research-evolution-modules';
import type { BookEntry, ResearchEvolutionPayload, ResearchEvolutionResult } from './research-evolution-types';
import { runAutonomousOverviewEvaluations } from './run-strategy-evaluation';
import type { StrategyControlSignalSide } from './strategy-control-types';
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function healthy(entries: BookEntry[]): BookEntry[] {
  return entries.filter((item) => !item.error);
}

function compositeScore(entry: BookEntry): number {
  if (entry.error) return 0;
  const action = entry.decision === 'wait' ? 0.35 : 1;
  const align = entry.decision === 'buy' && entry.bias === 'bullish' ? 18
    : entry.decision === 'sell' && entry.bias === 'bearish' ? 18
      : entry.decision === 'wait' ? 8 : 4;
  return Math.round(clamp(entry.confidence * action + align, 0, 100));
}

function bookDecision(entries: BookEntry[]): StrategyControlSignalSide | 'neutral' {
  const h = healthy(entries);
  const buy = h.filter((item) => item.decision === 'buy').length;
  const sell = h.filter((item) => item.decision === 'sell').length;
  if (buy > sell * 1.15) return 'buy';
  if (sell > buy * 1.15) return 'sell';
  return 'neutral';
}

function groupStats(entries: BookEntry[]): Map<string, { count: number; buy: number; sell: number; wait: number; avgConf: number; score: number }> {
  const map = new Map<string, { count: number; buy: number; sell: number; wait: number; confSum: number; scoreSum: number }>();
  for (const entry of healthy(entries)) {
    const bucket = map.get(entry.group) ?? { count: 0, buy: 0, sell: 0, wait: 0, confSum: 0, scoreSum: 0 };
    bucket.count += 1;
    if (entry.decision === 'buy') bucket.buy += 1;
    else if (entry.decision === 'sell') bucket.sell += 1;
    else bucket.wait += 1;
    bucket.confSum += entry.confidence;
    bucket.scoreSum += compositeScore(entry);
    map.set(entry.group, bucket);
  }
  const result = new Map<string, { count: number; buy: number; sell: number; wait: number; avgConf: number; score: number }>();
  for (const [group, stats] of map) {
    result.set(group, {
      count: stats.count,
      buy: stats.buy,
      sell: stats.sell,
      wait: stats.wait,
      avgConf: stats.count > 0 ? stats.confSum / stats.count : 0,
      score: stats.count > 0 ? stats.scoreSum / stats.count : 0,
    });
  }
  return result;
}

function runBehavioralAnalysis(entries: BookEntry[], evaluatedAt: string): ResearchEvolutionResult {
  const h = healthy(entries);
  const buy = h.filter((item) => item.decision === 'buy').length;
  const sell = h.filter((item) => item.decision === 'sell').length;
  const wait = h.filter((item) => item.decision === 'wait').length;
  const bullish = h.filter((item) => item.bias === 'bullish').length;
  const bearish = h.filter((item) => item.bias === 'bearish').length;
  const dominant = buy >= sell && buy >= wait ? 'buy' : sell >= wait ? 'sell' : 'wait';
  const entropy = decisionEntropy(buy, sell, wait);
  const rankings = [...groupStats(entries).entries()]    .map(([group, stats]) => ({
      id: group,
      label: group.replace(/-/g, ' '),
      group,
      score: Math.round((stats.buy + stats.sell) / Math.max(stats.count, 1) * 100),
      decision: stats.buy > stats.sell ? 'buy' as const : stats.sell > stats.buy ? 'sell' as const : 'wait' as const,
      confidence: Math.round(stats.avgConf),
      bias: stats.buy > stats.sell ? 'bullish' : stats.sell > stats.buy ? 'bearish' : 'neutral',
      detail: `${stats.buy}B/${stats.sell}S/${stats.wait}W`,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  return {
    moduleId: 'strategy-behavioral-analysis',
    label: RESEARCH_EVOLUTION_MODULE_MAP['strategy-behavioral-analysis'].label,
    summary: `Behavioral mix ${buy} buy · ${sell} sell · ${wait} wait · dominant ${dominant}`,
    decision: dominant === 'wait' ? bookDecision(entries) : dominant,
    confidence: Math.round((Math.max(buy, sell, wait) / Math.max(h.length, 1)) * 100),
    reasons: [
      'Strategy behavioral analysis — book-wide decision and bias clustering',
      `Bias mix bull ${bullish} · bear ${bearish} · neutral ${h.length - bullish - bearish}`,
      `Decision entropy ${entropy} · dominant ${dominant}`,
    ],
    metrics: { buyCount: buy, sellCount: sell, waitCount: wait, bullishCount: bullish, bearishCount: bearish, decisionEntropy: entropy },    rankings,
    evaluatedAt,
  };
}

function runCorrelationAnalysis(entries: BookEntry[], evaluatedAt: string): ResearchEvolutionResult {
  const h = healthy(entries);
  const bookDir = bookDecision(entries);
  const aligned = h.filter((item) =>
    (bookDir === 'buy' && item.decision === 'buy')
    || (bookDir === 'sell' && item.decision === 'sell')
    || (bookDir === 'neutral' && item.decision === 'wait')).length;
  const correlationPct = h.length > 0 ? (aligned / h.length) * 100 : 0;
  const decorrelated = h.length - aligned;
  const groupAlignment = [...groupStats(entries).entries()]
    .map(([group, stats]) => ({
      group,
      alignment: bookDir === 'buy' ? stats.buy / Math.max(stats.count, 1)
        : bookDir === 'sell' ? stats.sell / Math.max(stats.count, 1)
          : stats.wait / Math.max(stats.count, 1),
    }))
    .sort((left, right) => right.alignment - left.alignment);
  const topAlignedGroup = groupAlignment[0];
  const rankings = h    .map((entry) => {
      const alignedToBook = (bookDir === 'buy' && entry.decision === 'buy')
        || (bookDir === 'sell' && entry.decision === 'sell')
        || (bookDir === 'neutral');
      return {
        id: entry.id,
        label: entry.label,
        group: entry.group,
        score: alignedToBook ? compositeScore(entry) : Math.round(compositeScore(entry) * 0.5),
        decision: entry.decision,
        confidence: entry.confidence,
        bias: entry.bias,
        detail: alignedToBook ? 'Book-aligned' : 'Decorrelated',
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  return {
    moduleId: 'strategy-correlation-analysis',
    label: RESEARCH_EVOLUTION_MODULE_MAP['strategy-correlation-analysis'].label,
    summary: `Book correlation ${correlationPct.toFixed(0)}% aligned with ${bookDir} regime`,
    decision: bookDir,
    confidence: Math.round(correlationPct),
    reasons: [
      'Strategy correlation — directional alignment with book consensus',
      `${aligned}/${h.length} engines aligned · ${decorrelated} decorrelated`,
      topAlignedGroup ? `Most aligned group ${topAlignedGroup.group.replace(/-/g, ' ')} (${(topAlignedGroup.alignment * 100).toFixed(0)}%)` : 'No group alignment',
    ],
    metrics: {
      correlationPct: Number(correlationPct.toFixed(2)),
      alignedCount: aligned,
      decorrelatedCount: decorrelated,
      topGroupAlignmentPct: topAlignedGroup ? Number((topAlignedGroup.alignment * 100).toFixed(2)) : 0,
    },    rankings,
    evaluatedAt,
  };
}

function runPerformanceMonitor(entries: BookEntry[], evaluatedAt: string): ResearchEvolutionResult {
  const h = healthy(entries);
  const errors = entries.filter((item) => item.error).length;
  const actionable = h.filter((item) => item.decision !== 'wait').length;
  const avgConf = h.length > 0 ? h.reduce((sum, item) => sum + item.confidence, 0) / h.length : 0;
  const healthScore = Math.round(clamp((h.length / Math.max(entries.length, 1)) * 50 + avgConf * 0.5 - errors * 2, 0, 100));
  const rankings = h
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      score: compositeScore(entry),
      decision: entry.decision,
      confidence: entry.confidence,
      bias: entry.bias,
      detail: entry.decision !== 'wait' ? 'Actionable' : 'Monitoring',
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  return {
    moduleId: 'strategy-performance-monitor',
    label: RESEARCH_EVOLUTION_MODULE_MAP['strategy-performance-monitor'].label,
    summary: `Health ${healthScore}/100 · ${actionable} actionable · ${errors} errors`,
    decision: healthScore >= 60 ? bookDecision(entries) : 'wait',
    confidence: healthScore,
    reasons: [
      'Strategy performance monitor — live book health and signal density',
      `${h.length} healthy · ${errors} erroring engines`,
      `Average confidence ${avgConf.toFixed(1)}%`,
    ],
    metrics: { healthScore, actionableCount: actionable, errorCount: errors, avgConfidence: Number(avgConf.toFixed(2)) },
    rankings,
    evaluatedAt,
  };
}

function runAiReinforcementLearning(entries: BookEntry[], evaluatedAt: string): ResearchEvolutionResult {
  const h = healthy(entries);
  const rankings = h
    .map((entry) => {
      const reward = entry.decision !== 'wait'
        ? entry.confidence * (entry.bias === (entry.decision === 'buy' ? 'bullish' : 'bearish') ? 1.2 : 0.8)
        : entry.confidence * 0.3;
      return {
        id: entry.id,
        label: entry.label,
        group: entry.group,
        score: Math.round(clamp(reward, 0, 100)),
        decision: entry.decision,
        confidence: entry.confidence,
        bias: entry.bias,
        detail: `Reward ${Math.round(reward)}`,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  const top = rankings[0];
  return {
    moduleId: 'ai-reinforcement-learning',
    label: RESEARCH_EVOLUTION_MODULE_MAP['ai-reinforcement-learning'].label,
    summary: top ? `Top RL reward ${top.label} (${top.score})` : 'No reward signal',
    decision: top?.decision !== 'wait' ? top.decision : bookDecision(entries),
    confidence: top?.score ?? 0,
    reasons: [
      'AI reinforcement learning — confidence × alignment reward proxy',
      top ? `Policy leader ${top.label}` : 'Awaiting reward signal',
      `${rankings.filter((item) => item.score >= 60).length} high-reward engines`,
    ],
    metrics: { highRewardCount: rankings.filter((item) => item.score >= 60).length, topReward: top?.score ?? 0 },
    rankings,
    evaluatedAt,
  };
}

function runAdaptiveMarketIntelligence(entries: BookEntry[], evaluatedAt: string, symbol: string): ResearchEvolutionResult {
  const h = healthy(entries);
  const buyConf = h.filter((item) => item.decision === 'buy').reduce((sum, item) => sum + item.confidence, 0);
  const sellConf = h.filter((item) => item.decision === 'sell').reduce((sum, item) => sum + item.confidence, 0);
  const intelligence = buyConf - sellConf;
  const norm = h.length > 0 ? intelligence / h.length : 0;
  const decision: StrategyControlSignalSide | 'neutral' = norm > 8 ? 'buy' : norm < -8 ? 'sell' : 'neutral';
  const rankings = topRankingsFromEntries(h, 12);
  return {
    moduleId: 'adaptive-market-intelligence',
    label: RESEARCH_EVOLUTION_MODULE_MAP['adaptive-market-intelligence'].label,
    summary: `Adaptive intelligence for ${symbol}: ${norm >= 0 ? '+' : ''}${norm.toFixed(1)} net confidence`,
    decision,
    confidence: Math.round(clamp(Math.abs(norm) * 3 + 40, 0, 100)),
    reasons: [
      'Adaptive market intelligence — fused buy/sell confidence differential',
      `Net confidence delta ${norm.toFixed(2)} per engine`,
      decision !== 'neutral' ? `Adaptive bias ${decision}` : 'Neutral adaptive intelligence',
    ],
    metrics: { netConfidenceDelta: Number(norm.toFixed(3)), buyConfSum: Math.round(buyConf), sellConfSum: Math.round(sellConf) },
    rankings,
    evaluatedAt,
  };
}

function runMarketRegimeAdaptation(entries: BookEntry[], evaluatedAt: string): ResearchEvolutionResult {
  const h = healthy(entries);
  const bull = h.filter((item) => item.bias === 'bullish').length;
  const bear = h.filter((item) => item.bias === 'bearish').length;
  const regime = bull > bear * 1.1 ? 'bullish' : bear > bull * 1.1 ? 'bearish' : 'neutral';
  const rankings = [...groupStats(entries).entries()]
    .map(([group, stats]) => ({
      id: group,
      label: group.replace(/-/g, ' '),
      group,
      score: Math.round(stats.score),
      decision: (regime === 'bullish' ? 'buy' : regime === 'bearish' ? 'sell' : 'wait') as StrategyControlSignalSide,
      confidence: Math.round(stats.avgConf),
      bias: regime,
      detail: `${stats.count} engines`,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  return {
    moduleId: 'market-regime-adaptation',
    label: RESEARCH_EVOLUTION_MODULE_MAP['market-regime-adaptation'].label,
    summary: `Market regime ${regime} · ${rankings[0]?.label ?? 'n/a'} leading group`,
    decision: regime === 'bullish' ? 'buy' : regime === 'bearish' ? 'sell' : 'neutral',
    confidence: Math.round((Math.max(bull, bear) / Math.max(h.length, 1)) * 100),
    reasons: [
      `Market regime adaptation — ${regime} regime detected`,
      `Bull ${bull} · bear ${bear}`,
      rankings[0] ? `Adapt toward ${rankings[0].label}` : 'Balanced adaptation',
    ],
    metrics: { regime, bullishCount: bull, bearishCount: bear },
    rankings,
    evaluatedAt,
  };
}

function runAutonomousStrategyEvolution(entries: BookEntry[], evaluatedAt: string): ResearchEvolutionResult {
  const h = healthy(entries);
  const rankings = h
    .map((entry) => {
      const fitness = compositeScore(entry) * (entry.confidence >= 45 ? 1.1 : 0.9);
      return {
        id: entry.id,
        label: entry.label,
        group: entry.group,
        score: Math.round(clamp(fitness, 0, 100)),
        decision: entry.decision,
        confidence: entry.confidence,
        bias: entry.bias,
        detail: fitness >= 70 ? 'High fitness' : fitness >= 45 ? 'Evolving' : 'Low fitness',
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  const top = rankings[0];
  return {
    moduleId: 'autonomous-strategy-evolution',
    label: RESEARCH_EVOLUTION_MODULE_MAP['autonomous-strategy-evolution'].label,
    summary: top ? `Evolution leader ${top.label} (fitness ${top.score})` : 'No fitness data',
    decision: top?.decision !== 'wait' ? top.decision : bookDecision(entries),
    confidence: top?.score ?? 0,
    reasons: [
      'Autonomous strategy evolution — fitness-ranked engine population',
      `${rankings.filter((item) => item.score >= 70).length} high-fitness engines`,
      top ? `Generation leader ${top.label}` : 'Population awaiting fitness signal',
    ],
    metrics: { highFitnessCount: rankings.filter((item) => item.score >= 70).length, topFitness: top?.score ?? 0 },
    rankings,
    evaluatedAt,
  };
}

function runHistoricalStrategyComparison(entries: BookEntry[], evaluatedAt: string): ResearchEvolutionResult {
  const stats = groupStats(entries);
  const rankings = [...stats.entries()]
    .map(([group, s]) => ({
      id: group,
      label: group.replace(/-/g, ' '),
      group,
      score: Math.round(s.score),
      decision: s.buy > s.sell ? 'buy' as const : s.sell > s.buy ? 'sell' as const : 'wait' as const,
      confidence: Math.round(s.avgConf),
      bias: s.buy > s.sell ? 'bullish' : s.sell > s.buy ? 'bearish' : 'neutral',
      detail: `Actionable ${s.buy + s.sell}/${s.count}`,
    }))
    .sort((a, b) => b.score - a.score);
  const top = rankings[0];
  const bottom = rankings.at(-1);
  const scoreSpread = top && bottom ? top.score - bottom.score : 0;
  return {    moduleId: 'historical-strategy-comparison',
    label: RESEARCH_EVOLUTION_MODULE_MAP['historical-strategy-comparison'].label,
    summary: top && bottom ? `Best ${top.label} (${top.score}) vs laggard ${bottom.label} (${bottom.score})` : 'Insufficient groups',
    decision: top?.decision ?? 'neutral',
    confidence: top?.score ?? 0,
    reasons: [
      'Historical strategy comparison — cross-group benchmark proxy',
      top ? `Leading group ${top.label} (${top.score})` : 'No group leader',
      bottom ? `Lagging group ${bottom.label} (${bottom.score}) · spread ${scoreSpread}` : '',
    ].filter(Boolean),
    metrics: { groupCount: rankings.length, topScore: top?.score ?? 0, bottomScore: bottom?.score ?? 0, scoreSpread },    rankings: rankings.slice(0, 15),
    evaluatedAt,
  };
}

function runInstitutionalStrategyFramework(entries: BookEntry[], evaluatedAt: string): ResearchEvolutionResult {
  const total = entries.length;
  const h = healthy(entries);
  const coverage = total > 0 ? (h.length / total) * 100 : 0;
  const actionable = h.filter((item) => item.decision !== 'wait').length;
  const compliance = Math.round(clamp(coverage * 0.6 + (actionable / Math.max(h.length, 1)) * 40, 0, 100));
  const rankings = topRankingsFromEntries(h, 10);
  return {
    moduleId: 'institutional-strategy-framework',
    label: RESEARCH_EVOLUTION_MODULE_MAP['institutional-strategy-framework'].label,
    summary: `Framework compliance ${compliance}% · ${h.length}/${total} engines healthy`,
    decision: compliance >= 70 ? bookDecision(entries) : 'wait',
    confidence: compliance,
    reasons: [
      'Institutional strategy framework — coverage and health compliance',
      `Coverage ${coverage.toFixed(0)}% · actionable density ${((actionable / Math.max(h.length, 1)) * 100).toFixed(0)}%`,
      compliance >= 70 ? 'Framework compliant' : 'Framework below compliance threshold',
    ],
    metrics: { compliancePct: compliance, healthyCount: h.length, totalEngines: total, actionableCount: actionable },
    rankings,
    evaluatedAt,
  };
}

function runHybridAiStrategyIntelligence(entries: BookEntry[], evaluatedAt: string): ResearchEvolutionResult {
  const hybridGroups = ['hybrid-strategies', 'quantitative-and-algorithmic-strategies', 'advanced-professional-and-institutional-models'];
  const h = healthy(entries).filter((item) => hybridGroups.includes(item.group)
    || item.id.includes('ai')
    || item.id.includes('neural')
    || item.id.includes('hybrid'));
  const rankings = topRankingsFromEntries(h, 15);
  const buy = h.filter((item) => item.decision === 'buy').length;
  const sell = h.filter((item) => item.decision === 'sell').length;
  const fusion = h.length > 0 ? h.reduce((sum, item) => sum + compositeScore(item), 0) / h.length : 0;
  return {
    moduleId: 'hybrid-ai-strategy-intelligence',
    label: RESEARCH_EVOLUTION_MODULE_MAP['hybrid-ai-strategy-intelligence'].label,
    summary: `Hybrid/AI fusion score ${fusion.toFixed(0)} · ${h.length} engines in fusion layer`,
    decision: buy > sell ? 'buy' : sell > buy ? 'sell' : bookDecision(entries),
    confidence: Math.round(fusion),
    reasons: [
      'Hybrid AI strategy intelligence — fusion of hybrid, quant, and AI-adjacent engines',
      `${h.length} engines in fusion universe`,
      `${buy} fusion long · ${sell} fusion short`,
    ],
    metrics: { fusionScore: Number(fusion.toFixed(2)), fusionEngineCount: h.length, buyCount: buy, sellCount: sell },
    rankings,
    evaluatedAt,
  };
}

function topRankingsFromEntries(h: BookEntry[], limit: number) {
  return h
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      score: compositeScore(entry),
      decision: entry.decision,
      confidence: entry.confidence,
      bias: entry.bias,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const RUNNERS: Record<ResearchEvolutionSlug, (entries: BookEntry[], evaluatedAt: string, symbol: string) => ResearchEvolutionResult> = {
  'strategy-behavioral-analysis': (entries, evaluatedAt) => runBehavioralAnalysis(entries, evaluatedAt),
  'strategy-correlation-analysis': (entries, evaluatedAt) => runCorrelationAnalysis(entries, evaluatedAt),
  'strategy-performance-monitor': (entries, evaluatedAt) => runPerformanceMonitor(entries, evaluatedAt),
  'ai-reinforcement-learning': (entries, evaluatedAt) => runAiReinforcementLearning(entries, evaluatedAt),
  'adaptive-market-intelligence': runAdaptiveMarketIntelligence,
  'market-regime-adaptation': (entries, evaluatedAt) => runMarketRegimeAdaptation(entries, evaluatedAt),
  'autonomous-strategy-evolution': (entries, evaluatedAt) => runAutonomousStrategyEvolution(entries, evaluatedAt),
  'historical-strategy-comparison': (entries, evaluatedAt) => runHistoricalStrategyComparison(entries, evaluatedAt),
  'institutional-strategy-framework': (entries, evaluatedAt) => runInstitutionalStrategyFramework(entries, evaluatedAt),
  'hybrid-ai-strategy-intelligence': (entries, evaluatedAt) => runHybridAiStrategyIntelligence(entries, evaluatedAt),
};

export function evaluateResearchEvolutionModule(
  moduleId: ResearchEvolutionSlug,
  entries: BookEntry[],
  evaluatedAt: string,
  symbol: string,
): ResearchEvolutionResult {
  return RUNNERS[moduleId](entries, evaluatedAt, symbol);
}

export async function runResearchEvolutionModule(moduleId: ResearchEvolutionSlug): Promise<ResearchEvolutionPayload> {
  const overview = await runAutonomousOverviewEvaluations();
  const entries = overview.strategies as BookEntry[];
  const result = evaluateResearchEvolutionModule(moduleId, entries, overview.evaluatedAt, overview.symbol);
  result.rankings = attachGroupLeaders(result.rankings, entries);
  return {
    ok: true,
    moduleId,
    symbol: overview.symbol,
    pipelineMode: overview.pipelineMode,
    activeSymbols: overview.activeSymbols,
    bridgeOnline: overview.bridgeOnline,
    refreshIntervalMs: 15_000,
    evaluatedAt: overview.evaluatedAt,
    result,
  };
}