import { allPairs } from '../data/market';
import type { DataAccessLayer, InstrumentRecord } from './ports';
import { getDatabaseRuntimeMode, isDatabaseWritable } from './mode';

function inferInstrument(symbol: string): InstrumentRecord {
  const metal = symbol === 'XAUUSD';
  const base = metal ? 'XAU' : symbol.slice(0, 3);
  const quote = metal ? 'USD' : symbol.slice(3, 6);
  const jpy = base === 'JPY' || quote === 'JPY';
  return {
    symbol,
    assetClass: metal ? 'METAL' : 'FX',
    baseCurrency: base,
    quoteCurrency: quote,
    digits: metal ? 2 : jpy ? 3 : 5,
    pipSize: metal || jpy ? 0.01 : 0.0001,
    enabled: true,
  };
}

/**
 * Browser / Vercel-safe fallback DAL.
 * Uses in-repo reference data so UI keeps working when Node SQLite is unavailable.
 * Does not claim to be the authoritative writable store.
 */
export function createFixtureDataAccess(): DataAccessLayer {
  const mode = getDatabaseRuntimeMode();
  const instruments = allPairs.map(inferInstrument);
  const settings = new Map<string, string>([
    ['app.name', 'Cacsms Trader'],
    ['app.mode', 'SIMULATION'],
    ['db.backend', 'fixture-fallback'],
  ]);

  return {
    mode: mode === 'VERCEL_READONLY' ? 'VERCEL_READONLY' : 'UNAVAILABLE',
    writable: false,
    instruments: {
      list: () => instruments,
      get: (symbol) => instruments.find((i) => i.symbol === symbol) ?? null,
      count: () => instruments.length,
    },
    settings: {
      get: (key) => settings.get(key) ?? null,
      set: () => {
        throw new Error('Fixture DAL is read-only. Use local/central SQLite for writes.');
      },
    },
    audit: {
      append: () => {
        /* no-op in browser fallback */
      },
    },
  };
}
