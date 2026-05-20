export type TradeSide = "buy" | "sell";
export type OrderKind = "market" | "limit" | "stop";
export type ExecutionStatus = "queued" | "sent" | "accepted" | "rejected" | "filled" | "failed";

export interface TradeIntent {
  intentId: string;
  terminalId: string;
  accountNumber: string;
  symbol: string;
  side: TradeSide;
  orderKind: OrderKind;
  requestedVolumeLots: number;
  entryPrice?: number;
  stopLoss: number;
  takeProfit: number;
  strategyId: string;
  setupScore: number;
  riskAmount: number;
  rewardRiskRatio: number;
  createdAt: string;
}

export interface ExecutionAck {
  commandId: string;
  terminalId: string;
  status: ExecutionStatus;
  ticket?: string;
  brokerMessage?: string;
  executedPrice?: number;
  executedVolumeLots?: number;
  latencyMs: number;
  receivedAt: string;
}
