import { useCallback, useEffect, useState } from 'react';
import type { ChannelTimeframe } from './types';
import { age, TIMEFRAMES } from './format';
import {
  reanalyseChannels,
  refreshChannels,
  selectChannelInstrument,
  startChannelStore,
  useChannelStore,
} from './services/channelStore';
import { startAutonomyStore, useAutonomyState } from '../workflow-engine/services/autonomyStore';
import { ChannelCard } from './components/ChannelCard';
import { ChannelDetailModal } from './components/ChannelDetailModal';
import { ChannelAnalysisSkeleton, ChannelMasthead, StructureInterpretationPanel, TrendMap } from './components/Panels';
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
  useEffect(() => startAutonomyStore(), []);
  const vm = useChannelStore();
  const execution = useAutonomyState()?.opportunity?.instruments?.find((row) => row.symbol === vm.instrument)?.execution;
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

      <section className="ca-notice" aria-label="M15 and M5 execution structure">
        <b>M15 / M5 execution structure</b>
        <span>
          {execution && (execution.M15 || execution.M5)
            ? ['M15', 'M5'].filter((tf) => execution[tf]).map((tf) => {
                const row = execution[tf];
                return `${tf} ${row.direction ?? '—'} ${row.status ?? '—'} · phase ${row.phase ?? '—'} · position ${row.position ?? '—'}% · touches ${row.touchCount ?? '—'} · confidence ${row.confidence ?? '—'}`;
              }).join(' · ')
            : 'M15 and M5 are calculated on the bridge for XAUUSD and for corrections. This instrument has no execution-timeframe channel on the latest sweep. The Y–H1 hierarchy above is unchanged.'}
        </span>
      </section>

      <ChannelMasthead
        items={universe}
        instrument={vm.instrument}
        onInstrument={selectChannelInstrument}
        state={state}
        reanalysing={vm.reanalysing}
        paused={paused}
        canReanalyse={Boolean(data)}
        onReanalyse={() => void reanalyseChannels()}
      />

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
          <section className="ca-channel-grid" aria-label={`${state.instrument} timeframe channels`}>
            {TIMEFRAMES.map((tf) => (
              <ChannelCard key={tf} channel={state.channels[tf]} onOpen={() => setSelected(tf)} />
            ))}
          </section>
          <div className="ca-bottom-grid">
            <TrendMap state={state} />
            <StructureInterpretationPanel state={state} />
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
