export type Impact = 'HIGH' | 'MEDIUM' | 'LOW';
export type EventStatus = 'UPCOMING' | 'DUE' | 'RELEASED' | 'DELAYED' | 'CANCELLED';
export type EngineState =
  | 'NORMAL'
  | 'EVENT_WATCH'
  | 'PRE_EVENT_RESTRICTED'
  | 'EVENT_LOCK'
  | 'RELEASE_PROCESSING'
  | 'POST_EVENT_VOLATILITY'
  | 'STRUCTURE_REVALIDATION';
export type EconAction = 'ALLOW' | 'CAUTION' | 'REDUCE_RISK' | 'BLOCK_NEW_ENTRY' | 'MANAGE_EXISTING' | 'REVALIDATE' | 'RESUME';

export interface Surprise {
  available: boolean;
  rawDelta?: number;
  rawPct?: number;
  interpretation?: string;
  series?: string;
  reason?: string;
}

export interface EconEvent {
  id: string;
  scheduledAt: string;
  currency: string;
  country: string;
  title: string;
  impact: Impact;
  seriesKind: string;
  unit?: string | null;
  actual?: string | null;
  forecast?: string | null;
  previous?: string | null;
  status: EventStatus;
  surprise?: Surprise | null;
  sourceMode?: string;
  revision?: number;
}

export interface EconInstrument {
  symbol: string;
  state: EngineState;
  activeEventId: string | null;
  currency: string | null;
  impact: Impact | null;
  minutesToEvent: number | null;
  surprise: string | null;
  spreadCondition: string;
  volatilityCondition: string;
  restriction: EconAction;
  blocksNewEntries: boolean;
  revalidationRequired: boolean;
  reason: string;
  detail: {
    sourceMode?: string;
    calculatedAction?: EconAction;
    riskReductionFactor?: number;
    positionAction?: string;
    title?: string | null;
    closesPositions?: boolean;
    marketReactionScore?: number | null;
    marketReaction?: string;
    calendarFeedHealth?: string;
    mt5Health?: string;
    scheduledAt?: string | null;
    actual?: string | null;
    forecast?: string | null;
    previous?: string | null;
    releasePhase?: string | null;
  };
  updatedAt: string | null;
}

export interface EconHistory {
  eventKey: string;
  currency: string | null;
  title: string | null;
  samples: number;
  avgMove5m: number | null;
  avgMove15m: number | null;
  avgMove30m: number | null;
  avgMove1h: number | null;
  avgSpreadSpike: number | null;
  directionalBias: string;
}

export interface EconPolicy {
  enabled: boolean;
  providerUrlRef: string;
  providerTokenRef: string;
  providerConfigured: boolean;
  developmentMode: boolean;
  timezone: string;
  currencies: string[];
  impacts: Impact[];
  highPreWatchMin: number;
  highPreRestrictMin: number;
  highLockMin: number;
  highPostVolMin: number;
  highRevalidateMin: number;
  mediumPreCautionMin: number;
  mediumPostMin: number;
  lowWatchMin: number;
  maxSpreadMultiplier: number;
  volatilityAtr: number;
  xauSensitivity: string;
  riskReductionFactor: number;
  blockOnStaleFeed: boolean;
  staleAfterSec: number;
  developmentSample: boolean;
  machineCalendar: boolean;
  externalReference: boolean;
  reactionMovePips: number;
  reactionScoreMin: number;
}

export interface EconSources {
  calendar: 'LIVE' | 'DELAYED' | 'STALE' | 'DISCONNECTED' | 'NOT_CONFIGURED' | 'ERROR' | string;
  calendarReason?: string;
  sample?: boolean;
  lastSync: string | null;
  mt5: 'LIVE' | 'DELAYED' | 'DISCONNECTED' | string;
  external: 'AVAILABLE' | 'UNAVAILABLE' | string;
}

export interface EconAudit {
  id: number;
  type: string;
  eventId: string | null;
  symbol: string | null;
  severity: string;
  detail: string;
  createdAt: string | null;
}

export interface EconEngine {
  state: EngineState;
  sourceMode: string;
  reason: string;
  heartbeatAt: string | null;
  detail?: { sources?: EconSources };
}

export interface EconSnapshot {
  ok: boolean;
  generatedAt: string;
  engine: EconEngine;
  freshnessSeconds: number | null;
  policy: EconPolicy;
  events: EconEvent[];
  instruments: EconInstrument[];
  history: EconHistory[];
  audit: EconAudit[];
  universe: string[];
  sources?: EconSources;
}
