import { lifecycleTone, type FrameworkHypothesis } from '../../workflow-engine/services/frameworkClient';
import { KPI_DETAIL, type KpiKey, hypothesesForKpi, lifecycleDisplay, structureLabel } from '../utils';

type CardDef = { key: KpiKey; label: string; value: number; sub?: string };

export function KpiCards({
  hypotheses,
  cards,
  focus,
  onFocus,
  onOpen,
}: {
  hypotheses: FrameworkHypothesis[];
  cards: CardDef[];
  focus: KpiKey | null;
  onFocus: (key: KpiKey | null) => void;
  onOpen: (id: string) => void;
}) {
  const detailRows = focus ? hypothesesForKpi(hypotheses, focus).slice(0, 40) : [];
  const meta = focus ? KPI_DETAIL[focus] : null;

  return (
    <div className="to-kpi-block">
      <div className="to-kpis">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`to-kpi-card metric card${focus === c.key ? ' on' : ''}`}
            aria-expanded={focus === c.key}
            onClick={() => onFocus(focus === c.key ? null : c.key)}
          >
            <div className="muted">{c.label}</div>
            <div className="metric-row">
              <strong>{c.value}</strong>
            </div>
            {c.sub && <small>{c.sub}</small>}
          </button>
        ))}
      </div>

      {focus && meta && (
        <div className="to-kpi-detail card" role="region" aria-label={`${meta.title} details`}>
          <header className="to-kpi-detail-head">
            <div>
              <h3>{meta.title}</h3>
              <p className="muted">{meta.blurb}</p>
            </div>
            <button type="button" className="to-close small" onClick={() => onFocus(null)} aria-label="Close details">
              ×
            </button>
          </header>
          {detailRows.length === 0 ? (
            <p className="muted empty-inline">No opportunities in this bucket right now.</p>
          ) : (
            <ul className="to-kpi-list">
              {detailRows.map((h) => (
                <li key={h.opportunityId}>
                  <button type="button" className="to-kpi-row" onClick={() => onOpen(h.opportunityId)}>
                    <span className="sym">
                      <b>{h.symbol}</b>
                      <small>{h.opportunityType}</small>
                    </span>
                    <span className={`to-side ${h.side === 'BUY' ? 'buy' : 'sell'}`}>{h.side}</span>
                    <span className="muted struct">{structureLabel(h)}</span>
                    <span className={`to-life t-${lifecycleTone(h.lifecycle)}`}>{lifecycleDisplay(h.lifecycle)}</span>
                    <span className={`to-mode m-${h.mode.toLowerCase()}`}>{h.mode}</span>
                    <span className="muted">S{h.stage}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {detailRows.length >= 40 && <p className="muted">Showing first 40 — use the table below for the full filtered list.</p>}
        </div>
      )}
    </div>
  );
}
