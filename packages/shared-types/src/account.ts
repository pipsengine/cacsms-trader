export type AccountMode = "demo" | "live" | "prop_firm";

export interface TradingAccountSnapshot {
  accountNumber: string;
  brokerName: string;
  serverName: string;
  mode: AccountMode;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  peakEquityToday: number;
  startingEquityToday: number;
  peakEquityAllTime: number;
  openTradeCount: number;
  updatedAt: string;
}
