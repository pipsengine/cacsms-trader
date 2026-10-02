import { useMemo, useState } from 'react';
import {
  Camera,
  ChartCandlestick,
  Copy,
  Maximize2,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useAutonomyState } from '../../workflow-engine/services/autonomyStore';
import {
  refreshAiChartAnalysis,
  setAiChartAutonomous,
  setAiChartLookback,
  setAiChartMode,
  setAiChartPersistMaterial,
  setAiChartPrimaryTf,
  setAiChartSymbol,
  useAiChartStore,
  AI_CHART_VIEW_POLL_MS,
} from '../aiChartStore';
import type { AnalysisMode, StripTf } from '../types';
import { mapPayloadToAnalysisView, ohlcFromCandles } from './mapAnalysis';
import { CandleChart } from './CandleChart';
import { EvidenceScoreRing } from './EvidenceScoreRing';
import { EvidenceColumns, Pill, RawEvidencePanel, TFStrip, Tradability } from './Shared';
import type { TF } from './types';

const MODES: { v: AnalysisMode; label: string }[] = [
  { v: 'FULL_ANALYSIS', label: 'FULL ANALYSIS' },
  { v: 'CONTINUATION', label: 'CONTINUATION' },
  { v: 'BREAKOUT', label: 'BREAKOUT' },
  { v: 'REVERSAL', label: 'REVERSAL' },
  { v: 'STRUCTURE', label: 'STRUCTURE' },
  { v: 'OPPORTUNITY', label: 'OPPORTUNITY' },
];

const LOOKBACKS = [500, 350, 250, 120];

type RightTab = 'ai' | 'opportunity' | 'p1p2' | 'engines';
type SubTab = 'thesis' | 'evidence' | 'scenarios' | 'tradability' | 'reconciliation';

export function AnalysisWorkspace({ symbols }: { symbols: string[] }) {
  const autonomy = useAutonomyState();
  const store = useAiChartStore();
  const { symbol, mode, primaryTf, lookback, data, loading, error, autonomous, persistMaterialChanges } = store;

  const [rightTab, setRightTab] = useState<RightTab>('ai');
  const [subTab, setSubTab] = useState<SubTab>('thesis');
  const [copied, setCopied] = useState(false);

  const analysis = useMemo(() => (data?.ok ? mapPayloadToAnalysisView(data) : null), [data]);
  const ohlc = useMemo(() => (analysis ? ohlcFromCandles(analysis.candles) : null), [analysis]);

  const bridgeLive = Boolean(autonomy?.ok && autonomy.orchestrator?.status);
  const pollSec = AI_CHART_VIEW_POLL_MS / 1000;

  const copyId = async () => {
    if (!analysis?.id) return;
    try {
      await navigator.clipboard.writeText(analysis.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (error && !data?.ok) {
    return <div className="aca-figma-banner err">{error}</div>;
  }

  if (!analysis) {
    return <div className="aca-figma-banner">{loading ? 'Analysis loading…' : 'No analysis data'}</div>;
  }

  return (
    <>
      <div className="pageHeading">
        <div>
          <div className="headingLine">
            <h1>AI Chart Analysis</h1>
            <Pill>BETA</Pill>
          </div>
          <p>
            Top-down interpretation over Channel, Supertrend, Opportunity Framework, P1/P2 and ConfirmationEngine — analysis
            only, no execution authority.
          </p>
        </div>
        <div className="headingStatus">
          <Pill tone={bridgeLive ? 'green' : 'red'}>{bridgeLive ? '● ENGINE LIVE' : '● ENGINE OFFLINE'}</Pill>
          <div>
            <small>Last analysis</small>
            <b>{analysis.updated}</b>
            <span>{analysis.id}</span>
          </div>
        </div>
      </div>

      <section className="toolbar pro">
        <label>
          Symbol
          <select value={symbol} onChange={(e) => setAiChartSymbol(e.target.value)}>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s.startsWith('XAU') ? '🟡 ' : ''}
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mode
          <select value={mode} onChange={(e) => setAiChartMode(e.target.value as AnalysisMode)}>
            {MODES.map((m) => (
              <option key={m.v} value={m.v}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Primary TF
          <select value={primaryTf} onChange={(e) => setAiChartPrimaryTf(e.target.value as StripTf)}>
            {analysis.tfs.map((t) => (
              <option key={t.tf} value={t.tf}>
                {t.tf}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lookback
          <select value={lookback} onChange={(e) => setAiChartLookback(Number(e.target.value))}>
            {LOOKBACKS.map((n) => (
              <option key={n} value={n}>
                {n} candles
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={autonomous} onChange={(e) => setAiChartAutonomous(e.target.checked)} /> Autonomous (
          {pollSec}s)
        </label>
        <label className="check">
          <input type="checkbox" checked={persistMaterialChanges} onChange={(e) => setAiChartPersistMaterial(e.target.checked)} />{' '}
          Persist material changes
        </label>
        <button type="button" className="refresh" onClick={() => refreshAiChartAnalysis(true)} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} /> Refresh
        </button>
        <div className="idbox">
          <small>Analysis ID</small>
          <span>{analysis.id}</span>
          <button type="button" className="iconBtn" onClick={() => void copyId()} title="Copy ID">
            <Copy />
          </button>
          {copied && <small className="copied">Copied</small>}
        </div>
      </section>

      <TFStrip analysis={analysis} selected={primaryTf as TF} onSelect={(tf) => setAiChartPrimaryTf(tf as StripTf)} />

      <div className="acaWorkspaceShell">
        <div className="leftWork">
          <section className="panel chartPanel">
            <div className="chartHead">
              <div className="symbolIcon">◒</div>
              <div>
                <b>{symbol}</b>
                <small>{symbol.startsWith('XAU') ? 'Gold vs US Dollar' : 'FX instrument'}</small>
              </div>
              <select value={primaryTf} onChange={(e) => setAiChartPrimaryTf(e.target.value as StripTf)}>
                {analysis.tfs.map((t) => (
                  <option key={t.tf} value={t.tf}>
                    {t.tf}
                  </option>
                ))}
              </select>
              {ohlc && (
                <div className="ohlc">
                  O {ohlc.open.toFixed(2)} &nbsp; H {ohlc.high.toFixed(2)} &nbsp; L {ohlc.low.toFixed(2)} &nbsp;{' '}
                  <b>
                    C {ohlc.close.toFixed(2)} &nbsp; {ohlc.change >= 0 ? '+' : ''}
                    {ohlc.change.toFixed(2)} ({ohlc.changePct >= 0 ? '+' : ''}
                    {ohlc.changePct.toFixed(2)}%)
                  </b>
                </div>
              )}
              <div className="chartActions">
                <button type="button" aria-label="Chart type">
                  <ChartCandlestick />
                </button>
                <button type="button">
                  <SlidersHorizontal /> Indicators
                </button>
                <button type="button" aria-label="Screenshot">
                  <Camera />
                </button>
                <button type="button" aria-label="Fullscreen">
                  <Maximize2 />
                </button>
              </div>
            </div>
            <div className="chartWrap">
              <div className="drawTools" aria-hidden>
                ＋<span>⌁</span>
                <span>⌇</span>
                <span>⌗</span>
                <span>T</span>
                <span>□</span>
                <span>✎</span>
                <span>⌕</span>
              </div>
              <CandleChart analysis={analysis} />
              <div className="zone supply">{primaryTf} Supply</div>
              {analysis.direction === 'BULLISH' && <div className="zone demand">{primaryTf} ERZ / Demand</div>}
              {analysis.direction === 'BEARISH' && <div className="zone demand bear">{primaryTf} ERZ</div>}
              <div className="level bos">BOS</div>
              {analysis.p2State && analysis.p2State !== '—' && (
                <div className="level choch">P2 Break</div>
              )}
              {analysis.invalidation !== '—' && (
                <div className="invalid">
                  Invalidation
                  <br />
                  {analysis.invalidation}
                </div>
              )}
              <div className="target t1">T1</div>
              <div className="target t2">T2</div>
            </div>
            <div className="chartFooter">
              <span>5Y</span>
              <span>1Y</span>
              <span>6M</span>
              <span>3M</span>
              <span>1M</span>
              <span>1W</span>
              <span>1D</span>
              <div />
              {new Date().toLocaleTimeString()} &nbsp;&nbsp; <b>{autonomous ? 'auto' : 'manual'}</b>
            </div>
          </section>
        </div>

        <aside className="rightAnalysis">
          <div className="rightTabs">
            <b role="tab" className={rightTab === 'ai' ? 'on' : ''} onClick={() => setRightTab('ai')}>
              AI Analysis
            </b>
            <span role="tab" className={rightTab === 'opportunity' ? 'on' : ''} onClick={() => setRightTab('opportunity')}>
              Opportunity
            </span>
            <span role="tab" className={rightTab === 'p1p2' ? 'on' : ''} onClick={() => setRightTab('p1p2')}>
              P1 / P2
            </span>
            <span role="tab" className={rightTab === 'engines' ? 'on' : ''} onClick={() => setRightTab('engines')}>
              Engines
            </span>
          </div>

          <section className="panel aiCard">
            {rightTab === 'ai' && (
              <>
                <div className="aiTitle">
                  <div className="symbolIcon">⌁</div>
                  <b>
                    {symbol} — {primaryTf}
                  </b>
                  <Pill tone="green">{analysis.status.replace(/_/g, ' ')}</Pill>
                </div>
                <div className="thesisHero">
                  <h2>{analysis.thesisTitle}</h2>
                  <p>{analysis.thesisBrief}</p>
                </div>
                <div className="metrics">
                  <div>
                    <small>Direction</small>
                    <b className={analysis.direction === 'BULLISH' ? 'good' : analysis.direction === 'BEARISH' ? 'bad' : ''}>
                      {analysis.direction === 'BULLISH' ? '↗ Bullish' : analysis.direction === 'BEARISH' ? '↘ Bearish' : analysis.direction}
                    </b>
                  </div>
                  <div>
                    <small>Market State</small>
                    <b>{analysis.marketState}</b>
                  </div>
                  <div>
                    <small>Structure</small>
                    <b>{analysis.structureLabel}</b>
                  </div>
                  <div className="metricsScoreCell">
                    <small>Evidence Score</small>
                    <EvidenceScoreRing score={analysis.confidence} />
                  </div>
                </div>
                <div className="subTabs">
                  <b className={subTab === 'thesis' ? 'on' : ''} onClick={() => setSubTab('thesis')}>
                    Thesis
                  </b>
                  <span className={subTab === 'evidence' ? 'on' : ''} onClick={() => setSubTab('evidence')}>
                    Evidence
                  </span>
                  <span className={subTab === 'scenarios' ? 'on' : ''} onClick={() => setSubTab('scenarios')}>
                    Scenarios
                  </span>
                  <span className={subTab === 'tradability' ? 'on' : ''} onClick={() => setSubTab('tradability')}>
                    Tradability
                  </span>
                  <span className={subTab === 'reconciliation' ? 'on' : ''} onClick={() => setSubTab('reconciliation')}>
                    Reconciliation
                  </span>
                </div>
                {(subTab === 'thesis' || subTab === 'evidence') && (
                  <EvidenceColumns analysis={analysis} onViewRaw={() => setRightTab('engines')} />
                )}
                {subTab === 'evidence' && (
                  <div className="thesisDetail">
                    <p>{analysis.thesis}</p>
                  </div>
                )}
                {subTab === 'scenarios' && (
                  <div className="expected">
                    <b>
                      Primary scenario <small>(PROJECTED — NOT OBSERVED PRICE)</small>
                    </b>
                    <p>{analysis.thesisTitle}</p>
                  </div>
                )}
                {subTab === 'tradability' && <Tradability analysis={analysis} compact />}
                {subTab === 'reconciliation' && (
                  <>
                    <div className="engine">
                      <small>AI ↔ ENGINE</small>
                      <b>{analysis.agreement}</b>
                      <p>{data?.reconciliation?.conflictDetail}</p>
                    </div>
                    <div className="engine engineFoot">
                      <small>DETERMINISTIC CONTROL</small>
                      <b>{analysis.engineState}</b>
                      <p>
                        <ShieldCheck /> AI interpretation cannot bypass Stage 7–10 authorization.
                      </p>
                    </div>
                  </>
                )}
                {(subTab === 'thesis' || subTab === 'evidence') && (
                <div className="miniCards">
                  <div>
                    <small>Price Location</small>
                    <b>{analysis.priceLocation}</b>
                    <span>{analysis.priceLocationDetail}</span>
                  </div>
                  <div>
                    <small>Supertrend</small>
                    <b className="good">{analysis.supertrendLabel}</b>
                  </div>
                  <div>
                    <small>HTF Alignment</small>
                    {analysis.htfAlignment.map((line) => (
                      <b key={line} className="good">
                        ● {line}
                      </b>
                    ))}
                  </div>
                </div>
                )}
                {(subTab === 'thesis' || subTab === 'evidence') && (
                <div className="expected">
                  <b>
                    Expected Path <small>(Not observed price)</small>
                  </b>
                  <div className="path">
                    {analysis.pathSteps.map((step, i) => (
                      <span key={step.label} style={{ display: 'contents' }}>
                        <i className={step.state}>{i + 1}</i>
                        {i < analysis.pathSteps.length - 1 && (
                          <span
                            className={
                              step.state === 'done' && analysis.pathSteps[i + 1]?.state === 'done'
                                ? 'done'
                                : step.state === 'done' && analysis.pathSteps[i + 1]?.state === 'active'
                                  ? 'active'
                                  : ''
                            }
                          />
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="pathLabels">
                    {analysis.pathSteps.map((step) => (
                      <span key={step.label} className={step.state}>
                        {step.label}
                      </span>
                    ))}
                  </div>
                </div>
                )}
              </>
            )}
            {rightTab === 'opportunity' && (
              <div className="thesisHero">
                <h2>{analysis.opportunity}</h2>
                <p>From Opportunity Framework (authoritative taxonomy).</p>
              </div>
            )}
            {rightTab === 'p1p2' && (
              <div className="metrics">
                <div>
                  <small>P1</small>
                  <b>{analysis.p1State}</b>
                </div>
                <div>
                  <small>P2</small>
                  <b>{analysis.p2State}</b>
                </div>
              </div>
            )}
            {rightTab === 'engines' && (
              <>
                <div className="engine">
                  <small>RECONCILIATION</small>
                  <b>{analysis.agreement}</b>
                  <p>{data?.reconciliation?.note}</p>
                </div>
                <RawEvidencePanel analysis={analysis} />
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
