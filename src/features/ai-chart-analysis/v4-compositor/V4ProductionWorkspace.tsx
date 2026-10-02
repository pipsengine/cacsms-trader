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
import { bridgePayloadToSnapshot } from '../v3-e2e/adapters/bridgeToSnapshot';
import { snapshotToAnalysisPanel, snapshotToTimeframeStrip } from '../v3-e2e/adapters/snapshotToView';
import ControlBarWired from '../v3-e2e/components/ControlBarWired';
import type { AutonomousSnapshot } from '../v3-e2e/types/autonomous';
import { useAcaLiveQuote } from '../production-v4/useAcaLiveQuote';
import { applyLiveQuoteToSnapshot } from './applyLiveQuote';
import V4AIPanel from './V4AIPanel';
import V4ChartSvg from './V4ChartSvg';

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

type Props = {
  symbols: string[];
  /** Optional fixed snapshot (reference mock route). */
  mockSnapshot?: AutonomousSnapshot | null;
};

export function V4ProductionWorkspace({ symbols, mockSnapshot = null }: Props) {
  const autonomy = useAutonomyState();
  const store = useAiChartStore();
  const { symbol, mode, primaryTf, lookback, data, loading, error, autonomous, persistMaterialChanges } = store;
  const [copied, setCopied] = useState(false);

  const analysisFromPayload = useMemo(() => {
    if (!data?.ok) return null;
    return mapPayloadToAnalysisResult(data, primaryTf as Timeframe);
  }, [data, primaryTf]);

  const snapshot = useMemo(() => {
    if (mockSnapshot) return mockSnapshot;
    if (!data?.ok) return null;
    return bridgePayloadToSnapshot(data, analysisFromPayload, primaryTf as Timeframe);
  }, [mockSnapshot, data, analysisFromPayload, primaryTf]);

  const liveQuote = useAcaLiveQuote(mockSnapshot ? '' : symbol, !mockSnapshot);
  const chartSnapshot = useMemo(() => {
    if (!snapshot || !liveQuote?.mid) return snapshot;
    return applyLiveQuoteToSnapshot(snapshot, liveQuote.mid);
  }, [snapshot, liveQuote?.mid]);

  const panelData = useMemo(() => {
    if (!snapshot) return null;
    return enrichPanel(snapshotToAnalysisPanel(snapshot), analysisFromPayload);
  }, [snapshot, analysisFromPayload]);

  const activeTf = mockSnapshot ? mockSnapshot.primaryTimeframe : primaryTf;

  const timeframes = useMemo(
    () => (snapshot ? snapshotToTimeframeStrip(snapshot, activeTf) : []),
    [snapshot, activeTf],
  );

  const bridgeLive = Boolean(autonomy?.ok && autonomy.orchestrator?.status);
  const pollSec = AI_CHART_VIEW_POLL_MS / 1000;

  const copyId = async () => {
    const id = snapshot?.analysisId;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (!mockSnapshot && error && !data?.ok) {
    return <div className="aca-v4-banner err">{error}</div>;
  }

  if (!snapshot || !panelData) {
    return <div className="aca-v4-banner">{loading && !mockSnapshot ? 'Analysis loading…' : 'No analysis data'}</div>;
  }

  const updated = snapshot.updatedAt
    ? new Date(snapshot.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  return (
    <section className="aca-v4-workspace">
      <div className="aca-v4-topChrome">
        <div className="titleRow aca-v4-pageHead">
          <div>
            <h1>
              AI Chart Analysis <span>◉ BETA</span>
            </h1>
            <p className="aca-v4-subtitle">
              Top-down interpretation over Channel, Supertrend, Opportunity Framework, P1/P2 and ConfirmationEngine — analysis
              only, no execution authority.
            </p>
          </div>
          <div className="engine">
            <strong>● &nbsp; {bridgeLive ? 'ENGINE LIVE' : 'ENGINE OFFLINE'}</strong>
            <div className="engine-meta">
              <small>Last analysis</small>
              <span>{updated}</span>
              <b className="engine-analysis-id">{snapshot.analysisId}</b>
            </div>
          </div>
        </div>

        {!mockSnapshot && (
          <div className="controls aca-v4-controls">
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
          </div>
        )}
        {copied && <small className="aca-v4-toast">Analysis ID copied</small>}
      </div>

      <div className="contentGrid">
        <div className="leftCol">
          <div className="mtf">
            {timeframes.map((x) => (
              <div
                key={x.tf}
                className={`mtfCard ${x.tf === activeTf ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => !mockSnapshot && setAiChartPrimaryTf(x.tf as StripTf)}
                onKeyDown={(e) => {
                  if (!mockSnapshot && (e.key === 'Enter' || e.key === ' ')) setAiChartPrimaryTf(x.tf as StripTf);
                }}
              >
                <b>{x.tf}</b>
                <span className="arrow">{x.tone === 'bear' ? '↘' : '↗'}</span>
                <strong>{x.direction}</strong>
                <span>{x.state}</span>
                <em>{x.score}%</em>
              </div>
            ))}
          </div>
          <V4ChartSvg
            snapshot={chartSnapshot ?? snapshot}
            timeframe={activeTf}
            timeframeOptions={mockSnapshot ? undefined : CHART_TFS}
            onTimeframe={mockSnapshot ? undefined : (tf) => setAiChartPrimaryTf(tf as StripTf)}
            liveTick={Boolean(liveQuote)}
          />
        </div>
        <V4AIPanel data={panelData} />
      </div>
    </section>
  );
}
