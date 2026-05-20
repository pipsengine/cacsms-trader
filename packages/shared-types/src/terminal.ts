import type { TradingAccountSnapshot } from "./account";

export type TerminalConnectionStatus = "connected" | "degraded" | "disconnected";

export interface TerminalHeartbeat {
  terminalId: string;
  account: TradingAccountSnapshot;
  connectionStatus: TerminalConnectionStatus;
  lastTickTime: string;
  terminalTime: string;
  mt5ServerTime: string;
  nigeriaTime: string;
  latencyMs: number;
  openOrders: number;
  version: string;
  receivedAt: string;
}

export interface TerminalHealth {
  terminalId: string;
  status: TerminalConnectionStatus;
  latencyMs: number;
  lastHeartbeatAt: string;
  heartbeatAgeMs: number;
  accountNumber: string;
  brokerName: string;
  serverName: string;
}
