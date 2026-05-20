export type Timeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1";
export type MarketCondition = "trending" | "ranging" | "volatile" | "illiquid" | "news_blackout";
export type TradingSession = "asian" | "london" | "new_york" | "overlap" | "closed";

export interface TickSnapshot {
  symbol: string;
  bid: number;
  ask: number;
  spreadPoints: number;
  serverTime: string;
  receivedAt: string;
}

export interface Candle {
  symbol: string;
  timeframe: Timeframe;
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketScanResult {
  symbol: string;
  condition: MarketCondition;
  session: TradingSession;
  volatilityScore: number;
  liquidityScore: number;
  setupScore: number;
  tradable: boolean;
  reasons: string[];
  scannedAt: string;
}
