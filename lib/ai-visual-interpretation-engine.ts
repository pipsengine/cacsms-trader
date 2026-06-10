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
  reasoningTimeline: Array<{ stage: string; summary: string; score: number; practitionerNote?: string }>;
  components: InterpretationComponentInput[];
  decisionBreakdown: Record<string, number | string | boolean>;
  trapRiskScore: number;
  signalEntropy: number;
  algorithmStack: string[];
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
  const activeComponents = components.filter((item) => item.confidence > 0.08);
  const weighted = components.reduce((sum, component) => sum + component.score * component.confidence * component.weight, 0);
  const weightSum = components.reduce((sum, component) => sum + component.weight, 0) || 1;
  const confidenceScore = clamp((weighted / weightSum) * 100, 0, 100);
  const bullScore = directionalScore(components, 'bullish');
  const bearScore = directionalScore(components, 'bearish');
  const neutralScore = directionalScore(components, 'neutral') + directionalScore(components, 'mixed') * 0.5;
  const dominantBias = resolveBias(bullScore, bearScore, neutralScore);
  const trapRiskScore = computeTrapRiskScore(components);
  const signalEntropy = computeSignalEntropy(components);
  const conflict = conflictPenalty(components);
  const institutionalBehavior = inferInstitutionalBehavior(components, dominantBias);
  const decision = resolveDecision(dominantBias, confidenceScore, components, trapRiskScore, signalEntropy);
  const setupQualityScore = clamp((confidenceScore * 0.58) + (Math.abs(bullScore - bearScore) * 34) + ((100 - trapRiskScore) * 0.08), 0, 100);
  const marketClarityScore = clamp((confidenceScore * 0.68) + (100 - conflict) + (100 - signalEntropy) * 0.12, 0, 100);
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
    reasoningTimeline: buildReasoningTimeline({
      symbol: input.symbol,
      timeframe: input.timeframe,
      components: activeComponents,
      strongest,
      institutionalNarrative,
      decision,
      confidenceScore,
      setupQualityScore,
      trapRiskScore,
      signalEntropy,
      rankedScore: rankedStructures[0]?.score ?? 0,
      liquidityScore: Math.round((liquidity?.score ?? 0) * 100),
    }),
    components,
    decisionBreakdown: {
      bullishScore: Math.round(bullScore * 100),
      bearishScore: Math.round(bearScore * 100),
      neutralScore: Math.round(neutralScore * 100),
      conflictPenalty: Math.round(conflict),
      trapRiskScore: Math.round(trapRiskScore),
      signalEntropy: Math.round(signalEntropy),
      activeComponents: activeComponents.length,
      marketStructureWeight: weights.marketStructure,
      liquidityWeight: weights.liquidityContext,
      orderBlockWeight: weights.orderBlockQuality,
      supportResistanceWeight: weights.supportResistanceReaction,
      candleWeight: weights.candleBehaviour,
      patternWeight: weights.patternContext,
      multiTimeframeWeight: weights.multiTimeframeAlignment,
      imageUrl: input.imageUrl ?? '',
    },
    trapRiskScore: Math.round(trapRiskScore),
    signalEntropy: Math.round(signalEntropy),
    algorithmStack: [
      'Bayesian-weighted multi-signal fusion',
      'Structure-liquidity-order-block cross-validation',
      'Trap-risk and signal-entropy gating',
      'Multi-timeframe institutional veto matrix',
      'Professional execution invalidation mapping',
    ],
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

function resolveDecision(
  bias: InterpretationBias,
  confidence: number,
  components: InterpretationComponentInput[],
  trapRiskScore: number,
  signalEntropy: number,
): VisionDecision {
  const mtf = componentByName(components, 'Multi-timeframe alignment');
  const structure = componentByName(components, 'Market structure');
  const mtfText = `${mtf?.summary ?? ''} ${mtf?.evidence.join(' ') ?? ''}`.toLowerCase();
  const contradicts = mtfText.includes('contradict') || mtfText.includes('conflict') || mtfText.includes('avoid');
  if (confidence < 34 || signalEntropy > 72) return 'AVOID';
  if (confidence < 52 || bias === 'mixed' || bias === 'neutral') return 'WAIT';
  if (trapRiskScore > 68 && confidence < 78) return 'WAIT';
  if (contradicts && confidence < 74) return 'WAIT';
  if ((structure?.confidence ?? 0) < 0.28 && confidence < 66) return 'WAIT';
  if (trapRiskScore > 55 && confidence < 64) return 'WAIT';
  return bias === 'bullish' ? 'BUY' : 'SELL';
}

function computeTrapRiskScore(components: InterpretationComponentInput[]): number {
  const liquidity = componentByName(components, 'Liquidity context');
  const structure = componentByName(components, 'Market structure');
  const text = `${liquidity?.summary ?? ''} ${liquidity?.evidence.join(' ') ?? ''} ${structure?.summary ?? ''}`.toLowerCase();
  let score = 18;
  if (text.includes('trap')) score += 28;
  if (text.includes('sweep') || text.includes('stop')) score += 22;
  if (text.includes('manipulation')) score += 18;
  if (text.includes('false break')) score += 16;
  if (text.includes('range') || text.includes('consolid')) score += 10;
  const trapProb = Number(liquidity?.evidence.find((item) => item.includes('trap probability'))?.match(/(\d+)%/)?.[1] ?? 0);
  score += trapProb * 0.35;
  return clamp(score, 0, 100);
}

function computeSignalEntropy(components: InterpretationComponentInput[]): number {
  const active = components.filter((item) => item.confidence > 0.2);
  if (active.length < 2) return 0;
  const bullish = active.filter((item) => item.bias === 'bullish').length;
  const bearish = active.filter((item) => item.bias === 'bearish').length;
  const mixed = active.filter((item) => item.bias === 'mixed' || item.bias === 'neutral').length;
  const disagreement = Math.min(bullish, bearish) * 24 + mixed * 8;
  const variance = active.reduce((sum, item) => sum + Math.abs(item.score - 0.5), 0) / active.length;
  return clamp(disagreement + variance * 42, 0, 100);
}

function buildReasoningTimeline(input: {
  symbol: string;
  timeframe: string;
  components: InterpretationComponentInput[];
  strongest: string;
  institutionalNarrative: string;
  decision: VisionDecision;
  confidenceScore: number;
  setupQualityScore: number;
  trapRiskScore: number;
  signalEntropy: number;
  rankedScore: number;
  liquidityScore: number;
}) {
  return [
    {
      stage: 'Signal inventory',
      summary: `${input.components.length} active visual signals fused for ${input.symbol} ${input.timeframe}.`,
      score: Math.round(input.confidenceScore),
      practitionerNote: 'Institutional desks require structure, liquidity, order-block, and MTF agreement before sizing risk.',
    },
    {
      stage: 'Structure ranking',
      summary: input.strongest,
      score: input.rankedScore,
      practitionerNote: 'Rank evidence by confidence × weight; displacement and MSS/BOS context outrank isolated candle patterns.',
    },
    {
      stage: 'Liquidity & trap scan',
      summary: `Trap-risk score ${Math.round(input.trapRiskScore)} with liquidity score ${input.liquidityScore}.`,
      score: Math.max(0, 100 - Math.round(input.trapRiskScore)),
      practitionerNote: 'Sweep-and-reject or stop-pool raids often precede institutional repricing; avoid chasing obvious breakouts.',
    },
    {
      stage: 'Signal entropy check',
      summary: `Cross-signal disagreement entropy is ${Math.round(input.signalEntropy)}; lower is better for execution.`,
      score: Math.max(0, 100 - Math.round(input.signalEntropy)),
      practitionerNote: 'When bullish and bearish modules disagree, professionals downgrade to WAIT until alignment returns.',
    },
    {
      stage: 'Institutional behaviour read',
      summary: input.institutionalNarrative,
      score: input.liquidityScore,
      practitionerNote: 'Accumulation, distribution, and liquidity engineering are inferred from structure + zone reactions.',
    },
    {
      stage: 'Multi-timeframe veto',
      summary: componentSummary(input.components, 'Multi-timeframe alignment'),
      score: Math.round((componentByName(input.components, 'Multi-timeframe alignment')?.score ?? 0) * 100),
      practitionerNote: 'Higher timeframe control can veto lower timeframe triggers; scalp-only when W/D disagree with H4/H1/M15.',
    },
    {
      stage: 'Decision synthesis',
      summary: `${input.decision} selected after Bayesian fusion, trap gating, and institutional veto checks.`,
      score: Math.round(input.setupQualityScore),
      practitionerNote: 'BUY/SELL requires confidence, low entropy, and acceptable trap risk; otherwise WAIT or AVOID.',
    },
  ];
}

function componentSummary(components: InterpretationComponentInput[], name: string) {
  const component = componentByName(components, name);
  return component?.summary ?? `${name} is not yet available for this capture.`;
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
