export type AnalysisMode =
  | 'FULL_ANALYSIS'
  | 'STRUCTURE'
  | 'OPPORTUNITY'
  | 'CONFIRMATION'
  | 'CONTINUATION'
  | 'BREAKOUT'
  | 'REVERSAL';

export type StripTf = 'YTD' | 'Q' | 'MN' | 'W' | 'D1' | 'H8' | 'H1' | 'M15' | 'M5';

export interface TimeframeStripRow {
  timeframe: StripTf;
  direction: string;
  directionShort: string;
  marketState: string;
  structure: string;
  channelState: string;
  supertrend: string;
  priceLocation?: string | null;
  confidence: number;
  lastClosedCandleMs?: number | null;
}

export interface EvidenceItem {
  text: string;
  type?: string;
  timeframe?: string;
  source?: string;
  status?: string;
}

export interface Annotation {
  id: string;
  index?: number;
  type: string;
  label: string;
  timeframe?: string;
  candleTimestamp?: number;
  price?: number;
  source?: string;
  reason?: string;
  thesisRelation?: string;
  status?: string;
}

export interface TradabilityStage {
  stage: string;
  state: string;
  detail?: string;
}

export interface AiChartAnalysisPayload {
  ok: boolean;
  code?: string;
  message?: string;
  symbol: string;
  analysisId: string;
  analysisTimestamp?: string;
  analysisMode?: AnalysisMode;
  primaryTimeframe?: StripTf;
  status?: string;
  direction?: string;
  marketState?: string;
  confidence?: number;
  tradable?: boolean;
  executionAuthorized?: boolean;
  thesis?: string;
  timeframeStrip?: TimeframeStripRow[];
  supportingEvidence?: EvidenceItem[];
  conflictingEvidence?: EvidenceItem[];
  missingEvidence?: EvidenceItem[];
  annotations?: Annotation[];
  tradabilityChain?: TradabilityStage[];
  reconciliation?: {
    aiInterpretation?: string;
    deterministicEngine?: string;
    agreement?: string;
    conflictDetail?: string;
    executionAuthorized?: boolean;
    note?: string;
  };
  chart?: {
    timeframe: string;
    candles: { time: number; open: number; high: number; low: number; close: number; complete?: boolean }[];
    lines?: { time: number; upper: number; lower: number; mid: number }[];
    channelLines?: { time: number; upper: number; lower: number; mid?: number | null }[];
    supertrendSeries?: { time: number; value: number; direction: string }[];
    supertrendTimeframe?: string;
    disclaimer?: string;
  };
  servedFromCache?: boolean;
  refreshReason?: string;
  historicalChart?: AiChartAnalysisPayload['chart'];
  lastClosedCandle?: Record<string, number>;
  marketDataStatus?: string;
  p1State?: string;
  p2State?: string;
  opportunity?: string;
  timelineEvents?: { timestamp: string; kind: string; detail?: string }[];
  thesisTitle?: string;
  evidenceScoreComponents?: Record<string, number>;
  analyticalTradability?: string;
  timeframeStates?: Record<string, unknown>;
  hierarchy?: Array<{
    parent: string;
    child: string;
    relation: string;
    parentDirection?: string;
    childDirection?: string;
  }>;
  regime?: { primary?: string; volatility?: string; note?: string };
  contradictions?: Array<{ text?: string; type?: string; timeframe?: string; severity?: string }>;
  dataQuality?: string;
  opportunityDetail?: Record<string, unknown>;
  modeFocus?: string;
  chartView?: Record<string, unknown>;
  generatedAtMs?: number;
  chartLevels?: {
    invalidation?: number | null;
    t1?: number | null;
    t2?: number | null;
    erzMid?: number | null;
    erzLower?: number | null;
    erzUpper?: number | null;
    supplyUpper?: number | null;
    supplyLower?: number | null;
    p2?: number | null;
  };
  engines?: Array<{ engine: string; summary: string; agreement?: string; highlights?: string[] }>;
  scenarios?: {
    primary?: {
      title?: string;
      kind?: string;
      disclaimer?: string;
      direction?: string;
      status?: string;
      currentState?: string;
      nextExpectedEvent?: string;
      confirmationRequirement?: string;
      invalidation?: string;
      conditions?: string[];
      pathLabels?: string[];
      targetPath?: (number | null)[];
    };
    alternative?: {
      title?: string;
      kind?: string;
      disclaimer?: string;
      direction?: string;
      status?: string;
      conditions?: string[];
      invalidation?: string;
      pathLabels?: string[];
    };
  };
  dataMode?: string;
}

export interface LibraryRow {
  analysisId: string;
  symbol: string;
  timestamp: string;
  direction: string;
  opportunity?: string;
  marketState?: string;
  htf?: string;
  setupTf?: string;
  entryTf?: string;
  confidence?: number;
  status?: string;
  p1?: string;
  p2?: string;
  outcome?: string;
}

export interface LibraryResponse {
  ok: boolean;
  summary: Record<string, number>;
  rows: LibraryRow[];
  total: number;
}
