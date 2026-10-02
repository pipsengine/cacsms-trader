import { useEffect, useRef, useState } from 'react';
import { Archive, BookOpen, Clock3, RefreshCw, Search } from 'lucide-react';
import { fetchAiAnalysisDetail } from '../ai-chart-analysis/aiChartClient';
import { mapPayloadToAnalysisView } from '../ai-chart-analysis/figma/mapAnalysis';
import { CandleChart } from '../ai-chart-analysis/figma/CandleChart';
import { EvidenceGrid, Pill, TFStrip } from '../ai-chart-analysis/figma/Shared';
import type { AnalysisView } from '../ai-chart-analysis/figma/types';
import {
  refreshAiLibrary,
  setAiLibraryFilters,
  startAiLibraryStore,
  useAiLibraryStore,
  AI_LIBRARY_POLL_MS,
} from './aiLibraryStore';

export function LibraryFigmaWorkspace() {
  useEffect(() => startAiLibraryStore(), []);

  const { summary, rows, loading, error, filters, lastFetchAt } = useAiLibraryStore();
  const [selected, setSelected] = useState<AnalysisView | null>(null);
  const [selectedTf, setSelectedTf] = useState<AnalysisView['primaryTf']>('H1');

  const open = async (id: string) => {
    const detail = await fetchAiAnalysisDetail(id);
    if (detail?.ok) {
      const view = mapPayloadToAnalysisView(detail);
      setSelected(view);
      setSelectedTf(view.primaryTf);
    }
  };

  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !rows.length) return;
    autoOpened.current = true;
    void open(rows[0].analysisId);
  }, [rows]);

  return (
    <>
      <div className="titleRow">
        <div>
          <p className="eyebrow">MARKET INTELLIGENCE / REFERENCE</p>
          <h1>AI Analysis Library</h1>
          <p>Immutable annotated market records, reasoning, setup evolution and outcomes.</p>
        </div>
        <Pill tone="green">
          <Archive /> {summary.total ?? rows.length} STORED ANALYSES
        </Pill>
      </div>

      {error && <div className="aca-figma-banner err">{error}</div>}

      <div className="stats">
        <div>
          <small>TOTAL ANALYSES</small>
          <b>{summary.total ?? 0}</b>
        </div>
        <div>
          <small>ACTIVE</small>
          <b>{summary.active ?? 0}</b>
        </div>
        <div>
          <small>CONFIRMED</small>
          <b>{summary.confirmed ?? 0}</b>
        </div>
        <div>
          <small>INVALIDATED</small>
          <b>{summary.invalidated ?? 0}</b>
        </div>
        <div>
          <small>COMPLETED</small>
          <b>{summary.completed ?? 0}</b>
        </div>
      </div>

      <section className="panel filters">
        <div className="search">
          <Search />
          <input
            placeholder="Search analysis ID or symbol"
            value={filters.query}
            onChange={(e) => setAiLibraryFilters({ query: e.target.value })}
          />
        </div>
        <select value={filters.symbol} onChange={(e) => setAiLibraryFilters({ symbol: e.target.value.toUpperCase() })}>
          <option value="">All symbols</option>
          {[...new Set(rows.map((r) => r.symbol))].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={filters.status} onChange={(e) => setAiLibraryFilters({ status: e.target.value })}>
          <option value="">All status</option>
          {['WATCHING', 'SETUP_DEVELOPING', 'CONFIRMED', 'INVALIDATED', 'COMPLETED', 'EXPIRED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="button" className="refresh" onClick={() => refreshAiLibrary()} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} /> Sync ({AI_LIBRARY_POLL_MS / 1000}s)
        </button>
        <small style={{ alignSelf: 'center', color: '#627994' }}>
          Last sync {lastFetchAt ? new Date(lastFetchAt).toLocaleTimeString() : '—'}
        </small>
      </section>

      <div className="libraryLayout">
        <section className="panel records">
          <div className="panelTitle">
            <span>Analysis records</span>
            <small>Click to reconstruct</small>
          </div>
          {rows.map((a) => (
            <button
              type="button"
              className={'record ' + (selected?.id === a.analysisId ? 'selected' : '')}
              onClick={() => void open(a.analysisId)}
              key={a.analysisId}
            >
              <div>
                <b>{a.symbol}</b>
                <small>{a.analysisId}</small>
              </div>
              <div>
                <span>{a.opportunity ?? '—'}</span>
                <small>{a.timestamp}</small>
              </div>
              <Pill tone={a.direction === 'BULLISH' ? 'green' : 'red'}>{a.direction}</Pill>
              <strong>{a.confidence ?? '—'}%</strong>
              <Pill tone={a.status === 'INVALIDATED' ? 'red' : 'amber'}>{(a.status ?? '').replaceAll('_', ' ')}</Pill>
            </button>
          ))}
          {!rows.length && !loading && <p style={{ padding: 16, color: '#627994' }}>No stored analyses yet.</p>}
        </section>

        {selected && (
          <section className="detail">
            <div className="panel detailHead">
              <div>
                <small>RECONSTRUCTED ANALYSIS</small>
                <h2>
                  {selected.symbol} · {selected.opportunity}
                </h2>
                <p>
                  {selected.id} · Created {selected.created}
                </p>
              </div>
              <div>
                <Pill tone={selected.direction === 'BULLISH' ? 'green' : 'red'}>{selected.direction}</Pill>{' '}
                <Pill>{selected.status.replace(/_/g, ' ')}</Pill>
              </div>
            </div>
            <TFStrip analysis={selected} selected={selectedTf} onSelect={setSelectedTf} />
            <section className="panel chartPanel">
              <div className="panelTitle">
                <span>
                  <BookOpen /> Preserved annotated chart
                </span>
                <Pill>
                  <Clock3 /> DATA AT DECISION TIME ONLY
                </Pill>
              </div>
              <CandleChart analysis={selected} />
            </section>
            <section className="panel reasoning">
              <div className="panelTitle">
                <span>Preserved thesis & reasoning</span>
                <Pill>{selected.confidence}% CONFIDENCE</Pill>
              </div>
              <p>{selected.thesis}</p>
              <div className="reasonGrid">
                <div>
                  <small>INVALIDATION</small>
                  <b>{selected.invalidation}</b>
                </div>
                <div>
                  <small>TARGET LOGIC</small>
                  <b>{selected.target}</b>
                </div>
                <div>
                  <small>AI ↔ ENGINE</small>
                  <b>{selected.agreement}</b>
                </div>
              </div>
            </section>
            <EvidenceGrid analysis={selected} />
          </section>
        )}
      </div>
    </>
  );
}
