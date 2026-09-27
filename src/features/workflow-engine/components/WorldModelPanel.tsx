import { useState } from 'react';
import type { WorldModelRecord } from '../types/workflow';
import { DecisionBadge, FreshTag } from './chips';
import { ago, stamp } from '../utils/format';

export function WorldModelPanel({ rows, symbol, onSymbol }: { rows: WorldModelRecord[]; symbol: string; onSymbol: (s: string) => void }) {
  const r = rows.find((x) => x.symbol === symbol) ?? rows[0];
  const [tileKey, setTileKey] = useState<string | null>(null);
  if (!r) return null;
  const tile = r.tiles.find((t) => t.key === tileKey);
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">SHARED MARKET WORLD MODEL</span>
          <h2>{r.symbol} state</h2>
        </div>
        <div className="filters">
          <DecisionBadge d={r.decision} />
          <select value={r.symbol} onChange={(e) => onSymbol(e.target.value)} aria-label="World model instrument">
            {rows.map((x) => (
              <option key={x.symbol}>{x.symbol}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="world-grid">
        {r.tiles.map((t) => (
          <button
            type="button"
            key={t.key}
            className={`world-cell f-${t.freshness.toLowerCase()}${tileKey === t.key ? ' selected' : ''}`}
            onClick={() => setTileKey(tileKey === t.key ? null : t.key)}
            title={t.updatedAt ? `Updated ${stamp(t.updatedAt)}` : 'No timestamp'}
          >
            <small>
              {t.label} <em>S{t.stage}</em>
            </small>
            <b>{t.value}</b>
            <span>{t.sub}</span>
            <span className="cell-foot">
              {t.freshness === 'LIVE' ? <span className="fresh live">LIVE</span> : t.freshness === 'NONE' ? <span className="fresh none">NO DATA</span> : <FreshTag f={t.freshness} />}
              <i>{ago(t.updatedAt)}</i>
            </span>
          </button>
        ))}
      </div>
      {tile && (
        <div className="evidence">
          <h4>
            {tile.label} evidence · Stage {tile.stage} · {tile.updatedAt ? stamp(tile.updatedAt) : 'no timestamp'}
          </h4>
          {tile.evidence.length ? (
            <ul>
              {tile.evidence.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">The stage has published no evidence for {r.symbol}.</p>
          )}
        </div>
      )}
    </section>
  );
}
