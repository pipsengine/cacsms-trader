import type { ExecutionAck, MarketScanResult, RiskDecision, TerminalHealth, TradeIntent } from "../../../packages/shared-types";

export interface DashboardSnapshot {
  liveAccountStatus: {
    connectedTerminals: number;
    totalEquity: number;
    totalOpenOrders: number;
  };
  pairsMonitoring: MarketScanResult[];
  activeTrades: TradeIntent[];
  riskDashboard: RiskDecision[];
  strategyPerformance: StrategyPerformanceSnapshot[];
  economicData: EconomicEventSnapshot[];
  mt5TerminalConnectionStatus: TerminalHealth[];
  executionAcknowledgements: ExecutionAck[];
  updatedAt: string;
}

export interface StrategyPerformanceSnapshot {
  strategyId: string;
  trades: number;
  winRatePercent: number;
  profitFactor: number;
  netProfit: number;
}

export interface EconomicEventSnapshot {
  eventId: string;
  currency: string;
  title: string;
  impact: "low" | "medium" | "high";
  startsAt: string;
}

export function buildDashboardSnapshot(input: Omit<DashboardSnapshot, "updatedAt">, now = new Date()): DashboardSnapshot {
  return {
    ...input,
    updatedAt: now.toISOString(),
  };
}

