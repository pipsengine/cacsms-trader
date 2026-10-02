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
import type { Timeframe } from '../production-v4/types';
import {
  mapPayloadToV2Analysis,
  mapPayloadToV2ChartModel,
  mapPayloadToV2Timeframes,
} from './adapters/mapFromPayload';
import TradingChart from './chart/TradingChart';
import AIAnalysisPanel from './components/AIAnalysisPanel';
import ControlBarWired from './components/ControlBarWired';
import TimeframeStrip from './components/TimeframeStrip';

const CHART_TFS = ['YTD', 'Q', 'MN', 'W', 'D1', 'H8', 'H1', 'M15', 'M5'] as const;

export function V2ProductionWorkspace({ symbols }: { symbols: string[] }) {
  const autonomy = useAutonomyState();
  const store = useAiChartStore();
  const { symbol, mode, primaryTf, lookback, data, loading, error, autonomous, persistMaterialChanges } = store;
  const [copied, setCopied] = useState(false);

  const analysis = useMemo(() => {
    if (!data?.ok) return null;
    return mapPayloadToAnalysisResult(data, primaryTf as Timeframe);
  }, [data, primaryTf]);

  const chartModel = useMemo(() => {
    if (!data?.ok) return null;
    return mapPayloadToV2ChartModel(data, analysis, primaryTf as Timeframe);
  }, [data, analysis, primaryTf]);

  const panelData = useMemo(() => {
    if (!data?.ok) return null;
    return mapPayloadToV2Analysis(data, analysis, primaryTf as Timeframe);
  }, [data, analysis, primaryTf]);

  const timeframes = useMemo(
    () => mapPayloadToV2Timeframes(data?.ok ? data : { ok: false, symbol: '', analysisId: '' }, primaryTf as Timeframe),
    [data, primaryTf],
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
    return <div className="aca-v2-banner err">{error}</div>;
  }

  if (!data?.ok || !analysis || !panelData) {
    return <div className="aca-v2-banner">{loading ? 'Analysis loading…' : 'No analysis data'}</div>;
  }

  const updated = analysis.createdAt
    ? new Date(analysis.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  return (
    <div className="aca-v2-root content">
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
            <b>{analysis.analysisId}</b>
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
        analysisId={analysis.analysisId}
        onCopyId={() => void copyId()}
      />
      {copied && <small className="aca-v2-toast">Analysis ID copied</small>}

      <div className="analysis-layout">
        <div className="left-column">
          <TimeframeStrip
            items={timeframes}
            active={primaryTf}
            onSelect={(tf) => setAiChartPrimaryTf(tf as StripTf)}
          />
          <div className="chart-wrap">
            {chartModel ? (
              <TradingChart
                model={chartModel}
                timeframe={primaryTf}
                timeframeOptions={CHART_TFS}
                onTimeframe={(tf) => setAiChartPrimaryTf(tf as StripTf)}
              />
            ) : (
              <div className="aca-v2-banner">No valid chart candles for this timeframe.</div>
            )}
          </div>
        </div>
        <AIAnalysisPanel data={panelData} />
      </div>
    </div>
  );
}
