import type { WorkflowSnapshot } from '../types/workflow';

export function KpiStrip({ d }: { d: WorkflowSnapshot }) {
  const ready = d.instruments.filter((x) => x.decision === 'READY').length;
  const blocked = d.instruments.filter((x) => x.decision === 'BLOCKED').length;
  const rows: [string, string][] = [
    [String(d.instruments.length), 'Instruments monitored'],
    [String(d.stages.length), 'Pipeline stages'],
    [String(ready), 'Ready candidates'],
    [String(blocked), 'Blocked'],
    [String(d.engine.queueDepth), 'Event queue'],
    [`${d.engine.throughput}/m`, 'Throughput'],
    [String(d.engine.errors), 'Runtime errors'],
    [d.engine.mode, 'Execution mode'],
  ];
  return (
    <div className="kpis">
      {rows.map(([v, l]) => (
        <div className="kpi" key={l}>
          <b>{v}</b>
          <span>{l}</span>
        </div>
      ))}
    </div>
  );
}
