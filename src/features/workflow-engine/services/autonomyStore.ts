import { useSyncExternalStore } from 'react';
import { bridgeAutonomyState, type AutonomyState } from '../../mt5-connection/services/mt5BridgeClient';

/** Observation of the bridge orchestrator. The poll does not run the pipeline. */
const listeners = new Set<() => void>();
let snapshot: AutonomyState | null = null;
let timer: number | undefined;
let users = 0;

function emit() {
  listeners.forEach((fn) => fn());
}

async function pull() {
  const next = await bridgeAutonomyState();
  snapshot = next;
  emit();
}

export function startAutonomyStore(): () => void {
  users += 1;
  if (users === 1) {
    void pull();
    timer = window.setInterval(() => void pull(), 3000);
  }
  return () => {
    users = Math.max(0, users - 1);
    if (users === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

export function getAutonomySnapshot(): AutonomyState | null {
  return snapshot;
}

export function useAutonomyState(): AutonomyState | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => snapshot,
  );
}
