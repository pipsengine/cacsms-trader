import type { AutonomousDecisionInput, AutonomousDecisionOutput, AutonomyDecision } from './autonomy-types';

export function buildAutonomousDecision(input: AutonomousDecisionInput): AutonomousDecisionOutput {
  const visual = input.visual ?? {};
  const macro = input.macro ?? {};
  const execution = input.execution ?? {};
  const confidenceScore = clamp(Number(visual.confidenceScore ?? 0), 0, 100);
  const setupReadinessScore = clamp(Number(visual.setupReadinessScore ?? 0), 0, 100);
  const economicRisk = clamp(Number(macro.economicRiskScore ?? 0), 0, 100);
  const spreadRisk = 100 - clamp(Number(execution.spreadScore ?? 75), 0, 100);
  const dataRisk = 100 - clamp(Number(execution.dataQualityScore ?? 65), 0, 100);
  const captureRisk = 100 - clamp(Number(execution.captureQualityScore ?? 65), 0, 100);
  const riskScore = Math.round(clamp(economicRisk * 0.35 + spreadRisk * 0.25 + dataRisk * 0.2 + captureRisk * 0.2, 0, 100));
  const finalBias = normalizeBias(visual.finalMarketBias);
  const baseDecision = normalizeDecision(visual.finalDecision);
  const blockers = collectBlockers({ confidenceScore, setupReadinessScore, riskScore, input });
  const decision = downgradeDecision(baseDecision, finalBias, blockers);
  const setupType = inferSetupType(String(visual.marketPhase ?? ''), String(visual.liquidityObjective ?? ''));

  return {
    symbol: input.symbol.toUpperCase(),
    timeframe: input.timeframe.toUpperCase(),
    dominantTimeframe: input.dominantTimeframe ?? input.timeframe.toUpperCase(),
    finalBias,
    setupType,
    setupReadinessScore: Math.round(setupReadinessScore),
    confidenceScore: Math.round(confidenceScore),
    riskScore,
    decision,
    entryZone: buildEntryZone(decision, visual.entryReadiness),
    stopLoss: null,
    takeProfitLevels: [],
    invalidationLevel: null,
    reasonForDecision: reasonFor(decision, finalBias, setupReadinessScore, confidenceScore),
    reasonAgainstDecision: blockers.length ? blockers.join(' ') : 'No hard autonomous blocker is active from the available evidence.',
    macroRiskWarning: macro.warning ?? (economicRisk >= 65 ? 'Macro risk is elevated near high-impact conditions.' : 'No high-impact macro blocker is available from current data.'),
    liquidityWarning: visual.liquidityObjective ?? 'Liquidity context is not available; the system will not force an execution signal.',
    anomalyWarning: visual.riskWarning ?? 'No visual anomaly warning is available from the latest result.',
    recommendedNextAction: nextAction(decision),
  };
}

function collectBlockers(input: { confidenceScore: number; setupReadinessScore: number; riskScore: number; input: AutonomousDecisionInput }) {
  const blockers: string[] = [];
  const text = `${input.input.visual?.riskWarning ?? ''} ${input.input.visual?.liquidityObjective ?? ''}`.toLowerCase();
  if (input.confidenceScore < 55) blockers.push('Confidence is below autonomous signal threshold.');
  if (input.setupReadinessScore < 55) blockers.push('Setup readiness is not mature.');
  if (input.riskScore >= 70) blockers.push('Risk score is too high for autonomous escalation.');
  if (text.includes('critical') || text.includes('unclear')) blockers.push('Visual anomaly or liquidity clarity blocks execution.');
  if (input.input.macro?.warning?.toLowerCase().includes('high-impact')) blockers.push('High-impact macro risk is active.');
  return blockers;
}

function downgradeDecision(decision: AutonomyDecision, bias: string, blockers: string[]): AutonomyDecision {
  if (blockers.some((item) => item.includes('Risk score') || item.includes('High-impact'))) return 'AVOID';
  if (blockers.length) return 'MONITOR';
  if (decision === 'BUY' && bias === 'bullish') return 'BUY';
  if (decision === 'SELL' && bias === 'bearish') return 'SELL';
  if (decision === 'WAIT' || decision === 'AVOID' || decision === 'MONITOR') return decision;
  return 'WAIT';
}

function normalizeDecision(value: unknown): AutonomyDecision {
  const text = String(value ?? '').toUpperCase();
  if (['BUY', 'SELL', 'WAIT', 'AVOID', 'MONITOR'].includes(text)) return text as AutonomyDecision;
  return 'MONITOR';
}

function normalizeBias(value: unknown) {
  const text = String(value ?? 'neutral').toLowerCase();
  if (text.includes('bull')) return 'bullish';
  if (text.includes('bear')) return 'bearish';
  if (text.includes('mixed')) return 'mixed';
  return 'neutral';
}

function inferSetupType(phase: string, liquidity: string) {
  const text = `${phase} ${liquidity}`.toLowerCase();
  if (text.includes('sweep') || text.includes('trap')) return 'liquidity sweep confirmation';
  if (text.includes('expansion') || text.includes('breakout')) return 'expansion continuation';
  if (text.includes('compression') || text.includes('consolidation')) return 'compression breakout watch';
  if (text.includes('reversal')) return 'reversal attempt';
  return 'market structure assessment';
}

function buildEntryZone(decision: AutonomyDecision, entryReadiness: unknown) {
  return { status: decision === 'BUY' || decision === 'SELL' ? 'conditional' : 'not_ready', narrative: String(entryReadiness ?? 'Entry zone waits for confirmed visual and risk alignment.') };
}

function reasonFor(decision: AutonomyDecision, bias: string, readiness: number, confidence: number) {
  return `${decision} selected with ${bias} bias, ${Math.round(readiness)} setup readiness, and ${Math.round(confidence)} confidence after autonomous fusion.`;
}

function nextAction(decision: AutonomyDecision) {
  if (decision === 'BUY' || decision === 'SELL') return 'Generate alert and prepare assisted trade plan under configured risk controls.';
  if (decision === 'WAIT') return 'Wait for lower-timeframe confirmation at candle close.';
  if (decision === 'AVOID') return 'Block signal generation until risk or data quality improves.';
  return 'Continue monitoring and rerun the autonomous stack on the next scheduled candle.';
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
