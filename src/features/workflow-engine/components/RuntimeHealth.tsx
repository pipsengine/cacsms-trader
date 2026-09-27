import type { StageRuntime } from '../types/workflow';

export function RuntimeHealth({ stages }: { stages: StageRuntime[] }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">OBSERVABILITY</span>
          <h2>Stage Health & SLA</h2>
        </div>
      </div>
      <div className="health-grid">
        {stages.map((s) => {
          const history = s.latencyHistory?.length
            ? s.latencyHistory
            : s.latencyMs > 0
              ? [s.latencyMs]
              : [];
          const peak = Math.max(1, ...history, s.latencyMs);
          return (
            <div className="health" key={s.id}>
              <div>
                <b>S{s.id}</b>
                <span>{s.name}</span>
              </div>
              <strong>{s.latencyMs}ms</strong>
              <div className="spark">
                {history.length
                  ? history.map((ms, i) => (
                      <i key={i} style={{ height: `${Math.max(8, Math.round((ms / peak) * 100))}%` }} />
                    ))
                  : (
                      <i style={{ height: '8%' }} />
                    )}
              </div>
              <small>
                {s.freshnessSec}s freshness · {s.failed} failures
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
