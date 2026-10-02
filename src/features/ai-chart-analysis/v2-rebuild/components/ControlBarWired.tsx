import { ChevronDown, Copy, RefreshCw } from 'lucide-react';
import type { AnalysisMode, StripTf } from '../../types';

const MODES: AnalysisMode[] = [
  'FULL_ANALYSIS',
  'STRUCTURE',
  'OPPORTUNITY',
  'CONFIRMATION',
  'CONTINUATION',
  'BREAKOUT',
  'REVERSAL',
];

const TFS: StripTf[] = ['YTD', 'Q', 'MN', 'W', 'D1', 'H8', 'H1', 'M15', 'M5'];
const LOOKBACKS = [80, 120, 200, 500];

type Props = {
  symbols: string[];
  symbol: string;
  onSymbol: (s: string) => void;
  mode: AnalysisMode;
  onMode: (m: AnalysisMode) => void;
  primaryTf: StripTf;
  onPrimaryTf: (tf: StripTf) => void;
  lookback: number;
  onLookback: (n: number) => void;
  autonomous: boolean;
  onAutonomous: (v: boolean) => void;
  persist: boolean;
  onPersist: (v: boolean) => void;
  pollSec: number;
  onRefresh: () => void;
  loading?: boolean;
  analysisId?: string;
  onCopyId?: () => void;
};

export default function ControlBarWired({
  symbols,
  symbol,
  onSymbol,
  mode,
  onMode,
  primaryTf,
  onPrimaryTf,
  lookback,
  onLookback,
  autonomous,
  onAutonomous,
  persist,
  onPersist,
  pollSec,
  onRefresh,
  loading,
  analysisId,
  onCopyId,
}: Props) {
  return (
    <section className="controlbar">
      <div className="field symbol-field">
        <label htmlFor="aca-v2-symbol">Symbol</label>
        <select id="aca-v2-symbol" value={symbol} onChange={(e) => onSymbol(e.target.value)}>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="aca-v2-mode">Mode</label>
        <select id="aca-v2-mode" value={mode} onChange={(e) => onMode(e.target.value as AnalysisMode)}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>
      <div className="field small">
        <label htmlFor="aca-v2-tf">Primary TF</label>
        <select id="aca-v2-tf" value={primaryTf} onChange={(e) => onPrimaryTf(e.target.value as StripTf)}>
          {TFS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="aca-v2-lookback">Lookback</label>
        <select id="aca-v2-lookback" value={lookback} onChange={(e) => onLookback(Number(e.target.value))}>
          {LOOKBACKS.map((n) => (
            <option key={n} value={n}>
              {n} candles
            </option>
          ))}
        </select>
      </div>
      <div className="check-area">
        <label>
          <input type="checkbox" checked={autonomous} onChange={(e) => onAutonomous(e.target.checked)} />
          Auto analyse ({pollSec}s)
        </label>
        <label>
          <input type="checkbox" checked={persist} onChange={(e) => onPersist(e.target.checked)} />
          Persist to library
        </label>
        <button type="button" className="refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>
      <div className="field analysis-id">
        <label>Analysis ID</label>
        <div>
          {analysisId || '—'}
          {analysisId && onCopyId ? (
            <button type="button" aria-label="Copy analysis ID" onClick={onCopyId} style={{ border: 0, background: 'transparent', color: 'inherit' }}>
              <Copy size={15} />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
