import type { CurrencyStrength, Instrument, Position } from '../types';

/** Canonical 29-instrument universe (catalog only — not live quotes). */
export const allPairs = [
  'EURUSD',
  'EURGBP',
  'EURJPY',
  'EURCHF',
  'EURCAD',
  'EURAUD',
  'EURNZD',
  'GBPUSD',
  'GBPJPY',
  'GBPCHF',
  'GBPCAD',
  'GBPAUD',
  'GBPNZD',
  'USDJPY',
  'USDCHF',
  'USDCAD',
  'AUDUSD',
  'AUDJPY',
  'AUDCHF',
  'AUDCAD',
  'AUDNZD',
  'NZDUSD',
  'NZDJPY',
  'NZDCHF',
  'NZDCAD',
  'CADJPY',
  'CADCHF',
  'CHFJPY',
  'XAUUSD',
] as const;

/** Live rows come from the SQLite-backed bridge via TradingContext — start empty (no mock quotes). */
export let instruments: Instrument[] = [];
export let positions: Position[] = [];
export let strengths: CurrencyStrength[] = [];

export function setMarketSnapshot(next: {
  instruments?: Instrument[];
  positions?: Position[];
  strengths?: CurrencyStrength[];
}) {
  if (next.instruments) instruments = next.instruments;
  if (next.positions) positions = next.positions;
  if (next.strengths) strengths = next.strengths;
}
