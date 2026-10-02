import { useEffect, useState } from 'react';
import { bridgeEnrich } from '../../mt5-connection/services/mt5BridgeClient';

export type AcaLiveQuote = {
  bid: number;
  ask: number;
  mid: number;
  change: number;
  time: string;
  digits: number;
};

function digitsFor(symbol: string, fromApi?: number): number {
  if (fromApi != null && fromApi >= 0) return fromApi;
  if (symbol.startsWith('XAU') || symbol.startsWith('XAG')) return 2;
  if (symbol.includes('JPY')) return 3;
  return 5;
}

export function useAcaLiveQuote(symbol: string, enabled = true): AcaLiveQuote | null {
  const [quote, setQuote] = useState<AcaLiveQuote | null>(null);

  useEffect(() => {
    if (!enabled || !symbol) return;
    let cancelled = false;

    const pull = async () => {
      try {
        const res = await bridgeEnrich([symbol]);
        const row = res.instruments?.find((i) => i.symbol.toUpperCase() === symbol.toUpperCase());
        if (!row?.bid || !row?.ask || cancelled) return;
        const bid = row.bid;
        const ask = row.ask;
        setQuote({
          bid,
          ask,
          mid: (bid + ask) / 2,
          change: row.change ?? 0,
          time: row.time || new Date().toISOString(),
          digits: digitsFor(symbol, row.digits),
        });
      } catch {
        /* bridge offline — keep last quote */
      }
    };

    void pull();
    const id = window.setInterval(() => void pull(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, symbol]);

  return quote;
}
