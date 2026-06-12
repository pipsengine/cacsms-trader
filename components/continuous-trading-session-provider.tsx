'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ContinuousTradingSessionState = {
  active: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  loaded: boolean;
};

type ContinuousTradingSessionContextValue = ContinuousTradingSessionState & {
  busy: boolean;
  message: string | null;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

const ContinuousTradingSessionContext = createContext<ContinuousTradingSessionContextValue | null>(null);

async function fetchSessionStatus(): Promise<ContinuousTradingSessionState> {
  const response = await fetch('/api/command-center/continuous-trading', { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(String(payload.error ?? 'Unable to load continuous trading session.'));
  }
  return {
    active: Boolean(payload.session?.active),
    startedAt: payload.session?.startedAt ?? null,
    stoppedAt: payload.session?.stoppedAt ?? null,
    loaded: true,
  };
}

export function ContinuousTradingSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ContinuousTradingSessionState>({
    active: false,
    startedAt: null,
    stoppedAt: null,
    loaded: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchSessionStatus();
      setSession(next);
    } catch {
      // keep last known server state; provider retries on interval
    }
  }, []);

  const mutate = useCallback(async (action: 'start' | 'stop') => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/command-center/continuous-trading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(String(payload.error ?? `Unable to ${action} continuous trading.`));
      }
      setMessage(String(payload.message ?? (action === 'start' ? 'Trading started.' : 'Trading stopped.')));
      if (payload.session) {
        setSession({
          active: Boolean(payload.session.active),
          startedAt: payload.session.startedAt ?? null,
          stoppedAt: payload.session.stoppedAt ?? null,
          loaded: true,
        });
      } else {
        await refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Unable to ${action} continuous trading.`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const value = useMemo<ContinuousTradingSessionContextValue>(() => ({
    ...session,
    busy,
    message,
    refresh,
    start: () => mutate('start'),
    stop: () => mutate('stop'),
  }), [session, busy, message, refresh, mutate]);

  return (
    <ContinuousTradingSessionContext.Provider value={value}>
      {children}
    </ContinuousTradingSessionContext.Provider>
  );
}

export function useContinuousTradingSession(): ContinuousTradingSessionContextValue {
  const context = useContext(ContinuousTradingSessionContext);
  if (!context) {
    throw new Error('useContinuousTradingSession must be used within ContinuousTradingSessionProvider.');
  }
  return context;
}

export function applyContinuousTradingTick(
  current: ContinuousTradingSessionState,
  tick: { continuousTrading?: ContinuousTradingSessionState },
): ContinuousTradingSessionState {
  if (!tick.continuousTrading) return current;
  return {
    active: tick.continuousTrading.active,
    startedAt: tick.continuousTrading.startedAt,
    stoppedAt: tick.continuousTrading.stoppedAt,
    loaded: true,
  };
}
