import type { FrameworkHypothesis, FrameworkSummary } from '../workflow-engine/services/frameworkClient';
import { OP_FAMILY, TERMINAL_LIFECYCLES, TRIGGER_LABELS } from './constants';

export type TabKey =
  | 'ALL ACTIVE'
  | 'APPROACHING'
  | 'CONFIRMING'
  | 'READY'
  | 'AUTHORIZED'
  | 'SHADOW'
  | 'HISTORY';

export type SortKey = 'symbol' | 'opportunity' | 'state' | 'confidence' | 'rr' | 'stage' | 'updated';

export function triggerLabel(triggerType?: string | null): string {
  if (!triggerType) return '—';
  return TRIGGER_LABELS[triggerType] ?? triggerType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function structureLabel(h: FrameworkHypothesis): string {
  const p = h.parentTimeframe;
  const c = h.childTimeframe;
  const e = h.executionTimeframe;
  if (p && c && c !== e) return `${p} → ${c} → ${e}`;
  if (p && e) return `${p} → ${e}`;
  if (p && c) return `${p} → ${c}`;
  return e ?? '—';
}

export function lifecycleDisplay(lifecycle: string): string {
  return lifecycle.replace(/_/g, ' ');
}

export function familyForType(opportunityType: string): string | null {
  for (const [family, types] of Object.entries(OP_FAMILY)) {
    if (types.includes(opportunityType)) return family;
  }
  return null;
}

const APPROACHING = new Set(['TRIGGER_APPROACHING', 'DISCOVERED', 'WATCHING']);
const CONFIRMING = new Set(['TRIGGER_REACHED', 'CONFIRMING', 'WAITING']);

export type KpiKey = 'total' | 'approaching' | 'confirming' | 'ready' | 'authorized' | 'production' | 'shadow' | 'observe';

export const KPI_DETAIL: Record<
  KpiKey,
  { title: string; blurb: string; tab: TabKey; mode?: 'PRODUCTION' | 'SHADOW' | 'OBSERVE' }
> = {
  total: {
    title: 'Total active',
    blurb: 'Non-terminal hypotheses across all modes — discovery through authorization pipeline.',
    tab: 'ALL ACTIVE',
  },
  approaching: {
    title: 'Approaching',
    blurb: 'Near trigger: watching, discovered, or boundary/trigger approach states.',
    tab: 'APPROACHING',
  },
  confirming: {
    title: 'Confirming',
    blurb: 'Contract evaluation in progress — required evidence still being satisfied.',
    tab: 'CONFIRMING',
  },
  ready: {
    title: 'Ready for risk',
    blurb: 'Confirmation complete — handed to Stage 8 for capital authorization (not yet authorized).',
    tab: 'READY',
  },
  authorized: {
    title: 'Authorized',
    blurb: 'Stage 8 issued authorization — execution may consume on Stage 9.',
    tab: 'AUTHORIZED',
  },
  production: {
    title: 'Production',
    blurb: 'Routes enabled for real capital path when Stage 8 authorizes.',
    tab: 'ALL ACTIVE',
    mode: 'PRODUCTION',
  },
  shadow: {
    title: 'Shadow',
    blurb: 'Detected and audited — Stage 8 shadow pre-qualification only, never executable.',
    tab: 'SHADOW',
    mode: 'SHADOW',
  },
  observe: {
    title: 'Observe',
    blurb: 'Classification and audit only — not eligible for authorization.',
    tab: 'ALL ACTIVE',
    mode: 'OBSERVE',
  },
};

export function activeHypotheses(rows: FrameworkHypothesis[]): FrameworkHypothesis[] {
  return rows.filter((h) => !TERMINAL_LIFECYCLES.has(h.lifecycle));
}

export function hypothesesForKpi(rows: FrameworkHypothesis[], key: KpiKey): FrameworkHypothesis[] {
  const active = activeHypotheses(rows);
  switch (key) {
    case 'total':
      return active;
    case 'approaching':
      return active.filter((h) => APPROACHING.has(h.lifecycle));
    case 'confirming':
      return active.filter((h) => CONFIRMING.has(h.lifecycle));
    case 'ready':
      return active.filter((h) => h.lifecycle === 'READY_FOR_RISK');
    case 'authorized':
      return active.filter((h) => h.lifecycle === 'AUTHORIZED' || h.lifecycle === 'EXECUTING' || h.lifecycle === 'OPEN');
    case 'production':
      return active.filter((h) => h.mode === 'PRODUCTION');
    case 'shadow':
      return active.filter((h) => h.mode === 'SHADOW');
    case 'observe':
      return active.filter((h) => h.mode === 'OBSERVE');
    default:
      return active;
  }
}

export function tabMatch(h: FrameworkHypothesis, tab: TabKey): boolean {
  const lc = h.lifecycle;
  if (tab === 'HISTORY') return TERMINAL_LIFECYCLES.has(lc);
  if (TERMINAL_LIFECYCLES.has(lc)) return false;
  if (tab === 'SHADOW') return h.mode === 'SHADOW';
  if (tab === 'ALL ACTIVE') return true;
  if (tab === 'APPROACHING') return APPROACHING.has(lc) || lc === 'TRIGGER_APPROACHING';
  if (tab === 'CONFIRMING') return CONFIRMING.has(lc);
  if (tab === 'READY') return lc === 'READY_FOR_RISK';
  if (tab === 'AUTHORIZED') return lc === 'AUTHORIZED' || lc === 'EXECUTING' || lc === 'OPEN';
  return true;
}

export function kpiFromSummary(summary: FrameworkSummary | undefined, hypotheses: FrameworkHypothesis[]) {
  const active = hypotheses.filter((h) => !TERMINAL_LIFECYCLES.has(h.lifecycle));
  const by = summary?.byLifecycle ?? {};
  const count = (keys: string[]) => keys.reduce((n, k) => n + (by[k] ?? 0), 0);
  return {
    totalActive: active.length,
    approaching: count(['TRIGGER_APPROACHING', 'DISCOVERED', 'WATCHING', 'TRIGGER_REACHED']),
    confirming: count(['CONFIRMING', 'WAITING']),
    ready: by['READY_FOR_RISK'] ?? active.filter((h) => h.lifecycle === 'READY_FOR_RISK').length,
    authorized: count(['AUTHORIZED', 'EXECUTING', 'OPEN']),
    production: summary?.byMode?.PRODUCTION ?? active.filter((h) => h.mode === 'PRODUCTION').length,
    shadow: summary?.byMode?.SHADOW ?? active.filter((h) => h.mode === 'SHADOW').length,
    observe: summary?.byMode?.OBSERVE ?? active.filter((h) => h.mode === 'OBSERVE').length,
  };
}

export function pickXauPriority(hypotheses: FrameworkHypothesis[]): FrameworkHypothesis | null {
  const xau = hypotheses.filter((h) => h.symbol === 'XAUUSD' && !TERMINAL_LIFECYCLES.has(h.lifecycle));
  if (!xau.length) return null;
  const rank = (h: FrameworkHypothesis) => {
    const lc = h.lifecycle;
    if (lc === 'AUTHORIZED' || lc === 'EXECUTING' || lc === 'OPEN') return 100;
    if (lc === 'READY_FOR_RISK') return 90;
    if (lc === 'CONFIRMING' || lc === 'TRIGGER_REACHED') return 70;
    if (lc === 'TRIGGER_APPROACHING') return 50;
    return 30;
  };
  return [...xau].sort((a, b) => rank(b) - rank(a) || (b.confidence ?? 0) - (a.confidence ?? 0))[0];
}

export function filterHypotheses(
  rows: FrameworkHypothesis[],
  opts: {
    tab: TabKey;
    q: string;
    family: string;
    opType: string;
    direction: string;
    lifecycle: string;
    mode: string;
    stage: string;
    tf: string;
  },
): FrameworkHypothesis[] {
  const q = opts.q.trim().toLowerCase();
  return rows.filter((h) => {
    if (!tabMatch(h, opts.tab)) return false;
    if (opts.family !== 'ALL') {
      const fam = familyForType(h.opportunityType);
      if (fam !== opts.family) return false;
    }
    if (opts.opType !== 'ALL' && h.opportunityType !== opts.opType) return false;
    if (opts.direction === 'BUY' && h.side !== 'BUY') return false;
    if (opts.direction === 'SELL' && h.side !== 'SELL') return false;
    if (opts.lifecycle !== 'ALL' && h.lifecycle !== opts.lifecycle) return false;
    if (opts.mode !== 'ALL' && h.mode !== opts.mode) return false;
    if (opts.stage !== 'ALL' && String(h.stage) !== opts.stage) return false;
    if (opts.tf !== 'ALL') {
      const tfs = [h.parentTimeframe, h.childTimeframe, h.executionTimeframe].filter(Boolean);
      if (!tfs.includes(opts.tf)) return false;
    }
    if (q) {
      const hay = `${h.symbol} ${h.opportunityType} ${h.opportunityName} ${h.opportunityCode}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortHypotheses(rows: FrameworkHypothesis[], sort: SortKey, desc: boolean): FrameworkHypothesis[] {
  const mul = desc ? -1 : 1;
  const copy = [...rows];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case 'symbol':
        cmp = a.symbol.localeCompare(b.symbol);
        break;
      case 'opportunity':
        cmp = a.opportunityType.localeCompare(b.opportunityType);
        break;
      case 'state':
        cmp = a.lifecycle.localeCompare(b.lifecycle);
        break;
      case 'confidence':
        cmp = (a.confidence ?? 0) - (b.confidence ?? 0);
        break;
      case 'rr':
        cmp = (a.room?.rewardRisk ?? -1) - (b.room?.rewardRisk ?? -1);
        break;
      case 'stage':
        cmp = a.stage - b.stage;
        break;
      case 'updated':
        cmp = String(a.revision).localeCompare(String(b.revision));
        break;
      default:
        cmp = 0;
    }
    return cmp * mul;
  });
  return copy;
}

/** Stage cards for drawer — Economic Intelligence excluded from active gates (spec §7). */
export function visibleStageKeys(stages: FrameworkHypothesis['stages']): string[] {
  return Object.keys(stages)
    .filter((k) => k !== 'econ')
    .sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });
}
