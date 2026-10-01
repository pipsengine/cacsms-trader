import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { fetchSupertrend, resetSupertrendConfig, updateSupertrendConfig } from './supertrendClient';
import { SupertrendCardButton } from './SupertrendCard';
import { SupertrendDetailModal } from './SupertrendDetailModal';
import { SUPERTREND_TIMEFRAMES, type SupertrendSnapshot, type SupertrendTimeframe } from './types';
import './supertrend.css';

function SettingsBar({
  data,
  busy,
  onApply,
  onReset,
}: {
  data: SupertrendSnapshot;
  busy: boolean;
  onApply: (m: number, p: number) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [multiplier, setMultiplier] = useState(String(data.settings.atrMultiplier));
  const [period, setPeriod] = useState(String(data.settings.atrPeriod));
  const [error, setError] = useState('');

  useEffect(() => {
    setMultiplier(String(data.settings.atrMultiplier));
    setPeriod(String(data.settings.atrPeriod));
  }, [data.settings.atrMultiplier, data.settings.atrPeriod, data.settings.revision]);

  const apply = async () => {
    const m = Number(multiplier);
    const p = Number(period);
    if (!Number.isFinite(m) || m < 0.1 || m > 10) {
      setError('ATR Multiplier must be between 0.1 and 10.0');
      return;
    }
    if (!Number.isInteger(p) || p < 2 || p > 1000) {
      setError('ATR Period must be an integer between 2 and 1000');
      return;
    }
    setError('');
    await onApply(m, p);
  };

  return (
    <section className="st-settings" aria-label="Supertrend settings">
      <div>
        <span className="st-kicker">Global Supertrend Parameters</span>
        <b>ATR settings apply atomically to all eight contexts</b>
        <small>Version {data.settings.revision} · updated by {data.settings.updatedBy || 'system'}</small>
      </div>
      <label>
        ATR Multiplier
        <input value={multiplier} onChange={(e) => setMultiplier(e.target.value)} inputMode="decimal" disabled={busy} />
      </label>
      <label>
        ATR Period
        <input value={period} onChange={(e) => setPeriod(e.target.value)} inputMode="numeric" disabled={busy} />
      </label>
      <label>
        Confirmation
        <select value="PREVIOUS" disabled>
          <option>Closed Candle</option>
        </select>
      </label>
      <button type="button" onClick={apply} disabled={busy}><SlidersHorizontal size={14} /> Apply</button>
      <button type="button" className="secondary" onClick={onReset} disabled={busy}><RotateCcw size={14} /> Reset Default</button>
      {error && <span className="st-error">{error}</span>}
    </section>
  );
}

function AlignmentBar({ data }: { data: SupertrendSnapshot }) {
  const a = data.alignment;
  return (
    <section className="st-align" aria-label="Multitimeframe Supertrend Alignment">
      <div>
        <span className="st-kicker">Multitimeframe Supertrend Alignment</span>
        <b>{a.bullish}/{a.total} Bullish · {a.bearish}/{a.total} Bearish</b>
      </div>
      <div className="st-align-stats">
        <span>Alignment: <b>{a.alignmentPct.toFixed(1)}%</b></span>
        <span>HTF: <b>{a.htfBias}</b></span>
        <span>Execution: <b>{a.executionBias}</b></span>
        <span>TiT: <b>{a.titState}</b></span>
      </div>
    </section>
  );
}

function useModalKeys(selected: SupertrendTimeframe | null, onSelect: (tf: SupertrendTimeframe | null) => void) {
  useEffect(() => {
    if (!selected) return;
    const h = (e: KeyboardEvent) => {
      const i = SUPERTREND_TIMEFRAMES.indexOf(selected);
      if (e.key === 'Escape') onSelect(null);
      else if (e.key === 'ArrowRight') onSelect(SUPERTREND_TIMEFRAMES[Math.min(SUPERTREND_TIMEFRAMES.length - 1, i + 1)]);
      else if (e.key === 'ArrowLeft') onSelect(SUPERTREND_TIMEFRAMES[Math.max(0, i - 1)]);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selected, onSelect]);
}

export function MultitimeframeSupertrendTab({ symbol }: { symbol: string }) {
  const [data, setData] = useState<SupertrendSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<SupertrendTimeframe | null>(null);
  const close = useCallback(() => setSelected(null), []);
  useModalKeys(selected, setSelected);

  const load = async (keep = true) => {
    try {
      const next = await fetchSupertrend(symbol);
      setData(next);
      setError('');
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Supertrend unavailable');
      if (!keep) setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let dead = false;
    let timer = 0;
    const run = async () => {
      try {
        const next = await fetchSupertrend(symbol);
        if (!dead) {
          setData(next);
          setError('');
          setLoading(false);
        }
      } catch (exc) {
        if (!dead) {
          setError(exc instanceof Error ? exc.message : 'Supertrend unavailable');
          setLoading(false);
        }
      } finally {
        if (!dead) timer = window.setTimeout(run, 10_000);
      }
    };
    setLoading(true);
    setSelected(null);
    void run();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [symbol]);

  const apply = async (m: number, p: number) => {
    if (!data) return;
    setBusy(true);
    try {
      await updateSupertrendConfig({ atrMultiplier: m, atrPeriod: p, expectedRevision: data.settings.revision });
      await load(true);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await resetSupertrendConfig(data.settings.revision);
      await load(true);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <div className="st-state"><RefreshCw size={18} className="hr-spin" /><b>Loading Multitimeframe Supertrend</b><span>Reading canonical bars from the existing MT5 bridge.</span></div>;
  }
  if (!data) {
    return <div className="st-state error"><AlertTriangle size={18} /><b>Supertrend unavailable</b><span>{error}</span><button type="button" onClick={() => void load(false)}>Retry</button></div>;
  }

  const missing = SUPERTREND_TIMEFRAMES.filter((tf) => !data.cards?.[tf]);
  const selectedCard = selected ? data.cards?.[selected] : null;

  return (
    <div className="st-root">
      {error && <div className="st-banner"><AlertTriangle size={14} /> {error}</div>}
      {missing.length > 0 && (
        <div className="st-banner">
          <AlertTriangle size={14} /> Waiting for {missing.join(', ')} Supertrend contexts from the bridge.
        </div>
      )}
      <SettingsBar data={data} busy={busy} onApply={apply} onReset={reset} />
      <AlignmentBar data={data} />
      {busy && <div className="st-recalc"><RefreshCw size={14} className="hr-spin" /> Recalculating Supertrend...</div>}
      <div className="st-legend">
        <span><i className="up" /> Uptrend regime candles and line</span>
        <span><i className="down" /> Downtrend regime candles and line</span>
        <span><i className="live" /> Open candle is provisional</span>
        <small>Confirmed direction uses the latest closed candle. Click a card for full detail.</small>
      </div>
      <section className="ca-channel-grid st-eight-grid" aria-label={`${symbol} multitimeframe Supertrend cards`}>
        {SUPERTREND_TIMEFRAMES.map((tf) => {
          const card = data.cards?.[tf];
          if (card) {
            return <SupertrendCardButton key={tf} card={card} onOpen={() => setSelected(tf)} />;
          }
          return (
            <div key={tf} className="ca-card invalid pending" role="status">
              <header>
                <span className="ca-tf">{tf}</span>
                <span className="ca-label">Loading…</span>
                <span className="ca-head-pills"><span className="ca-status muted">● Waiting</span></span>
              </header>
              <div className="ca-novalid">
                <b>AWAITING SNAPSHOT</b>
                <span>Bridge has not published {tf} yet — restart the bridge if this persists.</span>
              </div>
            </div>
          );
        })}
      </section>
      {selected && selectedCard && (
        <SupertrendDetailModal card={selectedCard} symbol={symbol} onClose={close} />
      )}
    </div>
  );
}
