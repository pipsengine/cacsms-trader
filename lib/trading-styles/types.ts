export type TradingStyleId =
  | 'scalp'
  | 'intraday'
  | 'day_trade'
  | 'swing'
  | 'position';

export type TradingStyleCategory =
  | 'ultra_short'
  | 'short'
  | 'session'
  | 'medium'
  | 'long';

export interface TradingStyleProfile {
  id: TradingStyleId;
  label: string;
  category: TradingStyleCategory;
  description: string;
  entryTimeframe: string;
  dominantTimeframe: string;
  biasTimeframes: string[];
  maxHoldHours: number;
  minRewardRisk: number;
  riskPerTradePercent: number;
  maxSpreadPoints: number;
  scanPriority: number;
  maxEntriesPerCycle: number;
  confidenceFloor: number;
  readinessFloor: number;
  stopAtrMultiplier: number;
  algorithms: string[];
}

export interface StyleFitnessContext {
  symbol: string;
  spreadPoints: number;
  volatilityScore: number;
  liquidityScore: number;
  session: string;
  macroRiskScore: number;
  mtfAlignmentScore: number;
  mtfConflictCount: number;
  htfRanging?: boolean;
  ltfScalpPreferred?: boolean;
}

export interface StyleFitnessResult {
  styleId: TradingStyleId;
  symbol: string;
  fitnessScore: number;
  eligible: boolean;
  reasons: string[];
  entryTimeframe: string;
}

export interface MultiStyleCycleResult {
  stylesEnabled: TradingStyleId[];
  candidatesEvaluated: number;
  dispatchesAttempted: number;
  actionableDispatches: number;
  byStyle: Record<string, { attempted: number; actionable: number; symbols: string[] }>;
  detail: string;
  at: string;
}
