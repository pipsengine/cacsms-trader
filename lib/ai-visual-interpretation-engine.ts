import type { VisionDecision } from './visual-intelligence-types';

export type InterpretationBias = 'bullish' | 'bearish' | 'neutral' | 'mixed';
export type InstitutionalBehavior = 'accumulating' | 'distributing' | 'sweeping liquidity' | 'expanding price' | 'waiting';

export interface InterpretationComponentInput {
  name: string;
  weight: number;
  bias: InterpretationBias;
  score: number;
  confidence: number;
  summary: string;
  evidence: string[];
}

export interface AiVisualInterpretationResult {
  title: string;
  fullExplanation: string;
  dominantBias: InterpretationBias;
  institutionalBehavior: InstitutionalBehavior;
  institutionalNarrative: string;
  retailTrapWarning: string;
  liquidityNarrative: string;
  marketStructureNarrative: string;
  confidenceScore: number;
  marketClarityScore: number;
  setupQualityScore: number;
  decision: VisionDecision;
  entryLogic: string;
  invalidationLogic: string;
  riskWarning: string;
  dominantStory: string;
  higherTimeframeContext: string;
  rankedStructures: Array<{ label: string; score: number; narrative: string }>;
  reasoningTimeline: Array<{ stage: string; summary: string; score: number }>;
  components: InterpretationComponentInput[];
  decisionBreakdown: Record<string, number | string | boolean>;
}

const weights = {
  marketStructure: 0.25,
  liquidityContext: 0.2,
  orderBlockQuality: 0.15,
  supportResistanceReaction: 0.1,
  candleBehaviour: 0.1,
  patternContext: 0.1,
  multiTimeframeAlignment: 0.1,
};

export function buildVisualInterpretation(input: {
  symbol: string;
  timeframe: string;
  captureId: string;
  imageUrl?: string | null;
  components: InterpretationComponentInput[];
}): AiVisualInterpretationResult {
  const components = normalizeComponents(input.components);
  const weighted = components.reduce((sum, component) => sum + component.score * component.weight, 0);
  const confidenceScore = clamp(weighted * 100, 0, 100);
  const bullScore = directionalScore(components, 'bullish');
  const bearScore = directionalScore(components, 'bearish');
  const neutralScore = directionalScore(components, 'neutral') + directionalScore(components, 'mixed') * 0.5;
  const dominantBias = resolveBias(bullScore, bearScore, neutralScore);
  const institutionalBehavior = inferInstitutionalBehavior(components, dominantBias);
  const decision = resolveDecision(dominantBias, confidenceScore, components);
  const setupQualityScore = clamp((confidenceScore * 0.62) + (Math.abs(bullScore - bearScore) * 38), 0, 100);
  const marketClarityScore = clamp((confidenceScore * 0.72) + (100 - conflictPenalty(components)), 0, 100);
  const rankedStructures = components
    .flatMap((component) => component.evidence.map((item) => ({
      label: component.name,
      score: Math.round(component.score * component.confidence * 100),
      narrative: item,
    })))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  const strongest = rankedStructures[0]?.narrative ?? 'The chart has limited confirmed visual evidence, so the analyst should wait for cleaner structure.';
  const higherTimeframe = componentByName(components, 'Multi-timeframe alignment');
  const structure = componentByName(components, 'Market structure');
  const liquidity = componentByName(components, 'Liquidity context');
  const orderBlock = componentByName(components, 'Order block quality');
  const sr = componentByName(components, 'Support/resistance reaction');
  const candle = componentByName(components, 'Candle behaviour');
  const pattern = componentByName(components, 'Pattern context');

  const biasText = dominantBias === 'mixed' ? 'mixed and unresolved' : dominantBias;
  const title = `${input.symbol} ${input.timeframe}: ${decision} while visual bias is ${biasText}`;
  const institutionalNarrative = narrativeForInstitutional(institutionalBehavior, dominantBias, liquidity, orderBlock);
  const retailTrapWarning = narrativeForRetailTrap(liquidity, structure);
  const liquidityNarrative = liquidity?.summary ?? 'Liquidity evidence is not yet strong enough to define a high-quality stop-run narrative.';
  const marketStructureNarrative = structure?.summary ?? 'Market structure is not yet fully mapped for this capture.';
  const higherTimeframeContext = higherTimeframe?.summary ?? 'Higher timeframe context is not available, so the current chart must be treated in isolation.';
  const dominantStory = buildDominantStory(input.symbol, input.timeframe, decision, strongest, institutionalBehavior, higherTimeframeContext);
  const entryLogic = buildEntryLogic(decision, dominantBias, orderBlock, sr, candle);
  const invalidationLogic = buildInvalidationLogic(decision, structure, liquidity, sr);
  const riskWarning = buildRiskWarning(decision, confidenceScore, higherTimeframe, liquidity);

  return {
    title,
    fullExplanation: [
      dominantStory,
      `Structure: ${marketStructureNarrative}`,
      `Liquidity: ${liquidityNarrative}`,
      `Pattern and candle context: ${pattern?.summary ?? 'No dominant pattern context is confirmed.'} ${candle?.summary ?? ''}`.trim(),
      `Decision: ${decision}. ${entryLogic}`,
    ].join('\n\n'),
    dominantBias,
    institutionalBehavior,
    institutionalNarrative,
    retailTrapWarning,
    liquidityNarrative,
    marketStructureNarrative,
    confidenceScore: Math.round(confidenceScore),
    marketClarityScore: Math.round(marketClarityScore),
    setupQualityScore: Math.round(setupQualityScore),
    decision,
    entryLogic,
    invalidationLogic,
    riskWarning,
    dominantStory,
    higherTimeframeContext,
    rankedStructures,
    reasoningTimeline: [
      { stage: 'Signal collection', summary: `Loaded ${components.filter((item) => item.confidence > 0).length} visual-analysis components for this capture.`, score: Math.round(confidenceScore) },
      { stage: 'Structure ranking', summary: strongest, score: rankedStructures[0]?.score ?? 0 },
      { stage: 'Institutional read', summary: institutionalNarrative, score: Math.round((liquidity?.score ?? 0) * 100) },
      { stage: 'Decision synthesis', summary: `${decision} selected from weighted bias, trap risk, and timeframe alignment.`, score: Math.round(setupQualityScore) },
    ],
    components,
    decisionBreakdown: {
      bullishScore: Math.round(bullScore * 100),
      bearishScore: Math.round(bearScore * 100),
      neutralScore: Math.round(neutralScore * 100),
      conflictPenalty: Math.round(conflictPenalty(components)),
      marketStructureWeight: weights.marketStructure,
      liquidityWeight: weights.liquidityContext,
      orderBlockWeight: weights.orderBlockQuality,
      supportResistanceWeight: weights.supportResistanceReaction,
      candleWeight: weights.candleBehaviour,
      patternWeight: weights.patternContext,
      multiTimeframeWeight: weights.multiTimeframeAlignment,
      imageUrl: input.imageUrl ?? '',
    },
  };
}

export function defaultComponents(): InterpretationComponentInput[] {
  return [
    emptyComponent('Market structure', weights.marketStructure),
    emptyComponent('Liquidity context', weights.liquidityContext),
    emptyComponent('Order block quality', weights.orderBlockQuality),
    emptyComponent('Support/resistance reaction', weights.supportResistanceReaction),
    emptyComponent('Candle behaviour', weights.candleBehaviour),
    emptyComponent('Pattern context', weights.patternContext),
    emptyComponent('Multi-timeframe alignment', weights.multiTimeframeAlignment),
  ];
}

function normalizeComponents(components: InterpretationComponentInput[]) {
  const byName = new Map(defaultComponents().map((component) => [component.name, component]));
  for (const component of components) byName.set(component.name, component);
  return Array.from(byName.values()).map((component) => ({
    ...component,
    score: clamp(component.score, 0, 1),
    confidence: clamp(component.confidence, 0, 1),
  }));
}

function emptyComponent(name: string, weight: number): InterpretationComponentInput {
  return {
    name,
    weight,
    bias: 'neutral',
    score: 0,
    confidence: 0,
    summary: `${name} has not produced a confirmed signal yet.`,
    evidence: [],
  };
}

function directionalScore(components: InterpretationComponentInput[], bias: InterpretationBias) {
  return components.reduce((sum, component) => sum + (component.bias === bias ? component.score * component.confidence * component.weight : 0), 0);
}

function resolveBias(bullScore: number, bearScore: number, neutralScore: number): InterpretationBias {
  if (Math.abs(bullScore - bearScore) < 0.045) return neutralScore > 0.05 ? 'mixed' : 'neutral';
  return bullScore > bearScore ? 'bullish' : 'bearish';
}

function inferInstitutionalBehavior(components: InterpretationComponentInput[], bias: InterpretationBias): InstitutionalBehavior {
  const text = components.flatMap((component) => [component.summary, ...component.evidence]).join(' ').toLowerCase();
  if (text.includes('sweep') || text.includes('stop') || text.includes('trap')) return 'sweeping liquidity';
  if (text.includes('expansion') || text.includes('displacement') || text.includes('break')) return 'expanding price';
  if (bias === 'bullish') return 'accumulating';
  if (bias === 'bearish') return 'distributing';
  return 'waiting';
}

function resolveDecision(bias: InterpretationBias, confidence: number, components: InterpretationComponentInput[]): VisionDecision {
  const mtf = componentByName(components, 'Multi-timeframe alignment');
  const trapRisk = componentByName(components, 'Liquidity context')?.evidence.join(' ').toLowerCase().includes('trap');
  if (confidence < 38) return 'AVOID';
  if (confidence < 58 || bias === 'mixed' || bias === 'neutral') return 'WAIT';
  if (mtf?.summary.toLowerCase().includes('contradict') && confidence < 76) return 'WAIT';
  if (trapRisk && confidence < 72) return 'WAIT';
  return bias === 'bullish' ? 'BUY' : 'SELL';
}

function componentByName(components: InterpretationComponentInput[], name: string) {
  return components.find((component) => component.name === name);
}

function conflictPenalty(components: InterpretationComponentInput[]) {
  const bullish = components.filter((component) => component.bias === 'bullish' && component.confidence > 0.35).length;
  const bearish = components.filter((component) => component.bias === 'bearish' && component.confidence > 0.35).length;
  return Math.min(100, Math.min(bullish, bearish) * 18);
}

function narrativeForInstitutional(behavior: InstitutionalBehavior, bias: InterpretationBias, liquidity?: InterpretationComponentInput, orderBlock?: InterpretationComponentInput) {
  const base = {
    accumulating: 'Institutional activity appears accumulation-oriented: price is respecting demand logic while bullish evidence is stronger than bearish evidence.',
    distributing: 'Institutional activity appears distribution-oriented: bearish structure and supply-side reaction are stronger than bullish continuation evidence.',
    'sweeping liquidity': 'Institutional activity is best read as a liquidity sweep environment: obvious stop pools or trap evidence are influencing the current chart.',
    'expanding price': 'Institutional activity appears to be in expansion: displacement and structure movement are more important than range rotation.',
    waiting: 'Institutional activity is not decisive yet; the chart is better treated as a wait condition until stronger displacement or reaction appears.',
  }[behavior];
  return `${base} ${liquidity?.summary ?? ''} ${orderBlock?.summary ?? ''}`.trim() || `Institutional behaviour is ${behavior} with ${bias} bias.`;
}

function narrativeForRetailTrap(liquidity?: InterpretationComponentInput, structure?: InterpretationComponentInput) {
  const text = `${liquidity?.summary ?? ''} ${structure?.summary ?? ''}`.toLowerCase();
  if (text.includes('trap') || text.includes('sweep') || text.includes('manipulation')) {
    return 'Retail trap risk is elevated. The chart shows signs that obvious liquidity may have been used to trigger late breakout or reversal participants before repricing.';
  }
  if (text.includes('range') || text.includes('consolid')) {
    return 'Retail trap risk is moderate because range conditions can create false breaks on both sides.';
  }
  return 'Retail trap risk is contained, but execution still requires confirmation at the reaction level.';
}

function buildDominantStory(symbol: string, timeframe: string, decision: VisionDecision, strongest: string, behavior: InstitutionalBehavior, mtf: string) {
  return `${symbol} on ${timeframe} is showing a ${behavior} narrative. ${strongest} Higher timeframe context: ${mtf} The resulting professional stance is ${decision}.`;
}

function buildEntryLogic(decision: VisionDecision, bias: InterpretationBias, orderBlock?: InterpretationComponentInput, sr?: InterpretationComponentInput, candle?: InterpretationComponentInput) {
  if (decision === 'BUY') return `Buy logic requires price to hold the relevant demand/order-block area and print bullish displacement confirmation. ${orderBlock?.summary ?? ''} ${sr?.summary ?? ''}`.trim();
  if (decision === 'SELL') return `Sell logic requires price to reject supply or a broken support retest and print bearish displacement confirmation. ${orderBlock?.summary ?? ''} ${sr?.summary ?? ''}`.trim();
  if (decision === 'WAIT') return `Wait for confirmation because the current ${bias} read is not clean enough for immediate execution. ${candle?.summary ?? ''}`.trim();
  return 'Avoid execution until fresh capture data produces clearer structure, liquidity context, and multi-timeframe alignment.';
}

function buildInvalidationLogic(decision: VisionDecision, structure?: InterpretationComponentInput, liquidity?: InterpretationComponentInput, sr?: InterpretationComponentInput) {
  if (decision === 'BUY') return 'The bullish interpretation is invalidated if price breaks below the defended demand/support zone and accepts below the most recent structural low.';
  if (decision === 'SELL') return 'The bearish interpretation is invalidated if price breaks above the defended supply/resistance zone and accepts above the most recent structural high.';
  return `The interpretation changes if fresh structure contradicts the current read. ${structure?.summary ?? liquidity?.summary ?? sr?.summary ?? ''}`.trim();
}

function buildRiskWarning(decision: VisionDecision, confidence: number, mtf?: InterpretationComponentInput, liquidity?: InterpretationComponentInput) {
  if (decision === 'AVOID') return 'Risk is unacceptable because signal clarity is too low. Do not force execution from this chart.';
  if (decision === 'WAIT') return 'Risk remains conditional. Wait for a cleaner reaction, displacement candle, and confirmation from the controlling timeframe.';
  if (confidence < 70) return `Trade risk is elevated because confidence is below institutional execution quality. ${mtf?.summary ?? liquidity?.summary ?? ''}`.trim();
  return 'Risk is acceptable only if execution respects invalidation, spread quality, and the account risk model.';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
