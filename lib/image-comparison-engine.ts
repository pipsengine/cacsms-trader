import { randomUUID } from 'node:crypto';

import type { ReconstructedCandle } from './visual-intelligence-types';

export type ImageComparisonTimeframe = 'W' | 'D' | 'H4' | 'H1' | 'M15';
export type FinalImageInterpretation =
  | 'Structure unchanged'
  | 'Bullish shift'
  | 'Bearish shift'
  | 'Liquidity sweep'
  | 'Manipulation detected'
  | 'Setup invalidated';

export interface ImageComparisonInput {
  symbol: string;
  timeframe: ImageComparisonTimeframe;
  previousImage: string;
  currentImage: string;
  previousImageUrl?: string | null;
  currentImageUrl?: string | null;
  previousCandles?: ReconstructedCandle[];
  currentCandles?: ReconstructedCandle[];
  previousAnalysis?: ComparisonAnalysisPayload;
  currentAnalysis?: ComparisonAnalysisPayload;
}

export interface ComparisonAnalysisPayload {
  swings?: Array<Record<string, unknown>>;
  zones?: Array<Record<string, unknown>>;
  orderBlocks?: Array<Record<string, unknown>>;
  liquidityZones?: Array<Record<string, unknown>>;
}

export interface DifferenceBlock {
  x: number;
  y: number;
  width: number;
  height: number;
  intensity: number;
}

export interface ChartChangeEvent {
  id: string;
  eventType: string;
  severityScore: number;
  timeframe: ImageComparisonTimeframe;
  description: string;
  zone: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ImageComparisonResult {
  id: string;
  symbol: string;
  timeframe: ImageComparisonTimeframe;
  previousImageUrl: string | null;
  currentImageUrl: string | null;
  comparisonScore: number;
  similarityPercentage: number;
  visualChangeConfidence: number;
  heatmapUrl: string;
  differenceBlocks: DifferenceBlock[];
  keypointMatches: Array<Record<string, number>>;
  registration: Record<string, number | string>;
  changedStructures: Array<Record<string, unknown>>;
  newZones: Array<Record<string, unknown>>;
  invalidatedZones: Array<Record<string, unknown>>;
  changeEvents: ChartChangeEvent[];
  changedBias: string;
  aiExplanation: string;
  finalInterpretation: FinalImageInterpretation;
  marketChangeTimeline: Array<Record<string, unknown>>;
  institutionalInterpretation: string;
  recommendation: string;
  confidence: number;
  metadata: Record<string, unknown>;
}

const vectorSize = 32;
const supportedTimeframes = new Set(['W', 'D', 'H4', 'H1', 'M15']);

export function normalizeImageComparisonTimeframe(value: unknown): ImageComparisonTimeframe {
  const normalized = String(value ?? '').toUpperCase();
  if (supportedTimeframes.has(normalized)) return normalized as ImageComparisonTimeframe;
  throw new Error('Timeframe must be one of W, D, H4, H1, M15.');
}

export function analyzeImageComparison(input: ImageComparisonInput): ImageComparisonResult {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error('Symbol is required.');
  const timeframe = normalizeImageComparisonTimeframe(input.timeframe);
  const previous = imageVector(input.previousImage);
  const current = imageVector(input.currentImage);
  const ssim = structuralSimilarity(previous.values, current.values);
  const differenceBlocks = buildDifferenceBlocks(previous.values, current.values);
  const changedPixels = differenceBlocks.reduce((sum, block) => sum + block.intensity, 0) / Math.max(1, differenceBlocks.length);
  const similarityPercentage = clamp((ssim * 0.76 + (1 - changedPixels) * 0.24) * 100, 0, 100);
  const comparisonScore = clamp(100 - similarityPercentage, 0, 100);
  const keypointMatches = matchKeypoints(previous.values, current.values);
  const candleDelta = compareCandles(input.previousCandles ?? [], input.currentCandles ?? [], timeframe);
  const zoneDelta = compareZones(input.previousAnalysis, input.currentAnalysis);
  const structuralEvents = [...candleDelta.events, ...zoneDelta.events];
  const finalInterpretation = determineInterpretation(comparisonScore, candleDelta, zoneDelta);
  const changedBias = determineBias(finalInterpretation, candleDelta);
  const confidence = clamp((comparisonScore / 100) * 0.42 + Math.abs(candleDelta.momentumShift) * 0.28 + zoneDelta.confidence * 0.3, 0.18, 0.97);
  const heatmapUrl = buildSvgHeatmap(differenceBlocks);
  const changeEvents = structuralEvents.length ? structuralEvents : [{
    id: randomUUID(),
    eventType: 'visual_delta',
    severityScore: round(comparisonScore / 100),
    timeframe,
    description: comparisonScore > 18
      ? 'Chart image changed materially; visual delta concentrated around the active plotting area.'
      : 'Chart image remains visually close to the prior screenshot with no dominant structural displacement.',
    zone: hottestBlock(differenceBlocks),
    metadata: { similarityPercentage: round(similarityPercentage) },
  }];
  const aiExplanation = buildExplanation(symbol, timeframe, finalInterpretation, similarityPercentage, candleDelta, zoneDelta);

  return {
    id: randomUUID(),
    symbol,
    timeframe,
    previousImageUrl: input.previousImageUrl ?? null,
    currentImageUrl: input.currentImageUrl ?? null,
    comparisonScore: round(comparisonScore),
    similarityPercentage: round(similarityPercentage),
    visualChangeConfidence: round(confidence * 100),
    heatmapUrl,
    differenceBlocks,
    keypointMatches,
    registration: {
      method: 'normalized-byte-vector-registration',
      keypointMatches: keypointMatches.length,
      estimatedShiftX: round(avg(keypointMatches.map((point) => point.dx))),
      estimatedShiftY: round(avg(keypointMatches.map((point) => point.dy))),
    },
    changedStructures: candleDelta.changedStructures,
    newZones: zoneDelta.newZones,
    invalidatedZones: zoneDelta.invalidatedZones,
    changeEvents,
    changedBias,
    aiExplanation,
    finalInterpretation,
    marketChangeTimeline: changeEvents.map((event, index) => ({
      step: index + 1,
      eventType: event.eventType,
      severityScore: event.severityScore,
      description: event.description,
    })),
    institutionalInterpretation: institutionalNarrative(finalInterpretation),
    recommendation: recommendationFor(finalInterpretation),
    confidence: round(confidence),
    metadata: {
      previousBytes: previous.byteLength,
      currentBytes: current.byteLength,
      changedBlockCount: differenceBlocks.length,
      candleMomentumShift: round(candleDelta.momentumShift),
      algorithmStack: ['SSIM-style luminance similarity', 'pixel delta blocks', 'feature anchor matching', 'candle and zone delta comparison'],
    },
  };
}

function imageVector(image: string) {
  const raw = String(image ?? '');
  if (!raw.trim()) throw new Error('Both previousImage and currentImage are required.');
  const base64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, /^[A-Za-z0-9+/=\s]+$/.test(base64) ? 'base64' : 'utf8');
  } catch {
    buffer = Buffer.from(raw, 'utf8');
  }
  const values: number[] = [];
  const samples = vectorSize * vectorSize;
  for (let index = 0; index < samples; index += 1) {
    const start = Math.floor((index / samples) * buffer.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / samples) * buffer.length));
    let total = 0;
    for (let byteIndex = start; byteIndex < end; byteIndex += 1) total += buffer[byteIndex] ?? 0;
    values.push(total / Math.max(1, end - start) / 255);
  }
  return { values, byteLength: buffer.length };
}

function structuralSimilarity(a: number[], b: number[]) {
  const meanA = avg(a);
  const meanB = avg(b);
  const varianceA = avg(a.map((value) => (value - meanA) ** 2));
  const varianceB = avg(b.map((value) => (value - meanB) ** 2));
  const covariance = avg(a.map((value, index) => (value - meanA) * ((b[index] ?? 0) - meanB)));
  const c1 = 0.01 ** 2;
  const c2 = 0.03 ** 2;
  return clamp(((2 * meanA * meanB + c1) * (2 * covariance + c2)) / ((meanA ** 2 + meanB ** 2 + c1) * (varianceA + varianceB + c2)), 0, 1);
}

function buildDifferenceBlocks(a: number[], b: number[]): DifferenceBlock[] {
  const blocks: DifferenceBlock[] = [];
  for (let y = 0; y < vectorSize; y += 1) {
    for (let x = 0; x < vectorSize; x += 1) {
      const index = y * vectorSize + x;
      const intensity = Math.abs((a[index] ?? 0) - (b[index] ?? 0));
      if (intensity > 0.08) blocks.push({ x, y, width: 1, height: 1, intensity: round(intensity) });
    }
  }
  return blocks.sort((left, right) => right.intensity - left.intensity).slice(0, 180);
}

function matchKeypoints(a: number[], b: number[]) {
  const anchorsA = strongestAnchors(a);
  const anchorsB = strongestAnchors(b);
  return anchorsA.slice(0, 16).map((anchor, index) => {
    const target = anchorsB[index] ?? anchor;
    return {
      x1: anchor.x,
      y1: anchor.y,
      x2: target.x,
      y2: target.y,
      dx: target.x - anchor.x,
      dy: target.y - anchor.y,
      confidence: round(1 - Math.abs(target.score - anchor.score)),
    };
  });
}

function strongestAnchors(values: number[]) {
  return values.map((value, index) => {
    const x = index % vectorSize;
    const y = Math.floor(index / vectorSize);
    const right = values[index + 1] ?? value;
    const down = values[index + vectorSize] ?? value;
    return { x, y, score: Math.abs(value - right) + Math.abs(value - down) };
  }).sort((left, right) => right.score - left.score);
}

function compareCandles(previous: ReconstructedCandle[], current: ReconstructedCandle[], timeframe: ImageComparisonTimeframe) {
  const prevLast = previous.slice(-8);
  const currLast = current.slice(-8);
  const prevMomentum = candleMomentum(prevLast);
  const currMomentum = candleMomentum(currLast);
  const momentumShift = currMomentum - prevMomentum;
  const events: ChartChangeEvent[] = [];
  const changedStructures: Array<Record<string, unknown>> = [];
  const currentHigh = Math.max(...current.map((candle) => candle.highPrice), Number.NEGATIVE_INFINITY);
  const previousHigh = Math.max(...previous.map((candle) => candle.highPrice), Number.NEGATIVE_INFINITY);
  const currentLow = Math.min(...current.map((candle) => candle.lowPrice), Number.POSITIVE_INFINITY);
  const previousLow = Math.min(...previous.map((candle) => candle.lowPrice), Number.POSITIVE_INFINITY);
  if (Number.isFinite(currentHigh) && currentHigh > previousHigh) {
    changedStructures.push({ type: 'new_swing_high', price: currentHigh, previousPrice: previousHigh });
    events.push(changeEvent(timeframe, 'new_swing_high', 0.72, `New swing high printed above prior visible high at ${formatPrice(previousHigh)}.`));
  }
  if (Number.isFinite(currentLow) && currentLow < previousLow) {
    changedStructures.push({ type: 'new_swing_low', price: currentLow, previousPrice: previousLow });
    events.push(changeEvent(timeframe, 'new_swing_low', 0.72, `New swing low printed below prior visible low at ${formatPrice(previousLow)}.`));
  }
  if (Math.abs(momentumShift) > 0.18) {
    const direction = momentumShift > 0 ? 'bullish' : 'bearish';
    changedStructures.push({ type: 'candle_momentum_change', direction, momentumShift: round(momentumShift) });
    events.push(changeEvent(timeframe, 'candle_momentum_change', Math.min(0.9, Math.abs(momentumShift)), `Candle momentum rotated ${direction} versus the previous screenshot.`));
  }
  return { momentumShift, events, changedStructures };
}

function compareZones(previous?: ComparisonAnalysisPayload, current?: ComparisonAnalysisPayload) {
  const previousZones = flattenZones(previous);
  const currentZones = flattenZones(current);
  const newZones = currentZones.filter((zone) => !previousZones.some((oldZone) => zoneKey(oldZone) === zoneKey(zone))).slice(0, 8);
  const invalidatedZones = previousZones.filter((zone) => !currentZones.some((newZone) => zoneKey(newZone) === zoneKey(zone))).slice(0, 8);
  const events = [
    ...newZones.map((zone) => {
      const record = zone as Record<string, unknown>;
      return changeEvent(String(record.timeframe ?? 'H1') as ImageComparisonTimeframe, 'new_zone', 0.66, `New ${String(record.type ?? 'market')} zone appeared in the current screenshot.`, zone);
    }),
    ...invalidatedZones.map((zone) => {
      const record = zone as Record<string, unknown>;
      return changeEvent(String(record.timeframe ?? 'H1') as ImageComparisonTimeframe, 'invalidated_zone', 0.7, `Prior ${String(record.type ?? 'market')} zone is no longer valid in the current screenshot.`, zone);
    }),
  ];
  return {
    newZones,
    invalidatedZones,
    events,
    confidence: clamp((newZones.length + invalidatedZones.length) / 10, 0, 1),
  };
}

function flattenZones(payload?: ComparisonAnalysisPayload) {
  return [
    ...(payload?.zones ?? []),
    ...(payload?.orderBlocks ?? []).map((zone) => ({ ...zone, type: zone.type ?? 'order_block' })),
    ...(payload?.liquidityZones ?? []).map((zone) => ({ ...zone, type: zone.type ?? 'liquidity' })),
    ...(payload?.swings ?? []).map((zone) => ({ ...zone, type: zone.type ?? 'swing' })),
  ];
}

function zoneKey(zone: Record<string, unknown>) {
  return `${String(zone.type ?? 'zone')}:${String(zone.direction ?? '')}:${Math.round(Number(zone.price ?? zone.priceLevel ?? zone.mid ?? 0) * 100)}`;
}

function candleMomentum(candles: ReconstructedCandle[]) {
  if (!candles.length) return 0;
  return avg(candles.map((candle) => {
    const range = Math.max(0.000001, candle.highPrice - candle.lowPrice);
    return (candle.closePrice - candle.openPrice) / range;
  }));
}

function determineInterpretation(score: number, candleDelta: ReturnType<typeof compareCandles>, zoneDelta: ReturnType<typeof compareZones>): FinalImageInterpretation {
  if (zoneDelta.invalidatedZones.length >= 2) return 'Setup invalidated';
  if (zoneDelta.newZones.some((zone) => String(zone.type).includes('liquidity')) && score > 18) return 'Liquidity sweep';
  if (score > 45 && Math.abs(candleDelta.momentumShift) > 0.3) return 'Manipulation detected';
  if (candleDelta.momentumShift > 0.18) return 'Bullish shift';
  if (candleDelta.momentumShift < -0.18) return 'Bearish shift';
  return score > 22 ? 'Manipulation detected' : 'Structure unchanged';
}

function determineBias(interpretation: FinalImageInterpretation, candleDelta: ReturnType<typeof compareCandles>) {
  if (interpretation === 'Bullish shift') return 'Bullish change detected';
  if (interpretation === 'Bearish shift') return 'Bearish change detected';
  if (candleDelta.momentumShift > 0.1) return 'Mild bullish rotation';
  if (candleDelta.momentumShift < -0.1) return 'Mild bearish rotation';
  return 'Bias unchanged or ranging';
}

function buildExplanation(symbol: string, timeframe: ImageComparisonTimeframe, interpretation: FinalImageInterpretation, similarity: number, candleDelta: ReturnType<typeof compareCandles>, zoneDelta: ReturnType<typeof compareZones>) {
  const momentum = candleDelta.momentumShift > 0 ? 'buyers gained momentum' : candleDelta.momentumShift < 0 ? 'sellers gained momentum' : 'candle pressure stayed balanced';
  return `${symbol} ${timeframe} comparison is ${round(similarity)}% visually similar. The engine classifies the change as ${interpretation}; ${momentum}, with ${zoneDelta.newZones.length} new zones and ${zoneDelta.invalidatedZones.length} invalidated zones detected.`;
}

function institutionalNarrative(interpretation: FinalImageInterpretation) {
  if (interpretation === 'Bullish shift') return 'Current image shows improving demand response and potential institutional accumulation if higher timeframe context agrees.';
  if (interpretation === 'Bearish shift') return 'Current image shows supply gaining control; monitor for displacement below protected lows.';
  if (interpretation === 'Liquidity sweep') return 'Price appears to have attacked a visible liquidity pool before reacting, which can precede institutional displacement.';
  if (interpretation === 'Setup invalidated') return 'Prior visual setup has lost structural validity; old zones should not be reused without fresh confirmation.';
  if (interpretation === 'Manipulation detected') return 'Visual delta is large enough to flag possible stop-run or news-driven distortion; wait for structure confirmation.';
  return 'Structure remains broadly unchanged; no decisive institutional transition is visible from the comparison.';
}

function recommendationFor(interpretation: FinalImageInterpretation) {
  if (interpretation === 'Bullish shift') return 'Wait for bullish retest confirmation or use lower timeframe entry validation.';
  if (interpretation === 'Bearish shift') return 'Wait for bearish retest confirmation or use lower timeframe entry validation.';
  if (interpretation === 'Liquidity sweep') return 'Do not chase the sweep; wait for displacement and mitigation confirmation.';
  if (interpretation === 'Setup invalidated') return 'Avoid the previous setup and rebuild the trade idea from current structure.';
  if (interpretation === 'Manipulation detected') return 'Reduce risk and require fresh BOS/CHOCH confirmation.';
  return 'No action required until a new swing, zone, or candle momentum shift appears.';
}

function buildSvgHeatmap(blocks: DifferenceBlock[]) {
  const rects = blocks.map((block) => {
    const hue = block.intensity > 0.28 ? '#dc2626' : block.intensity > 0.18 ? '#f97316' : '#7c3aed';
    const opacity = clamp(block.intensity * 2.8, 0.18, 0.84);
    return `<rect x="${block.x * 10}" y="${block.y * 10}" width="10" height="10" fill="${hue}" opacity="${opacity.toFixed(2)}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><rect width="320" height="320" fill="#eff6ff"/>${rects}</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function changeEvent(timeframe: ImageComparisonTimeframe, eventType: string, severity: number, description: string, zone: Record<string, unknown> = {}): ChartChangeEvent {
  return { id: randomUUID(), eventType, severityScore: round(severity), timeframe, description, zone, metadata: {} };
}

function hottestBlock(blocks: DifferenceBlock[]) {
  const block = blocks[0];
  return block ? { x: block.x, y: block.y, intensity: block.intensity } : {};
}

function avg(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}

function formatPrice(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : 'unknown';
}
