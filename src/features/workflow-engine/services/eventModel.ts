import type { TradingEvent } from '../../../services/eventBus';
import type { EventClass, EventTag, WorkflowEvent } from '../types/workflow';

const CANDLE = new Set(['MN_CLOSE', 'W1_CLOSE', 'D1_CLOSE', 'H8_CLOSE', 'H1_CLOSE', 'M15_CLOSE', 'M5_CLOSE', 'TICK']);

const s = (v: unknown) => (typeof v === 'string' ? v : '');

/** Important decisions and executions get a tag so they stand out; everything else is classified by type and payload. */
function tagOf(e: TradingEvent, detail: string): EventTag | null {
  const p = e.payload;
  const state = s(p.state);
  switch (e.type) {
    case 'SCANNER_CHANGE':
      if (!e.symbol) return null;
      if (state === 'PROMOTED') return 'PROMOTION';
      return /PROMOTED\//.test(detail) ? 'DEMOTION' : null;
    case 'DIRECTION_CHANGE':
      if (state === 'INVALIDATED') return 'INVALIDATION';
      if (state === 'CONFLICT') return 'REJECTION';
      return null;
    case 'STRUCTURE_CHANGE':
    case 'CHANNEL_BREAK':
      return /INVALIDATED/.test(detail) && e.symbol ? 'INVALIDATION' : null;
    case 'CONFIRMATION_CHANGE':
      if (state === 'CONFIRMED') return 'H1_CONFIRM';
      if (state === 'REJECTED') return 'REJECTION';
      if (state === 'INVALIDATED') return 'INVALIDATION';
      return null;
    case 'RISK_CHANGE':
      if (state === 'AUTHORIZED') return 'AUTHORIZATION';
      if (state.endsWith('_BLOCKED')) return 'RISK_VETO';
      if (state === 'EXPIRED') return 'INVALIDATION';
      return null;
    case 'POSITION_EVENT': {
      if (p.control !== undefined) return 'CONTROL';
      if (p.stage10 !== undefined || /closed ·/.test(detail)) return 'EXIT';
      const order = s(p.orderState);
      const pos = s(p.positionState);
      if (order === 'REJECTED') return 'BROKER_REJECT';
      if (pos === 'CLOSED' || pos === 'EXIT_PENDING') return 'EXIT';
      if (order === 'FILLED' || order === 'PARTIALLY_FILLED' || pos === 'OPEN' || pos === 'PROTECTED') return 'FILL';
      if (order === 'SUBMITTING' || order === 'ACKNOWLEDGED') return 'MT5_SUBMIT';
      return null;
    }
    case 'RISK_EVENT':
      return p.control !== undefined || p.audit === true ? 'CONTROL' : null;
    default:
      return null;
  }
}

function classOf(e: TradingEvent, tag: EventTag | null): EventClass {
  const p = e.payload;
  const sev = s(p.severity).toUpperCase();
  if (sev === 'ERROR' || tag === 'BROKER_REJECT') return 'CRITICAL';
  if (tag === 'CONTROL') {
    const c = s(p.control);
    return c === 'EMERGENCY_STOP' || c === 'MT5_DISCONNECTED' || p.critical === true ? 'CRITICAL' : 'WARNING';
  }
  if (e.type === 'POSITION_EVENT') return 'EXECUTION';
  if (tag) return tag === 'RISK_VETO' || tag === 'INVALIDATION' || tag === 'REJECTION' || tag === 'DEMOTION' ? 'WARNING' : 'DECISION';
  if (sev === 'WARNING' || e.type === 'SPREAD_SPIKE' || (e.type === 'RISK_EVENT' && sev !== 'INFO' && sev !== 'SUCCESS')) return 'WARNING';
  if (CANDLE.has(e.type) || e.type === 'DATA_EVENT') return 'TRACE';
  // Per-instrument stage changes are decisions of lower weight; run summaries are routine information.
  if (e.symbol && ['SCANNER_CHANGE', 'STRUCTURE_CHANGE', 'DIRECTION_CHANGE', 'CONFIRMATION_CHANGE', 'RISK_CHANGE', 'CHANNEL_BREAK'].includes(e.type)) return 'DECISION';
  if (e.type === 'CHANNEL_APPROACH') return 'INFO';
  return 'INFO';
}

export function toWorkflowEvent(e: TradingEvent): WorkflowEvent {
  const p = e.payload;
  const detail = s(p.detail) || s(p.reason) || e.type.replace(/_/g, ' ');
  const tag = tagOf(e, detail);
  return {
    id: e.id,
    time: e.at,
    cls: classOf(e, tag),
    tag,
    stage: typeof p.stage === 'number' ? p.stage : 1,
    symbol: e.symbol,
    event: e.type,
    detail,
    source: s(p.source) || (e.id.startsWith('mt5-') ? 'mt5' : e.id.startsWith('wf-') ? 'workflow' : 'bus'),
  };
}

export type EventGroup = { key: string; head: WorkflowEvent; items: WorkflowEvent[] };

/** Collapse runs of consecutive low-value events (TRACE / INFO, same type + stage) into one expandable row; history is kept in `items`. */
export function collapseEvents(events: WorkflowEvent[]): EventGroup[] {
  const out: EventGroup[] = [];
  for (const e of events) {
    const low = (e.cls === 'TRACE' || e.cls === 'INFO') && !e.tag;
    const last = out[out.length - 1];
    if (low && last && (last.head.cls === 'TRACE' || last.head.cls === 'INFO') && !last.head.tag && last.head.event === e.event && last.head.stage === e.stage) {
      last.items.push(e);
      continue;
    }
    out.push({ key: e.id, head: e, items: [e] });
  }
  return out;
}
