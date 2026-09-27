import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { allPairs, setMarketSnapshot } from '../data/market';
import { loadAppState, saveAppState, type AppEvent } from '../services/appDb';
import { mergeEnrichIntoInstruments, mergeTicksIntoInstruments, subscribeLiveFeed } from '../services/liveFeed';
import { subscribeMT5 } from '../features/mt5-connection/services/cacsmsMT5Runtime';
import { bridgeEnrich } from '../features/mt5-connection/services/mt5BridgeClient';
import type { CurrencyStrength, Instrument, Position } from '../types';

type Ctx = {
  ready: boolean;
  dbError: string;
  auto: boolean;
  setAuto: (v: boolean) => void;
  selected: string;
  setSelected: (v: string) => void;
  positions: Position[];
  closePosition: (id: string) => void;
  setPositions: (p: Position[]) => void;
  instruments: Instrument[];
  setInstruments: (i: Instrument[]) => void;
  strengths: CurrencyStrength[];
  setStrengths: (s: CurrencyStrength[]) => void;
  events: AppEvent[];
  pushEvent: (message: string, source?: string) => void;
  riskLimit: number;
  setRiskLimit: (n: number) => void;
  riskUsed: number;
  refreshFromDb: () => Promise<void>;
};

const TradingContext = createContext<Ctx | null>(null);

function asInstrument(raw: unknown): Instrument | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!r.symbol) return null;
  return {
    symbol: String(r.symbol),
    kind: r.kind === 'GOLD' || String(r.symbol) === 'XAUUSD' ? 'GOLD' : 'FX',
    bid: Number(r.bid || 0),
    ask: Number(r.ask || 0),
    spread: Number(r.spread || 0),
    change: Number(r.change || 0),
    d1: (r.d1 as Instrument['d1']) || 'NEUTRAL',
    h8: (r.h8 as Instrument['h8']) || 'NEUTRAL',
    h1: String(r.h1 || 'Waiting'),
    score: Number(r.score || 0),
    state: (r.state as Instrument['state']) || 'WAIT',
    strengthDiff: Number(r.strengthDiff || 0),
    channelPos: Number(r.channelPos || 50),
    confidence: Number(r.confidence || 0),
  };
}

function asPosition(raw: unknown): Position | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!r.id || !r.symbol) return null;
  return {
    id: String(r.id),
    symbol: String(r.symbol),
    side: r.side === 'SELL' ? 'SELL' : 'BUY',
    entry: Number(r.entry || 0),
    current: Number(r.current || 0),
    sl: Number(r.sl || 0),
    tp: Number(r.tp || 0),
    size: Number(r.size || 0),
    risk: Number(r.risk || 0),
    pnl: Number(r.pnl || 0),
    status: r.status === 'CLOSED' ? 'CLOSED' : 'ACTIVE',
    opened: String(r.opened || ''),
  };
}

function asStrength(raw: unknown): CurrencyStrength | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!r.code) return null;
  return {
    code: String(r.code),
    q: Number(r.q || 0),
    m: Number(r.m || 0),
    score: Number(r.score || 0),
    trend: (r.trend as CurrencyStrength['trend']) || 'Stable',
    classification: String(r.classification || 'NEUTRAL'),
  };
}

/** Prefer live quotes when DB row is empty/stale. */
function mergeInstruments(dbRows: Instrument[], liveRows: Instrument[]): Instrument[] {
  if (!dbRows.length) return liveRows;
  if (!liveRows.length) return dbRows;
  const live = new Map(liveRows.map((i) => [i.symbol, i]));
  const merged = dbRows.map((row) => {
    const l = live.get(row.symbol);
    if (!l) return row;
    return {
      ...row,
      bid: l.bid || row.bid,
      ask: l.ask || row.ask,
      spread: l.spread || row.spread,
    };
  });
  for (const l of liveRows) {
    if (!merged.some((m) => m.symbol === l.symbol)) merged.push(l);
  }
  return merged.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function TradingProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [dbError, setDbError] = useState('');
  const [auto, setAutoState] = useState(false);
  const [selected, setSelected] = useState<string>(allPairs[0]);
  const [pos, setPos] = useState<Position[]>([]);
  const [instruments, setInstrumentsState] = useState<Instrument[]>([]);
  const [strengths, setStrengthsState] = useState<CurrencyStrength[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [riskLimit, setRiskLimitState] = useState(1);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instrumentPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipPersist = useRef(true);
  const instrumentsRef = useRef<Instrument[]>([]);
  const posRef = useRef<Position[]>([]);
  const strengthsRef = useRef<CurrencyStrength[]>([]);

  const syncModuleExports = useCallback((i: Instrument[], p: Position[], s: CurrencyStrength[]) => {
    instrumentsRef.current = i;
    posRef.current = p;
    strengthsRef.current = s;
    setMarketSnapshot({ instruments: i, positions: p, strengths: s });
  }, []);

  const schedulePersist = useCallback(
    (next: {
      auto?: boolean;
      riskLimit?: number;
      instruments?: Instrument[];
      positions?: Position[];
      strengths?: CurrencyStrength[];
      events?: AppEvent[];
    }) => {
      if (skipPersist.current) return;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        void saveAppState({
          settings: {
            auto: String(next.auto ?? auto),
            riskLimit: String(next.riskLimit ?? riskLimit),
            selected,
          },
          instruments: next.instruments ?? instrumentsRef.current,
          positions: next.positions ?? posRef.current,
          strengths: next.strengths ?? strengthsRef.current,
          events: (next.events ?? []).filter((e) => !e.id),
        }).then((r) => {
          if (!r.ok) setDbError(r.message);
          else setDbError('');
        });
      }, 600);
    },
    [auto, riskLimit, selected],
  );

  const scheduleInstrumentPersist = useCallback((rows: Instrument[]) => {
    if (instrumentPersistTimer.current) clearTimeout(instrumentPersistTimer.current);
    instrumentPersistTimer.current = setTimeout(() => {
      void saveAppState({ instruments: rows });
    }, 8000);
  }, []);

  const refreshFromDb = useCallback(async () => {
    const data = await loadAppState();
    if (data.ok === false && data.message) setDbError(data.message);
    else setDbError('');

    const dbInstruments = (data.instruments || []).map(asInstrument).filter(Boolean) as Instrument[];
    const dbPositions = (data.positions || []).map(asPosition).filter(Boolean) as Position[];
    const dbStrengths = (data.strengths || []).map(asStrength).filter(Boolean) as CurrencyStrength[];
    const settings = data.settings || {};

    skipPersist.current = true;
    setInstrumentsState((live) => {
      const next = mergeInstruments(dbInstruments, live);
      instrumentsRef.current = next;
      return next;
    });
    setPos((live) => {
      // Keep live ACTIVE MT5 rows; prefer DB for CLOSED history
      const liveActive = live.filter((p) => p.status === 'ACTIVE');
      if (liveActive.length) {
        const closed = dbPositions.filter((p) => p.status === 'CLOSED');
        const next = [...liveActive, ...closed.filter((c) => !liveActive.some((l) => l.id === c.id))];
        posRef.current = next;
        return next;
      }
      posRef.current = dbPositions;
      return dbPositions;
    });
    setStrengthsState(dbStrengths);
    strengthsRef.current = dbStrengths;
    setEvents(data.events || []);
    setAutoState(settings.auto === 'true');
    setRiskLimitState(Number(settings.riskLimit || 1) || 1);
    if (settings.selected) setSelected(settings.selected);
    syncModuleExports(instrumentsRef.current, posRef.current, strengthsRef.current);
    setReady(true);
    queueMicrotask(() => {
      skipPersist.current = false;
    });
  }, [syncModuleExports]);

  useEffect(() => {
    void refreshFromDb();
  }, [refreshFromDb]);

  /** Start MT5 pulse only after first DB hydrate — avoids empty overwrite race. */
  useEffect(() => {
    if (!ready) return;
    return subscribeMT5(() => {
      /* liveFeed carries ticks/positions */
    });
  }, [ready]);

  /** Stable live subscription — must NOT depend on instruments/pos (that caused flicker). */
  useEffect(() => {
    if (!ready) return;
    return subscribeLiveFeed((update) => {
      if (update.ticks?.length) {
        setInstrumentsState((prev) => {
          const next = mergeTicksIntoInstruments(prev, update.ticks!);
          syncModuleExports(next, posRef.current, strengthsRef.current);
          scheduleInstrumentPersist(next);
          return next;
        });
      }
      if (update.positions) {
        setPos((prev) => {
          const closed = prev.filter((p) => p.status === 'CLOSED');
          const liveIds = new Set(update.positions!.map((p) => p.id));
          const keptClosed = closed.filter((p) => !liveIds.has(p.id));
          const next = [...update.positions!, ...keptClosed];
          syncModuleExports(instrumentsRef.current, next, strengthsRef.current);
          return next;
        });
      }
    });
  }, [ready, syncModuleExports, scheduleInstrumentPersist]);

  /** Enrich structure fields (D1/H8/H1/score) from MT5 every 5s — live prices still come from 1Hz ticks. */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const run = async () => {
      const result = await bridgeEnrich([...allPairs]);
      if (cancelled || !result.ok) return;
      setInstrumentsState((prev) => {
        const next = mergeEnrichIntoInstruments(prev, result.instruments);
        syncModuleExports(next, posRef.current, strengthsRef.current);
        scheduleInstrumentPersist(next);
        return next;
      });
    };
    void run();
    const timer = window.setInterval(() => void run(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ready, syncModuleExports, scheduleInstrumentPersist]);

  const setAuto = (v: boolean) => {
    setAutoState(v);
    schedulePersist({ auto: v });
  };

  const setRiskLimit = (n: number) => {
    setRiskLimitState(n);
    schedulePersist({ riskLimit: n });
  };

  const setInstruments = (i: Instrument[]) => {
    setInstrumentsState(i);
    syncModuleExports(i, posRef.current, strengthsRef.current);
    schedulePersist({ instruments: i });
  };

  const setPositions = (p: Position[]) => {
    setPos(p);
    syncModuleExports(instrumentsRef.current, p, strengthsRef.current);
    schedulePersist({ positions: p });
  };

  const setStrengths = (s: CurrencyStrength[]) => {
    setStrengthsState(s);
    syncModuleExports(instrumentsRef.current, posRef.current, s);
    schedulePersist({ strengths: s });
  };

  const closePosition = (id: string) => {
    const next = posRef.current.map((x) => (x.id === id ? { ...x, status: 'CLOSED' as const } : x));
    setPositions(next);
  };

  const pushEvent = (message: string, source = 'UI') => {
    const ev = { message, source, severity: 'INFO' };
    setEvents((e) => [ev, ...e].slice(0, 100));
    schedulePersist({ events: [ev] });
  };

  const riskUsed = useMemo(
    () => pos.filter((p) => p.status === 'ACTIVE').reduce((sum, p) => sum + (p.risk || 0), 0),
    [pos],
  );

  const value = useMemo(
    () => ({
      ready,
      dbError,
      auto,
      setAuto,
      selected,
      setSelected,
      positions: pos,
      closePosition,
      setPositions,
      instruments,
      setInstruments,
      strengths,
      setStrengths,
      events,
      pushEvent,
      riskLimit,
      setRiskLimit,
      riskUsed,
      refreshFromDb,
    }),
    [ready, dbError, auto, selected, pos, instruments, strengths, events, riskLimit, riskUsed, refreshFromDb],
  );

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}

export const useTrading = () => useContext(TradingContext)!;
