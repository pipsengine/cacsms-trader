import { Copy, RefreshCw } from 'lucide-react';
import type { AnalysisMode, StripTf } from '../../types';
import type { AnalysisResult, Timeframe } from '../types';

export function PageHeader({
  a,
  engineLive,
  updated,
  dataQuality,
}: {
  a: AnalysisResult;
  engineLive: boolean;
  updated: string;
  dataQuality?: string;
}) {
  return (
    <div className="pageHead">
      <div>
        <h1>
          AI Chart Analysis <span>BETA</span>
        </h1>
        <p>
          Top-down interpretation over Channel, Supertrend, Opportunity Framework, P1/P2 and ConfirmationEngine — analysis
          only, no execution authority.
        </p>
      </div>
      <div className="headMeta">
        <b className="live">{engineLive ? '● ENGINE LIVE' : '● ENGINE OFFLINE'}</b>
        <div>
          <small>Last analysis</small>
          <strong>{updated}</strong>
          <a href={`#${a.analysisId}`}>{a.analysisId}</a>
          {dataQuality && dataQuality !== 'VALID' ? <small>Data: {dataQuality}</small> : null}
        </div>
      </div>
    </div>
  );
}

const MODES: { v: AnalysisMode; label: string }[] = [
  { v: 'FULL_ANALYSIS', label: 'FULL ANALYSIS' },
  { v: 'STRUCTURE', label: 'STRUCTURE' },
  { v: 'OPPORTUNITY', label: 'OPPORTUNITY' },
  { v: 'CONFIRMATION', label: 'CONFIRMATION' },
  { v: 'CONTINUATION', label: 'CONTINUATION' },
  { v: 'BREAKOUT', label: 'BREAKOUT' },
  { v: 'REVERSAL', label: 'REVERSAL' },
];

const LOOKBACKS = [500, 350, 250, 120];

export function Controls({
  a,
  tf,
  onTf,
  symbols,
  symbol,
  onSymbol,
  mode,
  onMode,
  lookback,
  onLookback,
  autonomous,
  onAutonomous,
  persist,
  onPersist,
  pollSec,
  onRefresh,
  loading,
  onCopyId,
}: {
  a: AnalysisResult;
  tf: Timeframe;
  onTf: (v: Timeframe) => void;
  symbols: string[];
  symbol: string;
  onSymbol: (s: string) => void;
  mode: AnalysisMode;
  onMode: (m: AnalysisMode) => void;
  lookback: number;
  onLookback: (n: number) => void;
  autonomous: boolean;
  onAutonomous: (v: boolean) => void;
  persist: boolean;
  onPersist: (v: boolean) => void;
  pollSec: number;
  onRefresh: () => void;
  loading: boolean;
  onCopyId: () => void;
}) {
  return (
    <div className="controls">
      <Field label="Symbol">
        <select value={symbol} onChange={(e) => onSymbol(e.target.value)}>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s.startsWith('XAU') ? '🟡 ' : ''}
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Mode">
        <select value={mode} onChange={(e) => onMode(e.target.value as AnalysisMode)}>
          {MODES.map((m) => (
            <option key={m.v} value={m.v}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Primary TF">
        <select value={tf} onChange={(e) => onTf(e.target.value as Timeframe)}>
          {a.timeframes.map((x) => (
            <option key={x.timeframe} value={x.timeframe}>
              {x.timeframe}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Lookback">
        <select value={lookback} onChange={(e) => onLookback(Number(e.target.value))}>
          {LOOKBACKS.map((n) => (
            <option key={n} value={n}>
              {n} candles
            </option>
          ))}
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" checked={autonomous} onChange={(e) => onAutonomous(e.target.checked)} /> Auto analyse (
        {pollSec}s)
      </label>
      <label className="check">
        <input type="checkbox" checked={persist} onChange={(e) => onPersist(e.target.checked)} /> Persist to library
      </label>
      <button type="button" className="refresh" onClick={onRefresh} disabled={loading}>
        <RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh
      </button>
      <div className="analysisId">
        <small>Analysis ID</small>
        <div>
          {a.analysisId}
          <button type="button" className="iconCopy" onClick={onCopyId} aria-label="Copy ID">
            <Copy size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
