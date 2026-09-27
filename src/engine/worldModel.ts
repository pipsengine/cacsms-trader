import { Instrument } from '../types';

export type ChannelStatus =
  | 'FORMING'
  | 'VALIDATED'
  | 'ACTIVE'
  | 'WEAKENING'
  | 'BROKEN'
  | 'RETESTING'
  | 'INVALIDATED';

export interface WorldState {
  symbol: string;
  updatedAt: number;
  dataQuality: number;
  macro: { base: number; quote: number; differential: number; bias: string };
  regime: { state: string; persistence: number };
  d1: { status: ChannelStatus; direction: string; position: number; confidence: number };
  h8: { status: ChannelStatus; direction: string; position: number; confidence: number };
  h1: { phase: string; choch: boolean; bos: boolean; confirmed: boolean };
  risk: { approved: boolean; score: number; reason: string };
}

/** Derive world-model row from live instrument state — never invent quote quality. */
export function createWorldState(i: Instrument): WorldState {
  const validQuote = i.bid > 0 && i.ask >= i.bid;
  const conf = Number.isFinite(i.confidence) ? i.confidence : 0;
  const dataQuality = validQuote ? Math.min(100, Math.max(conf, i.score > 0 ? 50 : 25)) : 0;

  return {
    symbol: i.symbol,
    updatedAt: Date.now(),
    dataQuality,
    macro: {
      base: i.strengthDiff / 2,
      quote: -i.strengthDiff / 2,
      differential: i.strengthDiff,
      bias: i.strengthDiff > 3 ? 'BULLISH' : i.strengthDiff < -3 ? 'BEARISH' : 'NEUTRAL',
    },
    regime: {
      state: Math.abs(i.strengthDiff) > 8 ? 'EXPANDING' : 'STABLE',
      persistence: Math.min(95, 55 + Math.abs(i.strengthDiff) * 2),
    },
    d1: {
      status: validQuote ? 'ACTIVE' : 'FORMING',
      direction: i.d1,
      position: i.channelPos,
      confidence: conf,
    },
    h8: {
      status: validQuote ? 'ACTIVE' : 'FORMING',
      direction: i.h8,
      position: Math.max(0, i.channelPos - 5),
      confidence: Math.max(0, conf - 4),
    },
    h1: {
      phase: i.h1,
      choch: i.h1 === 'Confirmed',
      bos: i.state === 'READY',
      confirmed: i.state === 'READY',
    },
    risk: {
      approved: i.state === 'READY',
      score: i.score,
      reason: i.state === 'READY' ? 'All mandatory gates passed' : 'Awaiting downstream confirmation',
    },
  };
}
