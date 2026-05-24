export type VisionTone =
  | 'navy'
  | 'blue'
  | 'purple'
  | 'emerald'
  | 'orange'
  | 'rose'
  | 'slate';

export type VisionDecision = 'BUY' | 'SELL' | 'WAIT' | 'AVOID';

export interface VisionCandleInput {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp?: string;
  volume?: number;
  pixelX?: number;
  pixelYOpen?: number;
  pixelYHigh?: number;
  pixelYLow?: number;
  pixelYClose?: number;
  confidence?: number;
}

export interface ChartCaptureRequest {
  symbol?: string;
  timeframe?: string;
  sourcePlatform?: string;
  imageUrl?: string;
  imageBase64?: string;
  captureType?: string;
  jobType?: string;
  metadata?: Record<string, unknown>;
  candles?: VisionCandleInput[];
}

export interface ChartCaptureRecord {
  id: string;
  symbol: string;
  timeframe: string;
  sourcePlatform: string;
  imageUrl: string;
  imageHash: string;
  captureType: string;
  capturedAt: string;
  processingStatus: string;
  metadata: Record<string, unknown>;
}

export interface VisionJobRecord {
  id: string;
  chartCaptureId: string;
  jobType: string;
  status: string;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  modelVersion: string;
  processingTimeMs: number | null;
}

export interface ReconstructedCandle {
  id?: string;
  chartCaptureId?: string;
  candleIndex: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  pixelX: number;
  pixelYOpen: number;
  pixelYHigh: number;
  pixelYLow: number;
  pixelYClose: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
}

export interface VisionDetection {
  id?: string;
  chartCaptureId?: string;
  detectionType: string;
  detectionName: string;
  direction: string | null;
  priceLevel: number | null;
  startTime: string | null;
  endTime: string | null;
  boundingBox: Record<string, unknown>;
  geometry: Record<string, unknown>;
  confidence: number;
  strengthScore: number;
  status: string;
  metadata: Record<string, unknown>;
}

export interface MarketStructureState {
  id?: string;
  symbol: string;
  timeframe: string;
  trendState: string;
  phaseState: string;
  lastBosDirection: string | null;
  lastChochDirection: string | null;
  liquidityBias: string;
  institutionalBias: string;
  retailBias: string;
  confidence: number;
  updatedAt?: string;
}

export interface AiDecisionOutput {
  id?: string;
  chartCaptureId?: string;
  symbol: string;
  timeframe: string;
  decision: VisionDecision;
  bias: string;
  confidence: number;
  entryZone: Record<string, unknown>;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskRewardRatio: number | null;
  invalidationLevel: number | null;
  reasoningText: string;
  riskWarning: string;
  createdAt?: string;
}

export interface ModelConfidenceScore {
  id?: string;
  jobId?: string;
  modelName: string;
  modelVersion: string;
  rawScore: number;
  calibratedScore: number;
  uncertaintyScore: number;
  finalConfidence: number;
}

export interface VisionAnalysisResult {
  capture: ChartCaptureRecord;
  job: VisionJobRecord;
  candles: ReconstructedCandle[];
  detections: VisionDetection[];
  structureState: MarketStructureState;
  decision: AiDecisionOutput;
  confidenceScores: ModelConfidenceScore[];
}
