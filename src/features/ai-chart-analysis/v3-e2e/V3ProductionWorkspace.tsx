import { useMemo, useState } from 'react';
import { useAutonomyState } from '../../workflow-engine/services/autonomyStore';
import {
  AI_CHART_VIEW_POLL_MS,
  refreshAiChartAnalysis,
  setAiChartAutonomous,
  setAiChartLookback,
  setAiChartMode,
  setAiChartPersistMaterial,
  setAiChartPrimaryTf,
  setAiChartSymbol,
  useAiChartStore,
} from '../aiChartStore';
import type { StripTf } from '../types';
import { mapPayloadToAnalysisResult } from '../production-v4/mapPayloadToAnalysisResult';
import type { AnalysisResult, Timeframe } from '../production-v4/types';
import { bridgePayloadToSnapshot } from './adapters/bridgeToSnapshot';
import { snapshotToAnalysisPanel, snapshotToChartModel, snapshotToTimeframeStrip } from './adapters/snapshotToView';
import TradingChart from './chart/TradingChart';
import AIAnalysisPanel from './components/AIAnalysisPanel';
import ControlBarWired from './components/ControlBarWired';
import TimeframeStrip from './components/TimeframeStrip';

const CHART_TFS = ['YTD', 'Q', 'MN', 'W', 'D1', 'H8', 'H1', 'M15', 'M5'] as const;

function enrichPanel(snapshot: ReturnType<typeof snapshotToAnalysisPanel>, analysis: AnalysisResult | null) {
  if (!analysis) return snapshot;
  return {
    ...snapshot,
    location: analysis.priceLocation.replace(/ · /g, '\n'),
    supertrend:
      analysis.supertrend === 'BULLISH' ? 'Bullish' : analysis.supertrend === 'BEARISH' ? 'Bearish' : snapshot.supertrend,
    alignment: analysis.htfAlignment.length ? analysis.htfAlignment : snapshot.alignment,
    expectedPath: analysis.expectedPath.map((step) => ({
      label: step.label,
      state: (step.status === 'done' ? 'complete' : step.status === 'current' ? 'current' : 'pending') as
        | 'complete'
        | 'current'
        | 'pending',
    })),
  };
}

export function V3ProductionWorkspace({ symbols }: { symbols: string[] }) {
  const autonomy = useAutonomyState();
  const store = useAiChartStore();
  const { symbol, mode, primaryTf, lookback, data, loading, error, autonomous, persistMaterialChanges } = store;
  const [copied, setCopied] = useState(false);

  const analysis = useMemo(() => {
    if (!data?.ok) return null;
    return mapPayloadToAnalysisResult(data, primaryTf as Timeframe);
  }, [data, primaryTf]);

  const snapshot = useMemo(() => {
    if (!data?.ok) return null;
    return bridgePayloadToSnapshot(data, analysis, primaryTf as Timeframe);
  }, [data, analysis, primaryTf]);

  const chartModel = useMemo(() => (snapshot ? snapshotToChartModel(snapshot) : null), [snapshot]);

  const panelData = useMemo(() => {
    if (!snapshot) return null;
    return enrichPanel(snapshotToAnalysisPanel(snapshot), analysis);
  }, [snapshot, analysis]);

  const timeframes = useMemo(
    () => (snapshot ? snapshotToTimeframeStrip(snapshot, primaryTf) : []),
    [snapshot, primaryTf],
  );

  const bridgeLive = Boolean(autonomy?.ok && autonomy.orchestrator?.status);
  const pollSec = AI_CHART_VIEW_POLL_MS / 1000;

  const copyId = async () => {
    if (!analysis?.analysisId) return;
    try {
      await navigator.clipboard.writeText(analysis.analysisId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (error && !data?.ok) {
    return <div className="aca-v3-banner err">{error}</div>;
  }

  if (!snapshot || !panelData) {
    return <div className="aca-v3-banner">{loading ? 'Analysis loading…' : 'No analysis data'}</div>;
  }

  const updated = analysis?.createdAt
    ? new Date(analysis.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  return (
    <div className="aca-v3-root content">
      <header className="page-head">
        <div>
          <div className="title-row">
            <h1>AI Chart Analysis</h1>
            <span className="beta">◉ BETA</span>
          </div>
          <p>
            Top-down interpretation over Channel, Supertrend, Opportunity Framework, P1/P2 and ConfirmationEngine — analysis
            only, no execution authority.
          </p>
        </div>
        <div className="engine-meta">
          <span className="engine-live">
            <i />
            {bridgeLive ? 'ENGINE LIVE' : 'ENGINE OFFLINE'}
          </span>
          <div>
            <small>Last analysis</small>
            <span>{updated}</span>
            <b>{snapshot.analysisId}</b>
          </div>
        </div>
      </header>

      <ControlBarWired
        symbols={symbols}
        symbol={symbol}
        onSymbol={setAiChartSymbol}
        mode={mode}
        onMode={setAiChartMode}
        primaryTf={primaryTf}
        onPrimaryTf={setAiChartPrimaryTf}
        lookback={lookback}
        onLookback={setAiChartLookback}
        autonomous={autonomous}
        onAutonomous={setAiChartAutonomous}
        persist={persistMaterialChanges}
        onPersist={setAiChartPersistMaterial}
        pollSec={pollSec}
        onRefresh={() => refreshAiChartAnalysis(true)}
        loading={loading}
        analysisId={snapshot.analysisId}
        onCopyId={() => void copyId()}
      />
      {copied && <small className="aca-v3-toast">Analysis ID copied</small>}

      <div className="analysis-layout">
        <div className="left-column">
          <TimeframeStrip items={timeframes} active={primaryTf} onSelect={(tf) => setAiChartPrimaryTf(tf as StripTf)} />
          <div className="chart-wrap">
            {chartModel ? (
              <TradingChart
                model={chartModel}
                timeframe={primaryTf}
                timeframeOptions={CHART_TFS}
                onTimeframe={(tf) => setAiChartPrimaryTf(tf as StripTf)}
              />
            ) : (
              <div className="aca-v3-banner">No valid chart candles for this timeframe.</div>
            )}
          </div>
        </div>
        <AIAnalysisPanel data={panelData} />
      </div>
    </div>
  );
}
