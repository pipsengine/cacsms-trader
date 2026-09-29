import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { allPairs, setMarketSnapshot } from '../data/market';
import { loadAppState, saveAppState, type AppEvent } from '../services/appDb';
import { mergeEnrichIntoInstruments, mergeTicksIntoInstruments, subscribeLiveFeed } from '../services/liveFeed';
import { subscribeMT5 } from '../features/mt5-connection/services/cacsmsMT5Runtime';
import { bridgeEnrich } from '../features/mt5-connection/services/mt5BridgeClient';
import { getRegimeSnapshot, startRegimeStore, subscribeRegime } from '../features/historical-regime/services/regimeStore';
import { startHistoryStore } from '../features/market-data/services/historyStore';
import { publishStage2 } from '../features/currency-strength/services/strengthStage';
import { getVisionSnapshot, startVisionStore, subscribeVision, visionStageStatus } from '../features/htf-vision/services/visionStore';
import { instrumentFields, publishStage5 } from '../features/htf-vision/services/visionStage';
import { getScannerSnapshot, scannerStageStatus, startScannerStore, subscribeScanner } from '../features/market-scanner/services/scannerStore';
import { publishStage4 } from '../features/market-scanner/services/scannerStage';
import { directionStageStatus, getDirectionSnapshot, startDirectionStore, subscribeDirection } from '../features/structural-direction/services/directionStore';
import { publishStage6 } from '../features/structural-direction/services/directionStage';
import { getH1Snapshot, h1StageStatus, startH1Store, subscribeH1 } from '../features/h1-confirmation/services/confirmStore';
import { publishStage7 } from '../features/h1-confirmation/services/confirmStage';
import { getRiskSnapshot, riskStageStatus, saveRiskConfigNow, startRiskStore, subscribeRisk } from '../features/opportunity-risk/services/riskStore';
import { publishStage8 } from '../features/opportunity-risk/services/riskStage';
import { executionStageStatus, getExecutionSnapshot, setControlNow, startExecutionStore, subscribeExecution } from '../features/execution/services/executionStore';
import { startLearningStore } from '../features/performance/services/learningStore';
import { publishStage9 } from '../features/execution/services/executionStage';
import { startAutonomyStore } from '../features/workflow-engine/services/autonomyStore';
import { startEconomicStore } from '../features/economic-intelligence';
import { eventBus } from '../services/eventBus';
import type { CurrencyStrength, Instrument, Position } from '../types';

type Ctx = {
  ready: boolean;
  dbError: string;
  auto: boolean;
  setAuto: (v: boolean) => void;
  selected: string;
  setSelected: (v: string) => void;
  positions: Position[];
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
    // Structure fields are re-derived from Stage 5 on load, never trusted from the persisted snapshot.
    d1: 'NEUTRAL',
    h8: 'NEUTRAL',
    // H1 confirmation is owned by Stage 7; re-derived from its persisted decisions, never trusted from the snapshot.
    h1: 'WAITING_FOR_STAGE6',
    score: Number(r.score || 0),
    state: (r.state as Instrument['state']) || 'WAIT',
    strengthDiff: Number(r.strengthDiff || 0),
    channelPos: 0,
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
  const dbLoaded = useRef(false);
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
            riskLimit: String(next.riskLimit ?? riskLimit),
            selected,
          },
          instruments: next.instruments ?? instrumentsRef.current,
          positions: next.positions ?? posRef.current,
          ...(next.strengths ? { strengths: next.strengths } : {}),
          events: (next.events ?? []).filter((e) => !e.id),
        }).then((r) => {
          if (!r.ok) setDbError(r.message);
          else setDbError('');
        });
      }, 600);
    },
    [riskLimit, selected],
  );

  const scheduleInstrumentPersist = useCallback((rows: Instrument[]) => {
    if (instrumentPersistTimer.current) clearTimeout(instrumentPersistTimer.current);
    instrumentPersistTimer.current = setTimeout(() => {
      void saveAppState({ instruments: rows }).then((r) => {
        if (r.ok && dbLoaded.current) setDbError('');
      });
    }, 8000);
  }, []);

  const refreshFromDb = useCallback(async () => {
    const data = await loadAppState();
    if (data.ok === false) {
      // Keep whatever live state we already have; a failed read must not wipe settings/positions.
      setDbError(data.message || 'App DB load failed');
      setReady(true);
      return;
    }
    setDbError('');
    dbLoaded.current = true;

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

  useEffect(() => {
    if (!dbError || dbLoaded.current) return;
    const timer = window.setTimeout(() => void refreshFromDb(), 5000);
    return () => window.clearTimeout(timer);
  }, [dbError, refreshFromDb]);

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

  /** Stage 1 is server-owned; this store observes scheduler state only. */
  useEffect(() => {
    if (!ready) return;
    return startHistoryStore();
  }, [ready]);

  /** The orchestrator runs on the bridge. This subscription only displays its heartbeat, jobs and decisions. */
  useEffect(() => {
    if (!ready) return;
    return startAutonomyStore();
  }, [ready]);

  /** Economic Intelligence runs on the bridge. This poll only observes the snapshot and forwards audit rows. */
  useEffect(() => {
    if (!ready) return;
    return startEconomicStore();
  }, [ready]);

  /** Stage 3 regime engine owns strength trajectories; the bridge persists them, so no client write-back. */
  useEffect(() => {
    if (!ready) return;
    const stop = startRegimeStore();
    let lastFetch: number | null = null;
    const apply = () => {
      const snap = getRegimeSnapshot();
      if (!snap.state || snap.lastFetchAt === lastFetch) return;
      lastFetch = snap.lastFetchAt;
      const rows = (snap.state.strengths || []).map(asStrength).filter(Boolean) as CurrencyStrength[];
      if (rows.length) {
        strengthsRef.current = rows;
        setStrengthsState(rows);
      }
      const pairs = new Map(snap.state.pairs.map((p) => [p.symbol, p]));
      setInstrumentsState((prev) => {
        const next = prev.map((i) => {
          const p = pairs.get(i.symbol);
          if (!p) return i;
          const d = p.status === 'READY' && p.differential != null ? p.differential : 0;
          return d !== i.strengthDiff ? { ...i, strengthDiff: d } : i;
        });
        syncModuleExports(next, posRef.current, strengthsRef.current);
        return next;
      });
      publishStage2(snap.state);
    };
    apply();
    const unsub = subscribeRegime(apply);
    return () => {
      unsub();
      stop();
    };
  }, [ready, syncModuleExports]);

  /** Stage 5 HTF Market Vision owns the D1/H8 structure fields; the bridge analyses autonomously. */
  useEffect(() => {
    if (!ready) return;
    const stop = startVisionStore();
    let lastKey = '';
    const apply = () => {
      const snap = getVisionSnapshot();
      const status = visionStageStatus(snap);
      const key = `${snap.lastFetchAt}|${status}`;
      if (key === lastKey) return;
      lastKey = key;
      const usable = status === 'HEALTHY' || status === 'DEGRADED';
      const bySymbol = new Map((usable ? snap.state?.instruments ?? [] : []).map((v) => [v.symbol, v]));
      setInstrumentsState((prev) => {
        let changed = false;
        const next = prev.map((i) => {
          const f = instrumentFields(bySymbol.get(i.symbol));
          if (f.d1 === i.d1 && f.h8 === i.h8 && f.channelPos === i.channelPos) return i;
          changed = true;
          return { ...i, ...f };
        });
        if (!changed) return prev;
        syncModuleExports(next, posRef.current, strengthsRef.current);
        return next;
      });
      if (usable) publishStage5(snap.state);
    };
    apply();
    const unsub = subscribeVision(apply);
    return () => {
      unsub();
      stop();
    };
  }, [ready, syncModuleExports]);

  /** Stage 4 Market Scanner ranks and promotes on the bridge; publish its re-ranks to the Workflow Engine. */
  useEffect(() => {
    if (!ready) return;
    const stop = startScannerStore();
    let lastFetch: number | null = null;
    const apply = () => {
      const snap = getScannerSnapshot();
      if (snap.lastFetchAt === lastFetch) return;
      lastFetch = snap.lastFetchAt;
      const status = scannerStageStatus(snap);
      if (status === 'HEALTHY' || status === 'DEGRADED') publishStage4(snap.state);
    };
    apply();
    const unsub = subscribeScanner(apply);
    return () => {
      unsub();
      stop();
    };
  }, [ready]);

  /** Stage 6 Structural Direction decides on the bridge; publish decision changes and READY_FOR_H1 hand-offs to the Workflow Engine. */
  useEffect(() => {
    if (!ready) return;
    const stop = startDirectionStore();
    let lastFetch: number | null = null;
    const apply = () => {
      const snap = getDirectionSnapshot();
      if (snap.lastFetchAt === lastFetch) return;
      lastFetch = snap.lastFetchAt;
      const status = directionStageStatus(snap);
      if (status === 'HEALTHY' || status === 'DEGRADED') publishStage6(snap.state);
    };
    apply();
    const unsub = subscribeDirection(apply);
    return () => {
      unsub();
      stop();
    };
  }, [ready]);

  /** Stage 7 H1 Confirmation owns each instrument's H1 state; publish confirmation changes and Stage 8 hand-offs. */
  useEffect(() => {
    if (!ready) return;
    const stop = startH1Store();
    let lastKey = '';
    const apply = () => {
      const snap = getH1Snapshot();
      const status = h1StageStatus(snap);
      const key = `${snap.lastFetchAt}|${status}`;
      if (key === lastKey) return;
      lastKey = key;
      const usable = status === 'HEALTHY' || status === 'DEGRADED';
      const bySymbol = new Map((usable ? snap.state?.instruments ?? [] : []).map((d) => [d.symbol, d.state as string]));
      const fallback = status === 'STALE' ? 'STALE' : status === 'ERROR' ? 'BLOCKED' : 'WAITING_FOR_STAGE6';
      setInstrumentsState((prev) => {
        let changed = false;
        const next = prev.map((i) => {
          const h1 = bySymbol.get(i.symbol) ?? fallback;
          if (h1 === i.h1) return i;
          changed = true;
          return { ...i, h1 };
        });
        if (!changed) return prev;
        syncModuleExports(next, posRef.current, strengthsRef.current);
        return next;
      });
      if (usable) publishStage7(snap.state);
    };
    apply();
    const unsub = subscribeH1(apply);
    return () => {
      unsub();
      stop();
    };
  }, [ready, syncModuleExports]);

  /** Stage 8 Opportunities & Risk owns risk per trade and portfolio risk; publish its runs and authorizations to the Workflow Engine. */
  const [stage8OpenRisk, setStage8OpenRisk] = useState<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    const stop = startRiskStore();
    let lastKey = '';
    const apply = () => {
      const snap = getRiskSnapshot();
      const status = riskStageStatus(snap);
      const key = `${snap.lastFetchAt}|${status}`;
      if (key === lastKey) return;
      lastKey = key;
      const usable = status === 'HEALTHY' || status === 'DEGRADED';
      const perTrade = Number(snap.state?.config?.riskPerTradePct);
      if (Number.isFinite(perTrade) && perTrade > 0) setRiskLimitState(perTrade);
      const run = snap.state?.run;
      const acct = run?.accounts.find((a) => a.accountId === run.terminal?.accountId) ?? run?.accounts[0];
      setStage8OpenRisk(usable && acct ? acct.openRiskPct + acct.pendingRiskPct : null);
      if (usable) publishStage8(snap.state);
    };
    apply();
    const unsub = subscribeRisk(apply);
    return () => {
      unsub();
      stop();
    };
  }, [ready]);

  /** Stage 10 learning runs on the bridge. This poll only reads it, including while Performance & Learning is closed. */
  useEffect(() => {
    if (!ready) return;
    return startLearningStore();
  }, [ready]);

  /** Stage 9 Execution & Positions runs on the central engine; mirror its global trading switch and publish its lifecycle events. */
  useEffect(() => {
    if (!ready) return;
    const stop = startExecutionStore();
    let lastFetch: number | null = null;
    const apply = () => {
      const snap = getExecutionSnapshot();
      if (snap.lastFetchAt === lastFetch) return;
      lastFetch = snap.lastFetchAt;
      if (snap.state) setAutoState(snap.state.tradingEnabled);
      const status = executionStageStatus(snap);
      if (status !== 'WAITING' && status !== 'ERROR') publishStage9(snap.state);
    };
    apply();
    const unsub = subscribeExecution(apply);
    return () => {
      unsub();
      stop();
    };
  }, [ready]);

  /** Global trading pause/resume is an audited command to the central engine; the UI reflects the engine's persisted state. */
  const setAuto = (v: boolean) => {
    setAutoState(v);
    void setControlNow({ tradingEnabled: v }, v ? 'Trading resumed from the application' : 'New trades paused from the application').catch((e: unknown) => {
      setAutoState(Boolean(getExecutionSnapshot().state?.tradingEnabled));
      setDbError(e instanceof Error ? e.message : 'Central engine unreachable — trading state unchanged');
    });
  };

  /** Risk per trade is a Stage 8 setting: saved (and audited) through the risk configuration, which also syncs app_settings.riskLimit. */
  const setRiskLimit = (n: number) => {
    setRiskLimitState(n);
    void saveRiskConfigNow({ riskPerTradePct: n }, 'Risk per trade changed from the application').catch((e: unknown) =>
      setDbError(e instanceof Error ? e.message : 'Risk configuration save failed'),
    );
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

  const pushEvent = (message: string, source = 'UI') => {
    const ev = { message, source, severity: 'INFO' };
    setEvents((e) => [ev, ...e].slice(0, 100));
    schedulePersist({ events: [ev] });
  };

  const riskUsed = useMemo(
    () => stage8OpenRisk ?? pos.filter((p) => p.status === 'ACTIVE').reduce((sum, p) => sum + (p.risk || 0), 0),
    [pos, stage8OpenRisk],
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
