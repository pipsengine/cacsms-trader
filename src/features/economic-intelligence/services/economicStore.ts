import { useSyncExternalStore } from 'react';
import { eventBus, type TradingEventType } from '../../../services/eventBus';
import { fetchEconomicSnapshot } from './economicClient';
import type { EconSnapshot } from '../types';

const POLL_MS = 2000;
const listeners = new Set<() => void>();
let snapshot: EconSnapshot | null = null;
let error: string | null = null;
let timer: number | undefined;
let users = 0;
let seenAudit = 0;

function emit() {
  listeners.forEach((fn) => fn());
}

function publishAudit(next: EconSnapshot) {
  const fresh = [...(next.audit || [])].filter((row) => row.id > seenAudit).sort((a, b) => a.id - b.id);
  for (const row of fresh) {
    if (row.type.startsWith('ECON_')) {
      eventBus.emit({
        id: `econ-${row.id}`,
        type: row.type as TradingEventType,
        symbol: row.symbol || undefined,
        at: row.createdAt || next.generatedAt,
        payload: { detail: row.detail, severity: row.severity, stage: 8, source: 'economic' },
      });
    }
    seenAudit = Math.max(seenAudit, row.id);
  }
}

async function pull() {
  try {
    const next = await fetchEconomicSnapshot();
    snapshot = next;
    error = null;
    publishAudit(next);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Economic intelligence unavailable';
  }
  emit();
}

export function startEconomicStore(): () => void {
  users += 1;
  if (users === 1) {
    void pull();
    timer = window.setInterval(() => void pull(), POLL_MS);
  }
  return () => {
    users = Math.max(0, users - 1);
    if (users === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

export function getEconomicSnapshot(): EconSnapshot | null {
  return snapshot;
}

export function getEconomicError(): string | null {
  return error;
}

export function subscribeEconomic(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useEconomicStore(): { data: EconSnapshot | null; error: string | null } {
  const data = useSyncExternalStore(subscribeEconomic, getEconomicSnapshot, getEconomicSnapshot);
  const err = useSyncExternalStore(subscribeEconomic, getEconomicError, getEconomicError);
  return { data, error: err };
}
