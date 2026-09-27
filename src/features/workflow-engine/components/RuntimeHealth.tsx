import type { StageRuntime } from '../types/workflow';
import { HealthChip, StateChip } from './chips';
import { age, ago, ms } from '../utils/format';

export function RuntimeHealth({ stages, onSelect }: { stages: StageRuntime[]; onSelect: (id: number) => void }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">OBSERVABILITY</span>
          <h2>Stage Health & SLA</h2>
        </div>
        <span className="muted">Health is derived from reachability, publication freshness, engine run status and latency against each stage's own SLA</span>
      </div>
      <div className="health-grid">
        {stages.map((s) => {
          const hist = s.latencyHistory.length ? s.latencyHistory : s.latencyMs != null ? [s.latencyMs] : [];
          const peak = Math.max(1, ...hist, s.sla.latencyMs ?? 0);
          return (
            <button type="button" className={`health h-${s.health.toLowerCase()}`} key={s.id} onClick={() => onSelect(s.id)} title={s.healthReason}>
              <div className="health-top">
                <b>S{s.id}</b>
                <span>{s.name}</span>
              </div>
              <div className="health-chips">
                <HealthChip health={s.health} />
                <StateChip state={s.state} />
              </div>
              <div className="spark" title={`${s.latencyLabel} · last ${hist.length} run(s)`}>
                {hist.length ? hist.map((v, i) => <i key={i} className={s.sla.latencyMs != null && v > s.sla.latencyMs ? 'over' : ''} style={{ height: `${Math.max(8, Math.round((v / peak) * 100))}%` }} />) : <i className="none" style={{ height: '8%' }} />}
              </div>
              <dl>
                <dt>Latency</dt>
                <dd className={s.sla.latencyOk === false ? 'bad' : ''}>
                  {ms(s.latencyMs)}
                  {s.sla.latencyMs != null && <small> / {ms(s.sla.latencyMs)}</small>}
                </dd>
                <dt>Freshness</dt>
                <dd className={s.sla.freshnessOk === false ? 'bad' : ''}>
                  {age(s.freshnessSec)}
                  {s.sla.freshnessSec != null && <small> / {age(s.sla.freshnessSec)}</small>}
                </dd>
                <dt>Errors</dt>
                <dd className={s.errors ? 'warn' : ''}>
                  {s.errors ?? '—'}
                  {s.runs != null && <small> / {s.runs} runs</small>}
                </dd>
                <dt>Last success</dt>
                <dd>{ago(s.lastSuccessAt)}</dd>
              </dl>
              <small className="sla-note">{s.sla.note}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
