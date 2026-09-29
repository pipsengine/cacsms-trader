import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../components/UI';
import type { ChannelTimeframe } from './types';
import { age, TIMEFRAMES } from './format';
import {
  reanalyseChannels,
  refreshChannels,
  selectChannelInstrument,
  startChannelStore,
  useChannelStore,
} from './services/channelStore';
import { ChannelCard } from './components/ChannelCard';
import { ChannelDetailModal } from './components/ChannelDetailModal';
import {
  ChannelAnalysisSkeleton,
  ChannelLegend,
  ChannelSummaryStrip,
  EventFeed,
  InstrumentSelector,
  StructureInterpretationPanel,
  TrendMap,
} from './components/Panels';
import './channel-analysis.css';

function useModalKeys(selected: ChannelTimeframe | null, onSelect: (tf: ChannelTimeframe | null) => void) {
  useEffect(() => {
    if (!selected) return;
    const h = (e: KeyboardEvent) => {
      const i = TIMEFRAMES.indexOf(selected);
      if (e.key === 'Escape') onSelect(null);
      else if (e.key === 'ArrowRight') onSelect(TIMEFRAMES[Math.min(TIMEFRAMES.length - 1, i + 1)]);
      else if (e.key === 'ArrowLeft') onSelect(TIMEFRAMES[Math.max(0, i - 1)]);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selected, onSelect]);
}

export default function ChannelAnalysisPage() {
  useEffect(() => startChannelStore(), []);
  const vm = useChannelStore();
  const [selected, setSelected] = useState<ChannelTimeframe | null>(null);
  const close = useCallback(() => setSelected(null), []);
  useModalKeys(selected, setSelected);

  const data = vm.data;
  const state = data?.selected && data.selected.instrument === vm.instrument ? data.selected : null;
  const paused = data?.engineState === 'PAUSED';
  const lastOk = vm.lastFetchAt ? age((Date.now() - vm.lastFetchAt) / 1000) : null;
  const universe = data?.universe ?? [];

  return (
    <div className="channel-analysis">
      <PageHeader
        title="Channel Analysis"
        subtitle="Autonomous Y · Q · MN · W · D1 · H8 · H1 channels and the trend-within-trend hierarchy for all 29 instruments"
      />

      {vm.error && (
        <div className="ca-error" role="alert">
          <div>
            <b>{data ? 'Bridge disconnected — showing the last persisted state' : 'Channel Analysis unavailable'}</b>
            <span>
              {vm.error}
              {lastOk ? ` · last successful update ${lastOk} ago` : ''}
            </span>
          </div>
          <button type="button" onClick={() => void refreshChannels()}>
            Retry
          </button>
        </div>
      )}
      {data && data.health === 'DISCONNECTED' && !vm.error && (
        <div className="ca-notice warn" role="status">
          MT5 terminal disconnected — channels are the last calculation from stored closed candles; live position is unavailable.
        </div>
      )}
      {paused && (
        <div className="ca-notice warn" role="status">
          Analysis is paused by the operator — channel recalculation resumes automatically when analysis is resumed in System Control.
        </div>
      )}
      {data?.engineState === 'DEGRADED' && data.service.lastError && (
        <div className="ca-notice bad" role="status">
          Channel engine degraded: {data.service.lastError}
        </div>
      )}
      {vm.notice && (
        <div className="ca-notice" role="status">
          {vm.notice}
        </div>
      )}

      <div className="ca-toolbar">
        <InstrumentSelector items={universe} value={vm.instrument} onChange={selectChannelInstrument} />
        {state ? <ChannelSummaryStrip state={state} /> : <div className="ca-summary placeholder" />}
        <div className="ca-toolbar-actions">
          <span className={`ca-engine ${(data?.engineState ?? 'unknown').toLowerCase()}`} title={data?.service.message}>
            ● ENGINE {data?.engineState ?? '—'}
          </span>
          <button
            type="button"
            className="ca-reanalyse"
            disabled={vm.reanalysing || !data || paused}
            onClick={() => void reanalyseChannels()}
            title="Diagnostic / recovery only — the engine recalculates automatically on every new closed candle"
          >
            {vm.reanalysing ? 'Queuing…' : 'Re-analyse'}
          </button>
        </div>
      </div>

      {vm.loading && !state ? (
        <ChannelAnalysisSkeleton />
      ) : !state ? (
        !vm.error && (
          <div className="ca-panel ca-pending" role="status">
            <b>{vm.instrument}: first autonomous channel analysis pending</b>
            <span>{data?.message || data?.service.message || 'Waiting for the bridge engine.'}</span>
          </div>
        )
      ) : (
        <>
          <ChannelLegend />
          <section className="ca-channel-grid" aria-label={`${state.instrument} timeframe channels`}>
            {TIMEFRAMES.map((tf) => (
              <ChannelCard key={tf} channel={state.channels[tf]} onOpen={() => setSelected(tf)} />
            ))}
          </section>
          <div className="ca-bottom-grid">
            <TrendMap state={state} />
            <StructureInterpretationPanel state={state} />
          </div>
          <div className="ca-bottom-grid">
            <EventFeed events={data?.events ?? []} />
            <section className="ca-panel ca-method">
              <div className="ca-section-title">
                <div>
                  <small>ANALYSIS METHOD</small>
                  <h3>Independent detection → hierarchy → interpretation</h3>
                </div>
              </div>
              <p>
                Each timeframe is detected independently from validated closed candles (Y and Q aggregated from complete MN1 months): confirmed
                swings, Touch #1 anchor, Touch #2 candidate, Touch #3 validation, a parallel opposite boundary with its own touches, width and
                parallelism limits, then breakout, retest and invalidation. The hierarchy is built afterwards — a parent never forces a child's
                direction, and an opposing child is published beside its parent as a correction, counter-correction or nested correction.
              </p>
              <p className="ca-muted">
                Run #{state.runId} · trigger {state.trigger ?? '—'} · analysed {new Date(state.analysedAt).toLocaleString()} ·{' '}
                {data?.service.message ?? ''}
              </p>
            </section>
          </div>
          {selected && (
            <ChannelDetailModal
              channel={state.channels[selected]}
              state={state}
              events={data?.events ?? []}
              onClose={close}
              onReanalyse={() => void reanalyseChannels([selected])}
              reanalysing={vm.reanalysing}
              canReanalyse={!paused}
            />
          )}
        </>
      )}
    </div>
  );
}
