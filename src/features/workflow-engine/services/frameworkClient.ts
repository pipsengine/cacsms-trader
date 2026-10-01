import { useEffect, useState } from 'react';

/** Mirrors bridge/mt5/opportunity_framework.py. The confirmation matrix lives on the backend; the UI only renders it. */

export type FrameworkMode = 'PRODUCTION' | 'SHADOW' | 'OBSERVE';

export interface FrameworkEvidenceItem {
  ok: boolean | null;
  kind: 'REQUIRED' | 'OPTIONAL' | 'NOT_REQUIRED' | 'DEFERRED' | 'GATE';
  evidence: string;
  text: string;
}

export interface FrameworkStageCard {
  name?: string;
  status: string;
  detail: string;
  blocksNewEntries?: boolean;
}

export interface FrameworkRoom {
  entry?: number;
  invalidation?: number;
  target?: number | null;
  targetKind?: string | null;
  rewardRisk?: number | null;
  minRR?: number;
  ok?: boolean;
  targets?: { kind: string; price: number }[];
}

export interface FrameworkHypothesis {
  opportunityId: string;
  opportunityType: string;
  opportunityCode: string;
  opportunityName: string;
  badge: string;
  opportunityContext: string[];
  route: string;
  mode: FrameworkMode;
  symbol: string;
  direction: 'BULLISH' | 'BEARISH' | 'UNKNOWN';
  side: 'BUY' | 'SELL';
  parentTimeframe?: string | null;
  childTimeframe?: string | null;
  executionTimeframe?: string | null;
  channelId?: string | null;
  channelRole?: string | null;
  triggerType?: string;
  triggerTime?: number | null;
  triggerPrice?: number | null;
  detectorState: string;
  confirmationContractId: string;
  confirmationState: string;
  requiredEvidence: string[];
  satisfiedEvidence: string[];
  missingEvidence: string[];
  invalidationConditions: string[];
  invalidationReason?: string | null;
  confidence: number;
  entryQuality?: string | null;
  room?: FrameworkRoom | null;
  campaignId?: string | null;
  episodeId?: string | null;
  regime: { label: string; compatibility: string };
  strength: string;
  stage6: string;
  dataFreshness: { state: string; lastBarTs?: number | null; timeframe?: string | null };
  scannerRank?: number | null;
  legs: { p1: boolean; p2: boolean };
  lifecycle: string;
  waitingFor?: string | null;
  stage: number;
  stages: Record<string, FrameworkStageCard>;
  why: FrameworkEvidenceItem[];
  whyNotReady: string[];
  nextStep: string;
  revision: string;
  relationships: { to: string; type: string; kind: string }[];
  riskGroup: string;
  riskRole: 'PRIMARY' | 'SHARED_BUDGET';
  TiTLevel?: string | null;
  evidence: Record<string, boolean | null>;
  confirmation: { headline: Record<string, string> };
}

export interface FrameworkSummary {
  universe: number;
  scanned: number;
  hypotheses: number;
  byType: Record<string, number>;
  byLifecycle: Record<string, number>;
  byMode: Record<string, number>;
  lightScan: { instruments: number; escalated: number; byType: Record<string, number> };
  op01: Record<string, number>;
  legacyNormal: number;
  shadowNeverQualified: boolean;
}

export interface FrameworkState {
  frameworkVersion: string;
  contractVersion: string;
  generatedAt: string;
  summary: FrameworkSummary;
  hypotheses: FrameworkHypothesis[];
  errors: { detector: string; symbol?: string | null; opportunityType?: string | null; error: string }[];
  durationMs: number;
  productionLimits: { operatorPositionLimit: number; xauReservePct: number };
  persistError?: string;
}

export interface FrameworkResponse {
  ok: boolean;
  framework: FrameworkState | null;
  routes: Record<string, { mode: FrameworkMode; source: string }>;
  shadowStage8: Record<string, { setupState?: string; setupReasonCode?: string; setupReason?: string }>;
}

export interface FrameworkContract {
  contractId: string;
  opportunityType: string;
  code: string;
  name: string;
  badge: string;
  requiredEvidence: string[];
  optionalEvidence: string[];
  notRequired: string[];
  incompatible: string[];
  headline: Record<string, string>;
  confirmationTimeframe: string;
  invalidation: string[];
  expiry: string;
  legs: { p1: boolean; p2: boolean; p1Meaning: string; p2Meaning: string };
}

export interface FrameworkMatrix {
  ok: boolean;
  frameworkVersion: string;
  contractVersion: string;
  evidence: Record<string, { label: string; stage: number | string }>;
  contracts: FrameworkContract[];
  routes: Record<string, { mode: FrameworkMode; source: string }>;
}

const BASE = (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || '/mt5-bridge';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`MT5 bridge error ${res.status}`);
  return (await res.json()) as T;
}

export const fetchFramework = (symbol?: string) =>
  get<FrameworkResponse>(`/opportunity/framework${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`);

export const fetchFrameworkContracts = () => get<FrameworkMatrix>('/opportunity/contracts');

/** Polls the backend framework state. `symbol` narrows the payload for compact per-instrument views. */
export function useOpportunityFramework(symbol?: string, intervalMs = 15000) {
  const [data, setData] = useState<FrameworkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchFramework(symbol)
        .then((r) => {
          if (!alive) return;
          setData(r);
          setError(null);
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const t = window.setInterval(load, intervalMs);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [symbol, intervalMs]);
  return { data, error };
}

export function useFrameworkContracts() {
  const [matrix, setMatrix] = useState<FrameworkMatrix | null>(null);
  useEffect(() => {
    let alive = true;
    fetchFrameworkContracts()
      .then((m) => alive && setMatrix(m))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return matrix;
}

export const lifecycleTone = (lifecycle: string): 'ok' | 'warn' | 'bad' | 'info' | 'muted' =>
  lifecycle === 'READY_FOR_RISK' || lifecycle === 'AUTHORIZED' || lifecycle === 'OPEN' || lifecycle === 'EXECUTING'
    ? 'ok'
    : lifecycle === 'BLOCKED' || lifecycle === 'INVALIDATED'
      ? 'bad'
      : lifecycle === 'WAITING' || lifecycle === 'CONFIRMING' || lifecycle === 'TRIGGER_REACHED'
        ? 'warn'
        : lifecycle === 'EXPIRED' || lifecycle === 'COMPLETED'
          ? 'muted'
          : 'info';
