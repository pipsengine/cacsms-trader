export const AUTONOMY_TIMEFRAMES = ['W', 'D', 'H4', 'H1', 'M15'] as const;

export type AutonomyTimeframe = typeof AUTONOMY_TIMEFRAMES[number];
export type AutonomyMode = 'observe' | 'signal' | 'assisted_trade' | 'full_auto';
export type AutonomyJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked';
export type AutonomyDecision = 'BUY' | 'SELL' | 'WAIT' | 'AVOID' | 'MONITOR';

export const AUTONOMY_WORKERS = [
  'AutonomousPairSelectorWorker',
  'AutonomousSymbolScannerWorker',
  'AutonomousChartCaptureWorker',
  'AutonomousTimeframeSchedulerWorker',
  'AutonomousVisionPreprocessingWorker',
  'AutonomousCacsmsVisionWorker',
  'AutonomousCandleDetectionWorker',
  'AutonomousSwingDetectionWorker',
  'AutonomousPatternRecognitionWorker',
  'AutonomousTrendlineDetectionWorker',
  'AutonomousChannelDetectionWorker',
  'AutonomousSupportResistanceWorker',
  'AutonomousOrderBlockWorker',
  'AutonomousLiquidityDetectionWorker',
  'AutonomousStructureAnalysisWorker',
  'AutonomousMultiTimeframeComparisonWorker',
  'AutonomousImageComparisonWorker',
  'AutonomousVisualInterpretationWorker',
  'AutonomousAnomalyDetectionWorker',
  'AutonomousChartSegmentationWorker',
  'AutonomousMarketInterpretationWorker',
  'AutonomousMacroDataSyncWorker',
  'AutonomousCOTSyncWorker',
  'AutonomousInterestRateSyncWorker',
  'AutonomousSignalGenerationWorker',
  'AutonomousAlertWorker',
  'AutonomousOutcomeTrackingWorker',
  'AutonomousModelLearningWorker',
  'AutonomousAuditLogWorker',
  'AutonomousFailureRecoveryWorker',
] as const;

export type AutonomyWorkerName = typeof AUTONOMY_WORKERS[number];

export interface AutonomyConfig {
  activeSymbols: string[];
  watchlistSymbols: string[];
  maxSpreadPoints: number;
  pairSelectionEnabled: boolean;
  maxSelectedSymbols: number;
  activeTimeframes: AutonomyTimeframe[];
  mode: AutonomyMode;
  confidenceThreshold: number;
  alertThreshold: number;
  riskThreshold: number;
  retryLimit: number;
  workerConcurrency: number;
  newsBlackoutMinutes: number;
  scanFrequencySeconds: number;
  captureSources: string[];
  dataSources: string[];
  signalGenerationRules: Record<string, unknown>;
  tradeExecutionMode: AutonomyMode;
}

export interface AutonomousDecisionInput {
  symbol: string;
  timeframe: string;
  accountClass?: 'demo' | 'prop_firm' | 'live' | 'large_equity';
  dominantTimeframe?: string | null;
  visual?: {
    finalMarketBias?: string | null;
    confidenceScore?: number | null;
    setupReadinessScore?: number | null;
    finalDecision?: string | null;
    marketPhase?: string | null;
    liquidityObjective?: string | null;
    riskWarning?: string | null;
    invalidationCondition?: string | null;
    entryReadiness?: string | null;
  } | null;
  macro?: {
    economicRiskScore?: number | null;
    interestRateBias?: string | null;
    cotBias?: string | null;
    sentimentBias?: string | null;
    warning?: string | null;
  } | null;
  execution?: {
    spreadScore?: number | null;
    dataQualityScore?: number | null;
    captureQualityScore?: number | null;
    sessionState?: string | null;
  } | null;
}

export interface AutonomousDecisionOutput {
  symbol: string;
  timeframe: string;
  dominantTimeframe: string;
  finalBias: string;
  setupType: string;
  setupReadinessScore: number;
  confidenceScore: number;
  riskScore: number;
  decision: AutonomyDecision;
  entryZone: Record<string, unknown>;
  stopLoss: number | null;
  takeProfitLevels: number[];
  invalidationLevel: number | null;
  reasonForDecision: string;
  reasonAgainstDecision: string;
  macroRiskWarning: string;
  liquidityWarning: string;
  anomalyWarning: string;
  recommendedNextAction: string;
}
