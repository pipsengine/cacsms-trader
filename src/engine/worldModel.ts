import { Instrument } from '../types';
import { getVisionInstrument } from '../features/htf-vision/services/visionStore';
import { tfDirection, visionPosition } from '../features/htf-vision/services/visionStage';
import type { VisionInstrument } from '../features/htf-vision/types';

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

/** D1/H8 structure from Stage 5; unconfirmed or unavailable structure is FORMING/NEUTRAL with zero confidence. */
function htf(v: VisionInstrument | undefined, tf: 'd1' | 'h8'): WorldState['d1'] {
  const s = v?.[tf];
  const usable = !!v && (v.status === 'READY' || v.status === 'STALE') && s?.dataStatus === 'READY';
  const status: ChannelStatus = usable && s?.status && s.status !== 'NONE' ? s.status : 'FORMING';
  return {
    status,
    direction: tfDirection(v, tf),
    position: usable ? visionPosition(v, tf) ?? 0 : 0,
    confidence: usable ? s?.confidence ?? 0 : 0,
  };
}

/** Derive world-model row from live instrument state — never invent quote quality. */
export function createWorldState(i: Instrument): WorldState {
  const validQuote = i.bid > 0 && i.ask >= i.bid;
  const conf = Number.isFinite(i.confidence) ? i.confidence : 0;
  const v = getVisionInstrument(i.symbol);
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
    d1: htf(v, 'd1'),
    h8: htf(v, 'h8'),
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
