import {
  type FinalImageInterpretation,
  type ImageComparisonResult,
  type ImageComparisonTimeframe,
} from './image-comparison-engine';

export const TOP_DOWN_TIMEFRAMES = ['W', 'D', 'H4', 'H1', 'M15'] as const;
export type TopDownTimeframe = (typeof TOP_DOWN_TIMEFRAMES)[number];

export type TopDownComparisonSnapshot = Pick<
  ImageComparisonResult,
  | 'comparisonScore'
  | 'similarityPercentage'
  | 'visualChangeConfidence'
  | 'changedBias'
  | 'finalInterpretation'
  | 'changedStructures'
  | 'newZones'
  | 'invalidatedZones'
  | 'heatmapUrl'
  | 'differenceBlocks'
  | 'aiExplanation'
  | 'marketChangeTimeline'
  | 'institutionalInterpretation'
  | 'recommendation'
  | 'confidence'
  | 'previousImageUrl'
  | 'currentImageUrl'
>;

export type TopDownTimeframeResult = {
  timeframe: TopDownTimeframe;
  ready: boolean;
  previousCaptureId: string | null;
  currentCaptureId: string | null;
  comparisonId: string | null;
  result: TopDownComparisonSnapshot | null;
  bias: 'bullish' | 'bearish' | 'neutral';
  interpretation: FinalImageInterpretation | 'unavailable';
  changeScore: number;
};

export type InstitutionalReasoningStep = {
  step: number;
  phase: string;
  insight: string;
  practitionerNote: string;
};

export type TopDownAlignment = {
  leftTimeframe: TopDownTimeframe;
  rightTimeframe: TopDownTimeframe;
  alignmentState: 'aligned_bullish' | 'aligned_bearish' | 'conflict' | 'neutral_ranging' | 'institutional_setup_forming';
  alignmentScore: number;
  explanationText: string;
};

export type TopDownConflict = {
  higherTimeframe: TopDownTimeframe;
  lowerTimeframe: TopDownTimeframe;
  severityScore: number;
  description: string;
  recommendedResolution: string;
};

export type TopDownComparisonDecision = {
  symbol: string;
  finalDecision: 'BUY' | 'SELL' | 'WAIT' | 'AVOID' | 'BUY opportunity' | 'SELL opportunity';
  finalBias: string;
  confidence: number;
  controllingTimeframe: TopDownTimeframe | 'none';
  lowerTimeframeConfirmation: string;
  scalpOnly: boolean;
  institutionalNarrative: string;
  recommendation: string;
  reasoningSteps: InstitutionalReasoningStep[];
  alignments: TopDownAlignment[];
  conflicts: TopDownConflict[];
  timeframeResults: TopDownTimeframeResult[];
  metadata: Record<string, unknown>;
};

const timeframeWeights: Record<TopDownTimeframe, number> = {
  W: 1.35,
  D: 1.2,
  H4: 1.0,
  H1: 0.82,
  M15: 0.65,
};

export function biasFromInterpretation(interpretation: FinalImageInterpretation | 'unavailable'): 'bullish' | 'bearish' | 'neutral' {
  if (interpretation === 'Bullish shift') return 'bullish';
  if (interpretation === 'Bearish shift') return 'bearish';
  if (interpretation === 'Liquidity sweep') return 'neutral';
  if (interpretation === 'Manipulation detected') return 'neutral';
  if (interpretation === 'Setup invalidated') return 'neutral';
  return 'neutral';
}

export function synthesizeTopDownDecision(symbol: string, timeframeResults: TopDownTimeframeResult[]): TopDownComparisonDecision {
  const analyzed = timeframeResults.filter((item) => item.ready && item.result);
  const alignments = buildAlignments(timeframeResults);
  const conflicts = buildConflicts(alignments);
  const weightedBull = weightedBias(timeframeResults, 'bullish');
  const weightedBear = weightedBias(timeframeResults, 'bearish');
  const controlling = controllingTimeframe(timeframeResults);
  const averageAlignment = average(alignments.map((item) => item.alignmentScore));
  const conflictSeverity = conflicts[0]?.severityScore ?? 0;

  const higher = (['W', 'D', 'H4'] as TopDownTimeframe[]).map((tf) => resultFor(timeframeResults, tf));
  const lower = (['H1', 'M15'] as TopDownTimeframe[]).map((tf) => resultFor(timeframeResults, tf));
  const higherBullish = higher.every((item) => item?.bias === 'bullish');
  const higherBearish = higher.every((item) => item?.bias === 'bearish');
  const lowerBullish = lower.every((item) => item?.bias === 'bullish');
  const lowerBearish = lower.every((item) => item?.bias === 'bearish');

  const w = resultFor(timeframeResults, 'W');
  const d = resultFor(timeframeResults, 'D');
  const h4 = resultFor(timeframeResults, 'H4');
  const h1 = resultFor(timeframeResults, 'H1');
  const m15 = resultFor(timeframeResults, 'M15');

  let finalDecision: TopDownComparisonDecision['finalDecision'] = 'WAIT';
  let finalBias = weightedBull > weightedBear
    ? 'Bullish top-down visual delta bias'
    : weightedBear > weightedBull
      ? 'Bearish top-down visual delta bias'
      : 'Neutral/ranging top-down visual delta bias';
  let scalpOnly = false;
  let lowerConfirmation = 'Lower timeframe visual confirmation is incomplete.';

  if (higherBullish && lowerBullish) {
    finalDecision = 'BUY opportunity';
    lowerConfirmation = 'H1 and M15 bullish visual shifts confirm displacement inside W/D/H4 bullish institutional control.';
  } else if (higherBearish && lowerBearish) {
    finalDecision = 'SELL opportunity';
    lowerConfirmation = 'H1 and M15 bearish visual shifts confirm displacement inside W/D/H4 bearish institutional control.';
  } else if (higherBullish && lower.some((item) => item?.bias === 'bearish')) {
    finalDecision = 'WAIT';
    lowerConfirmation = 'Institutional desks treat this as a bullish higher-timeframe correction window; do not sell into W/D demand until H1/M15 invalidate the pullback.';
  } else if (higherBearish && lower.some((item) => item?.bias === 'bullish')) {
    finalDecision = 'WAIT';
    lowerConfirmation = 'Institutional desks treat this as a bearish higher-timeframe correction window; do not buy into W/D supply until H1/M15 invalidate the rally.';
  } else if (w?.bias === 'bullish' && d?.bias === 'bullish' && h4?.bias === 'bearish' && m15?.bias === 'bullish') {
    finalDecision = 'BUY opportunity';
    lowerConfirmation = 'Classic institutional pullback: W/D accumulation intact, H4 corrective sell-off completing, M15 bullish reclaim signals entry timing.';
  } else if (w?.bias === 'bearish' && d?.bias === 'bearish' && h4?.bias === 'bullish' && m15?.bias === 'bearish') {
    finalDecision = 'SELL opportunity';
    lowerConfirmation = 'Classic institutional pullback: W/D distribution intact, H4 corrective rally completing, M15 bearish reclaim signals entry timing.';
  } else if (conflictSeverity > 0.58) {
    finalDecision = conflictSeverity > 0.75 ? 'AVOID' : 'WAIT';
    lowerConfirmation = 'Top-down visual conflict is too high for institutional-size execution; wait for timeframe convergence.';
  } else if (h4?.bias === 'bullish' && h1?.bias === 'bullish' && m15?.bias === 'bullish' && (w?.bias !== 'bullish' || d?.bias !== 'bullish')) {
    finalDecision = 'BUY';
    scalpOnly = true;
    lowerConfirmation = 'H4/H1/M15 align bullish but W/D do not confirm; suitable for tactical scalp only, not full institutional swing.';
  } else if (h4?.bias === 'bearish' && h1?.bias === 'bearish' && m15?.bias === 'bearish' && (w?.bias !== 'bearish' || d?.bias !== 'bearish')) {
    finalDecision = 'SELL';
    scalpOnly = true;
    lowerConfirmation = 'H4/H1/M15 align bearish but W/D do not confirm; suitable for tactical scalp only, not full institutional swing.';
  }

  const confidence = clamp(
    Math.max(weightedBull, weightedBear) * 0.4
    + averageAlignment * 0.34
    + (analyzed.length / TOP_DOWN_TIMEFRAMES.length) * 0.16
    + (1 - conflictSeverity) * 0.1,
    0.12,
    0.97,
  );

  const reasoningSteps = buildReasoningSteps({
    symbol,
    timeframeResults,
    alignments,
    conflicts,
    controlling,
    finalDecision,
    finalBias,
    lowerConfirmation,
    scalpOnly,
    confidence,
  });

  const institutionalNarrative = [
    `${controlling} visually controls ${symbol} with ${finalBias}.`,
    lowerConfirmation,
    `Top-down alignment average is ${Math.round(averageAlignment * 100)}%; strongest conflict severity is ${Math.round(conflictSeverity * 100)}%.`,
    `Institutional decision after comparing W→D→H4→H1→M15 chart deltas: ${finalDecision}${scalpOnly ? ' (scalp-only context)' : ''}.`,
  ].join(' ');

  return {
    symbol,
    finalDecision,
    finalBias,
    confidence,
    controllingTimeframe: controlling,
    lowerTimeframeConfirmation: lowerConfirmation,
    scalpOnly,
    institutionalNarrative,
    recommendation: recommendationForDecision(finalDecision, scalpOnly),
    reasoningSteps,
    alignments,
    conflicts,
    timeframeResults,
    metadata: {
      analyzedTimeframes: analyzed.length,
      weightedBull,
      weightedBear,
      averageAlignment,
      conflictSeverity,
      methodology: 'top_down_visual_delta_institutional_synthesis',
    },
  };
}

function buildAlignments(results: TopDownTimeframeResult[]): TopDownAlignment[] {
  const pairs: Array<[TopDownTimeframe, TopDownTimeframe]> = [['W', 'D'], ['D', 'H4'], ['H4', 'H1'], ['H1', 'M15']];
  return pairs.map(([left, right]) => {
    const leftResult = resultFor(results, left);
    const rightResult = resultFor(results, right);
    if (!leftResult?.ready || !rightResult?.ready) {
      return {
        leftTimeframe: left,
        rightTimeframe: right,
        alignmentState: 'neutral_ranging' as const,
        alignmentScore: 0,
        explanationText: `${left} or ${right} lacks two comparable captures.`,
      };
    }
    const leftBias = leftResult.bias;
    const rightBias = rightResult.bias;
    const score = alignmentScore(leftBias, rightBias, leftResult.changeScore, rightResult.changeScore);
    let alignmentState: TopDownAlignment['alignmentState'] = 'neutral_ranging';
    if (leftBias === 'bullish' && rightBias === 'bullish') alignmentState = 'aligned_bullish';
    else if (leftBias === 'bearish' && rightBias === 'bearish') alignmentState = 'aligned_bearish';
    else if (leftBias !== 'neutral' && rightBias !== 'neutral' && leftBias !== rightBias) alignmentState = 'conflict';
    else if (score >= 0.42) alignmentState = 'institutional_setup_forming';

    const explanationText = alignmentState === 'aligned_bullish'
      ? `${left} and ${right} both show bullish visual displacement; institutional trend leg is intact.`
      : alignmentState === 'aligned_bearish'
        ? `${left} and ${right} both show bearish visual displacement; institutional trend leg is intact.`
        : alignmentState === 'conflict'
          ? `${left} and ${right} disagree on visual bias; professional desks downgrade execution size until alignment returns.`
          : alignmentState === 'institutional_setup_forming'
            ? `${left} and ${right} are not fully aligned yet, but visual delta suggests an institutional setup is forming.`
            : `${left} and ${right} remain neutral or lack decisive visual change.`;

    return { leftTimeframe: left, rightTimeframe: right, alignmentState, alignmentScore: score, explanationText };
  });
}

function buildConflicts(alignments: TopDownAlignment[]): TopDownConflict[] {
  return alignments
    .filter((item) => item.alignmentState === 'conflict')
    .map((item) => ({
      higherTimeframe: item.leftTimeframe,
      lowerTimeframe: item.rightTimeframe,
      severityScore: clamp(1 - item.alignmentScore, 0.2, 0.95),
      description: item.explanationText,
      recommendedResolution: 'Treat lower-timeframe signal as non-executable until adjacent timeframe visual alignment improves.',
    }))
    .sort((a, b) => b.severityScore - a.severityScore);
}

function buildReasoningSteps(input: {
  symbol: string;
  timeframeResults: TopDownTimeframeResult[];
  alignments: TopDownAlignment[];
  conflicts: TopDownConflict[];
  controlling: TopDownTimeframe | 'none';
  finalDecision: TopDownComparisonDecision['finalDecision'];
  finalBias: string;
  lowerConfirmation: string;
  scalpOnly: boolean;
  confidence: number;
}): InstitutionalReasoningStep[] {
  const steps: InstitutionalReasoningStep[] = [];
  let step = 1;

  steps.push({
    step: step++,
    phase: 'Top-down chart inventory',
    insight: `${input.symbol}: ${input.timeframeResults.filter((item) => item.ready).length}/${TOP_DOWN_TIMEFRAMES.length} timeframes have comparable before/after captures.`,
    practitionerNote: 'Institutional desks never trade a single screenshot; they ladder W→D→H4→H1→M15 before committing risk.',
  });

  for (const tf of TOP_DOWN_TIMEFRAMES) {
    const item = resultFor(input.timeframeResults, tf);
    if (!item?.ready || !item.result) continue;
    steps.push({
      step: step++,
      phase: `${tf} visual delta review`,
      insight: `${tf}: ${item.result.finalInterpretation} (${item.result.similarityPercentage.toFixed(1)}% similar, change score ${item.result.comparisonScore.toFixed(1)}). ${item.result.aiExplanation}`,
      practitionerNote: tfWeightNote(tf),
    });
  }

  const bullishAlign = input.alignments.filter((item) => item.alignmentState === 'aligned_bullish').length;
  const bearishAlign = input.alignments.filter((item) => item.alignmentState === 'aligned_bearish').length;
  steps.push({
    step: step++,
    phase: 'Inter-timeframe alignment',
    insight: `${bullishAlign} bullish alignments, ${bearishAlign} bearish alignments, ${input.conflicts.length} conflicts detected across adjacent frames.`,
    practitionerNote: 'Professional traders weight alignment between adjacent timeframes more than any single candle pattern.',
  });

  if (input.conflicts[0]) {
    steps.push({
      step: step++,
      phase: 'Conflict resolution',
      insight: input.conflicts[0].description,
      practitionerNote: input.conflicts[0].recommendedResolution,
    });
  }

  steps.push({
    step: step++,
    phase: 'Controlling timeframe',
    insight: `${input.controlling} is the dominant visual controller for ${input.symbol} with ${input.finalBias}.`,
    practitionerNote: 'When weekly/daily disagree with intraday, institutions let the higher timeframe veto execution.',
  });

  steps.push({
    step: step++,
    phase: 'Lower-timeframe confirmation',
    insight: input.lowerConfirmation,
    practitionerNote: 'Entry timing belongs to H1/M15; direction belongs to W/D/H4.',
  });

  steps.push({
    step: step++,
    phase: 'Final institutional decision',
    insight: `Decision: ${input.finalDecision} at ${Math.round(input.confidence * 100)}% confidence${input.scalpOnly ? ' (scalp-only posture)' : ''}.`,
    practitionerNote: recommendationForDecision(input.finalDecision, input.scalpOnly),
  });

  return steps;
}

function tfWeightNote(tf: TopDownTimeframe): string {
  if (tf === 'W' || tf === 'D') return 'Weekly and daily charts define where banks and funds defend inventory; visual shifts here override intraday noise.';
  if (tf === 'H4') return 'H4 is the institutional swing frame: displacement, order-block formation, and liquidity engineering are judged here.';
  if (tf === 'H1') return 'H1 confirms whether higher-timeframe narrative is being accepted or rejected by active session flow.';
  return 'M15 is the execution frame: professionals use it for precise entry, stop placement, and manipulation detection after HTF approval.';
}

function recommendationForDecision(decision: TopDownComparisonDecision['finalDecision'], scalpOnly: boolean): string {
  if (decision === 'BUY opportunity' || decision === 'BUY') {
    return scalpOnly
      ? 'Tactical long only: require M15 bullish reclaim with tight stop under last swept low.'
      : 'Institutional long bias: wait for H1/M15 mitigation or BOS retest before sizing risk.';
  }
  if (decision === 'SELL opportunity' || decision === 'SELL') {
    return scalpOnly
      ? 'Tactical short only: require M15 bearish reclaim with tight stop above last swept high.'
      : 'Institutional short bias: wait for H1/M15 mitigation or BOS retest before sizing risk.';
  }
  if (decision === 'AVOID') return 'Stand down: conflicting visual deltas across the ladder invalidate professional risk/reward.';
  return 'No execution: monitor for W/D bias agreement and H4 displacement before re-engaging.';
}

function resultFor(results: TopDownTimeframeResult[], tf: TopDownTimeframe) {
  return results.find((item) => item.timeframe === tf) ?? null;
}

function weightedBias(results: TopDownTimeframeResult[], target: 'bullish' | 'bearish') {
  return results.reduce((sum, item) => {
    if (!item.ready || item.bias !== target) return sum;
    return sum + timeframeWeights[item.timeframe] * clamp(item.changeScore / 100, 0.15, 1);
  }, 0);
}

function controllingTimeframe(results: TopDownTimeframeResult[]): TopDownTimeframe | 'none' {
  for (const tf of ['W', 'D', 'H4', 'H1', 'M15'] as TopDownTimeframe[]) {
    const item = resultFor(results, tf);
    if (item?.ready && item.bias !== 'neutral' && item.changeScore > 12) return tf;
  }
  const ready = results.find((item) => item.ready && item.changeScore > 8);
  return ready?.timeframe ?? 'none';
}

function alignmentScore(left: string, right: string, leftChange: number, rightChange: number) {
  if (left === right && left !== 'neutral') return clamp(0.62 + Math.min(leftChange, rightChange) / 200, 0.62, 0.96);
  if (left === 'neutral' || right === 'neutral') return 0.38;
  return clamp(0.18 + Math.abs(leftChange - rightChange) / 300, 0.12, 0.42);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
