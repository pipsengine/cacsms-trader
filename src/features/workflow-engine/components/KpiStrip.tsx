import type { WorkflowSnapshot } from '../types/workflow';

export function KpiStrip({ d }: { d: WorkflowSnapshot }) {
  const k = d.kpis;
  const rows: { v: string; l: string; tone?: string; title: string }[] = [
    { v: String(k.monitored), l: 'Instruments monitored', title: '28 FX pairs + XAUUSD' },
    { v: `${k.liveEligible}/${k.monitored}`, l: 'Live-eligible (Stage 1)', tone: k.liveEligible ? '' : 'warn', title: 'Valid + fresh quote with READY history' },
    { v: String(k.readyCandidates), l: 'Ready for execution', tone: k.readyCandidates ? 'ok' : '', title: 'Stage 8 authorized with a clear live path and new entries allowed' },
    { v: String(k.openPositions), l: 'Open positions', title: 'Broker-confirmed Stage 9 positions' },
    { v: String(k.waitingInstruments), l: 'Waiting instruments', title: 'Held at a gate waiting for a condition (e.g. market open, promotion, confirmation)' },
    { v: String(k.blockedInstruments), l: 'Blocked instruments', tone: k.blockedInstruments ? 'warn' : '', title: 'Instruments held by a BLOCKED or STALE gate — not an engine fault' },
    { v: String(k.engineErrors), l: 'Engine errors', tone: k.engineErrors ? 'bad' : 'ok', title: 'Stage engines currently in ERROR or OFFLINE' },
    { v: String(k.degradedStages), l: 'Degraded stages', tone: k.degradedStages ? 'warn' : '', title: 'Stage engines running outside their SLA' },
  ];
  return (
    <div className="kpis">
      {rows.map((r) => (
        <div className={`kpi ${r.tone ?? ''}`} key={r.l} title={r.title}>
          <b>{r.v}</b>
          <span>{r.l}</span>
        </div>
      ))}
    </div>
  );
}
