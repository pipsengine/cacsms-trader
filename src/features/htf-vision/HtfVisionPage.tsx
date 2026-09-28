import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Eye, RefreshCw, Search, X } from 'lucide-react';
import { useTrading } from '../../context/TradingContext';
import { Badge, Card, Metric, PageHeader, Tabs } from '../../components/UI';
import { barLabel, priceDigits, VisionChart, type ChartChannel, type ChartLevel, type ChartMarker, type ChartTouch } from './components/VisionChart';
import { explainBridgeError } from '../../services/bridgeError';
import { fetchVisionChart, fetchVisionDetail } from './services/visionClient';
import { runVisionNow, startVisionStore, useVisionStore, visionRunAgeMs, visionStageStatus } from './services/visionStore';
import { visionPosition } from './services/visionStage';
import type {
  Agreement,
  ChannelRecord,
  ChannelStatus,
  DataStatus,
  Evidence,
  TfAnalysis,
  TfSummary,
  VisionChart as VisionChartData,
  VisionDetail,
  VisionDirection,
  VisionEvent,
  VisionInstrument,
  VisionTf,
} from './types';
import './htf-vision.css';

const VIEWS = ['D1', 'H8', 'H1', 'Combined'] as const;
type View = (typeof VIEWS)[number];
const CHART_BARS: Record<VisionTf, number> = { D1: 320, H8: 420, H1: 280 };
const TF_SEC: Record<VisionTf, number> = { D1: 86400, H8: 28800, H1: 3600 };
const FILTERS = ['All', 'Qualified', 'Confirmed D1', 'Breakout / retest', 'Conflict', 'Data issues'] as const;
type Filter = (typeof FILTERS)[number];

export const dirTone = (d?: VisionDirection | null) => (d?.includes('BULL') ? 'green' : d?.includes('BEAR') ? 'red' : 'gray');
export const dirArrow = (d?: VisionDirection | null) => (d?.includes('BULL') ? '↑' : d?.includes('BEAR') ? '↓' : '→');
export const statusTone = (s?: ChannelStatus | null) =>
  s === 'ACTIVE' || s === 'VALIDATED' ? 'green' : s === 'BROKEN' ? 'red' : s === 'WEAKENING' || s === 'RETESTING' ? 'amber' : s === 'FORMING' ? 'blue' : 'gray';
export const dataTone = (s?: DataStatus | null) => (s === 'READY' ? 'green' : s === 'STALE' || s === 'WARMING_UP' ? 'amber' : 'red');
export const agreeTone = (a?: Agreement | null) => (a === 'AGREE' ? 'green' : a === 'CONFLICT' ? 'red' : a === 'PARTIAL' ? 'amber' : 'gray');
const human = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '—');
const pct = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}%`);
const num = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));

export function ageText(iso?: string | null, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function Conf({ v }: { v: number | null | undefined }) {
  const x = v == null || !Number.isFinite(v) ? 0 : Math.max(0, Math.min(100, v));
  const c = x >= 70 ? '#20d783' : x >= 45 ? '#f2aa1f' : '#ff5d5d';
  return (
    <div className="hr-conf" title="Evidence-based confidence (capped at 95; 45 while unconfirmed)">
      <i style={{ width: `${x}%`, background: c }} />
      <span>{v == null ? '—' : `${x.toFixed(0)}%`}</span>
    </div>
  );
}

/** Headline state: a direction only when D1 is confirmed on READY data. */
export function headline(v: VisionInstrument): { label: string; tone: string } {
  if (v.status === 'BLOCKED') return { label: 'BLOCKED', tone: 'red' };
  if (v.status === 'INSUFFICIENT_DATA') return { label: 'INSUFFICIENT DATA', tone: 'red' };
  if (v.status === 'WARMING_UP') return { label: 'WARMING UP', tone: 'amber' };
  if (!v.d1?.confirmed) return { label: v.d1?.status === 'FORMING' ? 'D1 CHANNEL FORMING' : 'NO CONFIRMED D1 CHANNEL', tone: 'amber' };
  const base = human(v.primaryDirection);
  return { label: v.status === 'STALE' ? `${base} · STALE` : base, tone: v.status === 'STALE' ? 'amber' : dirTone(v.primaryDirection) };
}

function breakoutText(s?: TfSummary | null): string {
  const b = s?.breakout;
  if (!b) return s?.status === 'NONE' || !s?.status ? '—' : 'Inside channel';
  const side = b.side === 'UP' ? 'upside' : 'downside';
  if (b.retesting) return `Retesting ${side} break (${b.barsSince} bars, ${num(b.distanceAtr, 1)} ATR)`;
  if (b.invalidTs) return `${side} break · channel invalidated`;
  return `${side} break ${b.barsSince} bars ago · ${num(b.distanceAtr, 1)} ATR beyond`;
}

function markersFrom(tf: VisionTf, a: TfAnalysis | null | undefined, candles: VisionChartData['candles']): ChartMarker[] {
  if (!a) return [];
  const byTs = new Map(candles.map((c) => [c.ts, c]));
  const out: ChartMarker[] = [];
  if (a.validation)
    out.push({ ts: a.validation.ts, price: a.validation.price, kind: 'VALIDATED', label: a.confirmed ? `${tf} validated` : `${tf} touch #3 · awaiting opposite side` });
  const b = a.breakout;
  if (b) {
    out.push({ ts: b.ts, price: b.price, side: b.side, kind: 'BREAKOUT', label: `${tf} breakout ${b.side === 'UP' ? '↑' : '↓'}` });
    const rt = b.lastRetestTs ?? b.retestTs;
    const c = rt != null ? byTs.get(rt) : undefined;
    if (rt != null && c) out.push({ ts: rt, price: b.side === 'UP' ? c.low : c.high, side: b.side === 'UP' ? 'DOWN' : 'UP', kind: 'RETEST', label: `${tf} retest` });
  }
  for (const f of a.failedBreakouts ?? []) {
    const c = byTs.get(f.ts);
    if (c) out.push({ ts: f.ts, price: f.side === 'UP' ? c.high : c.low, side: f.side, kind: 'FAILED', label: `${tf} failed ${f.side === 'UP' ? '↑' : '↓'}` });
  }
  return out;
}

function projectAt(lines: VisionChartData['lines'], ts: number) {
  const s = [...lines].sort((a, b) => a.ts - b.ts);
  for (let i = 1; i < s.length; i++) {
    if (s[i].ts >= ts && s[i - 1].ts <= ts) {
      const f = (ts - s[i - 1].ts) / Math.max(1, s[i].ts - s[i - 1].ts);
      return { lower: s[i - 1].lower + (s[i].lower - s[i - 1].lower) * f, upper: s[i - 1].upper + (s[i].upper - s[i - 1].upper) * f };
    }
  }
  return null;
}

type Charts = { D1: VisionChartData | null; H8: VisionChartData | null; H1: VisionChartData | null; loading: boolean; error: string };

function useCharts(symbol: string | null, version: string): Charts {
  const [charts, setCharts] = useState<Charts>({ D1: null, H8: null, H1: null, loading: false, error: '' });
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setCharts((c) => ({ ...c, loading: true, error: '', ...(c.D1?.symbol !== symbol ? { D1: null, H8: null, H1: null } : {}) }));
    Promise.all([
      fetchVisionChart(symbol, 'D1', CHART_BARS.D1),
      fetchVisionChart(symbol, 'H8', CHART_BARS.H8),
      fetchVisionChart(symbol, 'H1', CHART_BARS.H1).catch(() => null),
    ])
      .then(([d1, h8, h1]) => {
        if (!cancelled) setCharts({ D1: d1, H8: h8, H1: h1, loading: false, error: '' });
      })
      .catch((e: unknown) => {
        if (!cancelled) setCharts((c) => ({ ...c, loading: false, error: explainBridgeError(e, 'Chart unavailable') }));
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, version]);
  return charts;
}

/* ------------------------------------------------------------------ chart card */

function DataNotice({ tf, rec, summary }: { tf: VisionTf; rec: ChannelRecord | null | undefined; summary?: TfSummary }) {
  const status = rec?.dataStatus ?? summary?.dataStatus;
  const reason = rec?.dataReason ?? summary?.dataReason;
  const available = rec?.available ?? summary?.available;
  const required = rec?.required ?? summary?.required;
  if (!status) return null;
  if (status !== 'READY') {
    return (
      <div className={`hr-banner ${status === 'STALE' || status === 'WARMING_UP' ? 'warn' : 'err'}`}>
        <AlertTriangle size={14} />
        <span>
          <b>
            {tf} {human(status)}
          </b>{' '}
          — {reason || 'no reason recorded'}
          {available != null && required != null ? ` · ${available}/${required} validated bars` : ''}. No {tf} channel is published from this series.
        </span>
      </div>
    );
  }
  const a = rec?.analysis;
  if (a && a.status === 'NONE') {
    return (
      <div className="hr-banner">
        <AlertTriangle size={14} />
        <span>
          <b>No valid {tf} channel</b> — {a.reason}
        </span>
      </div>
    );
  }
  return null;
}

function channelLabel(tf: VisionTf, summary?: TfSummary): string {
  const rel = summary?.relationship ?? (tf === 'D1' ? 'PRIMARY' : 'UNRESOLVED');
  return `${tf} · ${human(summary?.direction ?? 'NEUTRAL')} · ${human(rel)}`;
}

const LAYER_TOGGLES = [
  ['parent', 'Parent Channel'],
  ['nested', 'Nested Channels'],
  ['touches', 'Touches'],
  ['swings', 'Swings'],
  ['structure', 'BOS/CHoCH'],
  ['sr', 'Support/Resistance'],
  ['destination', 'Destination'],
  ['invalidation', 'Invalidation'],
] as const;

function ChartCard({ v, charts, view, setView, livePrice, offline }: { v: VisionInstrument; charts: Charts; view: View; setView: (x: View) => void; livePrice: number | null; offline?: boolean }) {
  const [layers, setLayers] = useState({ parent: true, nested: true, touches: true, swings: true, structure: true, sr: true, destination: true, invalidation: true });
  const tf: VisionTf = view === 'Combined' ? 'H1' : view;
  const d1 = charts.D1;
  const h8 = charts.H8;
  const h1 = charts.H1;
  const base = view === 'Combined' ? h1 ?? h8 ?? d1 : view === 'H1' ? h1 : view === 'H8' ? h8 : d1;
  const aD1 = d1?.channel?.analysis ?? null;
  const aH8 = h8?.channel?.analysis ?? null;
  const aH1 = h1?.channel?.analysis ?? null;

  const props = useMemo(() => {
    if (!base) return null;
    const ch = (c: VisionChartData | null, tone: ChartChannel['tone'], summary?: TfSummary): ChartChannel[] =>
      c && c.lines.length && (tone === 'primary' || summary?.confirmed) ? [{ key: c.timeframe, label: channelLabel(c.timeframe, summary), tf: c.timeframe, lines: c.lines, tone }] : [];
    const tl = (c: VisionChartData | null): ChartTouch[] => (c?.channel?.analysis?.touchList ?? []).map((t) => ({ ...t, tf: c!.timeframe }));
    const parent = layers.parent ? ch(d1, 'primary', v.d1) : [];
    const nested = layers.nested ? [...ch(h8, 'secondary', v.h8), ...ch(h1, 'nested', v.h1)] : [];
    const shown = view === 'Combined' ? [...parent, ...nested] : view === 'D1' ? parent : nested.filter((c) => c.tf === view);
    const touchSrc = view === 'Combined' ? [d1, h8, h1] : [base];
    const markerSrc: [VisionTf, TfAnalysis | null, VisionChartData['candles']][] =
      view === 'Combined'
        ? [
            ['D1', aD1, d1?.candles ?? []],
            ['H8', aH8, h8?.candles ?? []],
            ['H1', aH1, h1?.candles ?? []],
          ]
        : [[base.timeframe, base.channel?.analysis ?? null, base.candles]];
    const last = (d1?.lines ?? []).filter((l) => !l.projected).at(-1);
    const bullish = String(v.d1?.direction ?? '').includes('BULL');
    const levels: ChartLevel[] = [];
    if (last && layers.sr) {
      levels.push({ price: last.upper, label: 'Resistance', color: '#8fd0ff' }, { price: last.lower, label: 'Support', color: '#8fd0ff' });
    }
    if (last && layers.destination) levels.push({ price: bullish ? last.lower : last.upper, label: 'Destination', color: '#7dcea0' });
    if (last && layers.invalidation) levels.push({ price: bullish ? last.lower : last.upper, label: 'Invalidation', color: '#e07a7a' });
    return {
      channels: shown,
      touches: layers.touches ? touchSrc.flatMap(tl) : [],
      markers: layers.structure ? markerSrc.flatMap(([t, a, candles]) => markersFrom(t, a, candles)) : [],
      swings: layers.swings ? base.swings : [],
      levels,
    };
  }, [base, view, d1, h8, h1, aD1, aH8, aH1, v.d1, v.h8, v.h1, layers]);

  const primaryLines = (view === 'H8' ? h8 : view === 'H1' ? h1 : d1)?.lines ?? [];
  const lastTs = base?.candles.length ? base.candles[base.candles.length - 1].ts : null;
  const formingTs = lastTs != null ? lastTs + TF_SEC[base!.timeframe] : null;
  const bounds = formingTs != null && livePrice != null ? projectAt(primaryLines, formingTs) : null;
  const livePos = bounds && livePrice != null ? ((livePrice - bounds.lower) / (bounds.upper - bounds.lower || 1)) * 100 : null;
  const a = view === 'H1' ? aH1 : view === 'H8' ? aH8 : aD1;
  const summary = view === 'H1' ? v.h1 : view === 'H8' ? v.h8 : v.d1;
  const digits = priceDigits(livePrice ?? base?.candles[base.candles.length - 1]?.close);

  return (
    <Card className="hv-chart-card">
      <div className="card-head hv-chart-head">
        <div>
          <h3>
            {v.symbol} · {view === 'Combined' ? 'Parent and nested channels' : `${view} channel`}
          </h3>
          <p>
            {view === 'Combined'
              ? 'D1 parent (solid blue), H8 intermediate (dashed violet) and H1 nested (dashed amber) on the same candles'
              : `${view === 'D1' ? 'Parent' : view === 'H8' ? 'Intermediate' : 'Nested execution'} structure · ${base?.candles.length ?? 0} validated closed bars from the Stage 1 store`}
          </p>
        </div>
        <div className="hv-head-badges">
          <Badge tone={offline ? 'amber' : dataTone(summary?.dataStatus)}>{offline ? 'LAST KNOWN' : human(summary?.dataStatus)}</Badge>
          {summary?.status && <Badge tone={offline ? 'amber' : statusTone(summary.status)}>{offline ? 'NOT LIVE' : human(summary.status)}</Badge>}
          <Badge tone={summary?.confirmed ? dirTone(summary.direction) : 'gray'}>
            {summary?.confirmed ? `${dirArrow(summary.direction)} ${human(summary.direction)}` : `Unconfirmed${summary?.lean && summary.lean !== 'NEUTRAL' ? ` · lean ${human(summary.lean)}` : ''}`}
          </Badge>
        </div>
      </div>
      <Tabs items={[...VIEWS]} active={view} onChange={(x) => setView(x as View)} idPrefix="hv-view" label="Chart timeframe" />
      <div className="hv-layers" role="group" aria-label="Chart layers">
        {LAYER_TOGGLES.map(([key, label]) => (
          <button key={key} type="button" className={layers[key] ? 'on' : ''} aria-pressed={layers[key]} onClick={() => setLayers((s) => ({ ...s, [key]: !s[key] }))}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`hv-view-panel-${view.toLowerCase()}`} aria-labelledby={`hv-view-tab-${view.toLowerCase()}`}>
        {v.status === 'BLOCKED' ? (
          <div className="hr-banner err">
            <AlertTriangle size={14} />
            <span>
              <b>BLOCKED</b> — {v.reason}. Channels are drawn for visibility only; nothing is published to Structural Direction until the Market Scanner promotes the instrument.
            </span>
          </div>
        ) : view === 'Combined' ? (
          <>
            <DataNotice tf="D1" rec={d1?.channel} summary={v.d1} />
            <DataNotice tf="H8" rec={h8?.channel} summary={v.h8} />
            <DataNotice tf="H1" rec={h1?.channel} summary={v.h1} />
          </>
        ) : (
          <DataNotice tf={tf} rec={base?.channel} summary={summary} />
        )}
        {charts.error && !base ? (
          <div className="hr-banner err">
            <AlertTriangle size={14} />
            <span>{charts.error}</span>
          </div>
        ) : !base ? (
          <div className="empty-block hv-chart-empty">
            <b>{charts.loading ? 'Loading chart…' : 'No chart series'}</b>
            <span>{charts.loading ? 'Reading validated candles and the persisted channel from the bridge' : 'No validated candles in the Stage 1 store for this instrument'}</span>
          </div>
        ) : !base.candles.length ? (
          <div className="empty-block hv-chart-empty">
            <b>No validated candles</b>
            <span>{base.channel?.dataReason || `Stage 1 has not stored ${base.timeframe} history for ${v.symbol}`}</span>
          </div>
        ) : (
          props && (
            <VisionChart
              tf={base.timeframe}
              candles={base.candles}
              channels={props.channels}
              swings={props.swings}
              touches={props.touches}
              markers={props.markers}
              levels={props.levels}
              livePrice={livePrice}
              liveLabel={v.live?.marketOpen ? 'live' : 'last quote'}
              position={livePos}
              height={420}
            />
          )
        )}
      </div>
      <div className="vision-stats hv-stats">
        <span title="Live price projected onto the forming bar's channel boundaries">
          Position <b>{pct(livePos ?? summary?.position ?? null)}</b>
        </span>
        <span title="Channel width in price and ATR">
          Width <b>{a?.width != null ? `${a.width.toFixed(digits)} · ${num(a.widthAtr, 1)} ATR` : '—'}</b>
        </span>
        <span title="Slope over 20 bars expressed in ATR">
          Slope <b>{a?.slopeAtr20 != null ? `${a.slopeAtr20 > 0 ? '+' : ''}${a.slopeAtr20.toFixed(2)} ATR/20` : '—'}</b>
        </span>
        <span title="Anchor-side + opposite-side touches">
          Touches <b>{a?.touches ? `${a.touches.anchor}+${a.touches.opposite}` : '—'}</b>
        </span>
        <span title="Touch quality: mean deviation within tolerance">
          Quality <b>{pct(a?.touchQuality)}</b>
        </span>
        <span>
          Age <b>{a?.ageBars != null ? `${a.ageBars} bars` : '—'}</b>
        </span>
        <span title="ATR14 vs ATR50">
          Volatility <b>{a ? `${human(a.volState)} · ${num(a.volRatio, 2)}×` : '—'}</b>
        </span>
        <span>
          Breakout <b>{breakoutText(summary)}</b>
        </span>
        <span>
          Confidence <b>{pct(summary?.confidence, 1)}</b>
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ interpretation */

function Interpretation({ v, onInspect, now }: { v: VisionInstrument; onInspect: () => void; now: number }) {
  const h = headline(v);
  const pos = visionPosition(v, 'd1');
  const tfState = (s: TfSummary) =>
    s.dataStatus !== 'READY' ? `${human(s.dataStatus)}` : s.status === 'NONE' || !s.status ? 'No channel' : `${human(s.status)} · ${s.confirmed ? human(s.direction) : `unconfirmed${s.lean && s.lean !== 'NEUTRAL' ? `, lean ${human(s.lean)}` : ''}`}`;
  return (
    <Card className="hv-interp">
      <div className="card-head">
        <div>
          <h3>Vision Interpretation</h3>
          <p>Machine-generated from the persisted D1/H8 evidence</p>
        </div>
        <button type="button" className="hr-run" onClick={onInspect}>
          Drill-down
        </button>
      </div>
      <div className={`decision hv-decision ${h.tone}`}>
        <Eye />
        <b>{h.label}</b>
        <p>{v.status === 'READY' || v.status === 'STALE' ? v.reasoning[0] ?? v.reason : v.reason}</p>
      </div>
      <div className="kv hv-kv">
        <span>Primary trend</span>
        <b>
          <Badge tone={v.d1?.confirmed ? dirTone(v.d1.direction) : 'gray'}>{human(v.d1?.confirmed ? v.d1.direction : v.primaryDirection)}</Badge>
        </b>
        <span>D1 state</span>
        <b>{v.d1 ? tfState(v.d1) : '—'}</b>
        <span>H8 state</span>
        <b>{v.h8 ? tfState(v.h8) : '—'}</b>
        <span>Market phase</span>
        <b>{human(v.phase)}</b>
        <span>Channel position</span>
        <b>
          {pct(pos, 1)}
          {v.live?.positionH8 != null && <small className="muted"> · H8 {pct(v.live.positionH8, 0)}</small>}
        </b>
        <span>Confidence</span>
        <b>
          <Conf v={v.confidence} />
        </b>
        <span>Touches D1 / H8</span>
        <b>
          {v.d1?.touches ? `${v.d1.touches.anchor}+${v.d1.touches.opposite}` : '—'} / {v.h8?.touches ? `${v.h8.touches.anchor}+${v.h8.touches.opposite}` : '—'}
        </b>
        <span>D1 / H8 agreement</span>
        <b>
          <Badge tone={agreeTone(v.agreement)}>{human(v.agreement)}</Badge>
        </b>
        <span>Parent channel</span>
        <b>{v.d1?.channelKey ? channelLabel('D1', v.d1) : 'NOT DETECTED'}</b>
        <span>Parent status</span>
        <b>{v.d1?.status ? human(v.d1.status) : '—'}</b>
        <span>Parent position</span>
        <b>{pct(v.live?.positionD1 ?? v.channelPosition ?? v.d1?.position ?? null, 1)}</b>
        <span>Current HTF phase</span>
        <b>{human(v.phase)}</b>
        <span>Nested channel</span>
        <b>{v.nested?.h1Status && v.nested.h1Status !== 'NOT_DETECTED' ? channelLabel('H1', v.h1) : 'NOT DETECTED'}</b>
        <span>Nested direction</span>
        <b>{v.nested?.h1Direction ? human(v.nested.h1Direction) : '—'}</b>
        <span>Nested status</span>
        <b>{v.nested?.h1Status ? human(v.nested.h1Status) : 'NOT DETECTED'}</b>
        <span>Relationship</span>
        <b>{v.nested?.h1Status && v.nested.h1Status !== 'NOT_DETECTED' ? human(v.nested.h1Relationship) : v.nested?.relationship ? human(v.nested.relationship) : '—'}</b>
        <span>Correction state</span>
        <b>{v.nested?.currentLeg ? human(v.nested.currentLeg) : '—'}</b>
        <span>Expected destination</span>
        <b>{v.nested?.expectedDestination ? human(v.nested.expectedDestination) : '—'}</b>
        <span>Invalidation</span>
        <b>{v.invalidation[0] ?? '—'}</b>
        <span>Trade permission</span>
        <b>{v.scanner?.qualified ? 'ANALYSIS ONLY' : 'BLOCKED'}</b>
        <span>Blocking reason</span>
        <b>{v.scanner?.qualified ? 'Execution stays off until Stage 8 authorises and the operator enables it' : v.scanner?.reason || v.reason}</b>
        <span>Breakout / retest</span>
        <b>{v.d1?.breakout || v.h8?.breakout ? [v.d1?.breakout && `D1 ${breakoutText(v.d1)}`, v.h8?.breakout && `H8 ${breakoutText(v.h8)}`].filter(Boolean).join(' · ') : 'None — price inside both channels'}</b>
        <span>Market Scanner (Stage 4)</span>
        <b>
          <Badge tone={v.scanner?.qualified ? 'green' : 'red'}>{v.scanner?.qualified ? 'PROMOTED' : 'NOT PROMOTED'}</Badge> <small className="muted">{v.scanner?.reason}</small>
          {v.scanner?.qualified && (
            <small className="muted hv-block">
              {[
                v.scanner.differential != null ? `differential ${v.scanner.differential > 0 ? '+' : ''}${v.scanner.differential.toFixed(2)}` : null,
                v.scanner.relationship ? human(v.scanner.relationship) : null,
                v.scanner.confidence != null ? `regime confidence ${v.scanner.confidence.toFixed(0)}` : null,
                v.scanner.freshness ? `strength ${v.scanner.freshness.toLowerCase()}` : null,
                v.scanner.liveEligible === false ? 'structural only (market closed)' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          )}
        </b>
        <span>Freshness</span>
        <b>
          Analysed {ageText(v.analysedAt, now)} · {v.trigger ?? '—'}
          <small className="muted hv-block">
            Last closed D1 {v.d1?.lastTs ? barLabel(v.d1.lastTs, 'D1', true) : '—'} · H8 {v.h8?.lastTs ? barLabel(v.h8.lastTs, 'H8') : '—'}
            {v.live?.tickTs ? ` · ${v.live.marketOpen ? 'live quote' : 'market closed, last tick'} ${new Date(v.live.tickTs * 1000).toLocaleString()}` : ''}
          </small>
        </b>
      </div>
      {v.reasoning.length > 1 && (
        <>
          <h4 className="hr-sub">Reasoning</h4>
          <ul className="hv-list">
            {v.reasoning.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {v.invalidation.length > 0 && (
        <>
          <h4 className="hr-sub">Invalidation conditions</h4>
          <ul className="hv-list hv-inval">
            {v.invalidation.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}
      <p className="cs-note muted">Published to Structural Direction (Stage 6). Stage 5 describes structure only and never executes trades.</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ drill-down */

function EvidenceTable({ rows }: { rows: Evidence[] }) {
  if (!rows.length) return <p className="hr-reason">No evidence factors recorded.</p>;
  return (
    <div className="table-wrap">
      <table className="cs-table">
        <thead>
          <tr>
            <th>TF</th>
            <th>Factor</th>
            <th>Value</th>
            <th>Points</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={`${e.tf}${e.factor}${i}`}>
              <td>{e.tf ?? '—'}</td>
              <td>{e.factor}</td>
              <td>{e.value}</td>
              <td className={e.points < 0 ? 'negative' : undefined}>
                {num(e.points, 1)} / {e.max}
              </td>
              <td className="hv-wrap">{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TfDetail({ tf, rec }: { tf: VisionTf; rec: ChannelRecord | null }) {
  const a = rec?.analysis;
  if (!rec) return <p className="hr-reason">No {tf} record persisted yet.</p>;
  const d = priceDigits(a?.lastClose);
  const p = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(d));
  return (
    <div className="hv-tf">
      <div className="md-kpi">
        <div>
          <span>Data</span>
          <b>{human(rec.dataStatus)}</b>
        </div>
        <div>
          <span>Bars</span>
          <b>
            {rec.available}/{rec.required}
          </b>
        </div>
        <div>
          <span>Status</span>
          <b>{human(a?.status)}</b>
        </div>
        <div>
          <span>Confidence</span>
          <b>{pct(a?.confidence, 1)}</b>
        </div>
      </div>
      <p className="hr-reason">{rec.dataStatus !== 'READY' ? rec.dataReason : a?.reason}</p>
      {a && a.status !== 'NONE' && (
        <>
          <div className="kv hv-kv">
            <span>Anchor side</span>
            <b>{a.anchorSide ?? '—'}</b>
            <span>Touch #1 anchor</span>
            <b>{a.anchor ? `${barLabel(a.anchor.ts, tf, true)} @ ${p(a.anchor.price)}` : '—'}</b>
            <span>Touch #2 candidate</span>
            <b>{a.candidate ? `${barLabel(a.candidate.ts, tf, true)} @ ${p(a.candidate.price)}` : '—'}</b>
            <span>Touch #3 validation</span>
            <b>{a.validation ? `${barLabel(a.validation.ts, tf, true)} @ ${p(a.validation.price)}` : 'Not yet validated'}</b>
            {a.lineDefinedBy && a.lineDefinedBy.length === 2 && (
              <>
                <span>Boundary line through</span>
                <b>{a.lineDefinedBy.map((x) => `${barLabel(x.ts, tf, true)} @ ${p(x.price)}`).join(' → ')}</b>
              </>
            )}
            <span>Boundaries now</span>
            <b>
              {p(a.lower)} – {p(a.upper)} <small className="muted">(next bar {p(a.lowerNext)} – {p(a.upperNext)})</small>
            </b>
            <span>Slope</span>
            <b>
              {a.slope != null ? `${a.slope.toFixed(d + 1)} per bar` : '—'} · {num(a.slopeAtr20, 2)} ATR/20 bars
            </b>
            <span>Width</span>
            <b>
              {p(a.width)} · {num(a.widthAtr, 2)} ATR
            </b>
            <span>Parallelism</span>
            <b>
              {a.parallelDev != null ? `${a.parallelDev.toFixed(2)} drift` : 'Not measurable'} · {a.parallelOk ? 'within tolerance' : 'outside tolerance'}
            </b>
            <span>Boundary respect</span>
            <b>
              {a.violations ?? 0} closes outside ({pct(a.violationShare != null ? a.violationShare * 100 : null, 1)})
            </b>
            <span>Age / span</span>
            <b>
              {a.ageBars ?? '—'} bars since anchor · {a.spanBars ?? '—'} bars touched span
            </b>
            <span>ATR14 / ATR50</span>
            <b>
              {p(a.atr)} / {p(a.atrSlow)} · {human(a.volState)}
            </b>
            <span>Phase</span>
            <b>{human(a.phase)}</b>
            <span>Breakout</span>
            <b>
              {a.breakout
                ? `${a.breakout.side} at ${barLabel(a.breakout.ts, tf, true)} · max ${num(a.breakout.maxDistanceAtr, 1)} ATR${a.breakout.retesting ? ' · retesting' : ''}`
                : 'None'}
            </b>
            <span>Failed breakouts</span>
            <b>{a.failedBreakouts?.length ? a.failedBreakouts.map((f) => `${f.side} ${barLabel(f.ts, tf)}`).join(', ') : 'None'}</b>
          </div>
          <h4 className="hr-sub">Touches ({a.touchList.length})</h4>
          <div className="table-wrap">
            <table className="cs-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Boundary</th>
                  <th>Role</th>
                  <th>Bar</th>
                  <th>Price</th>
                  <th>Line</th>
                  <th>Deviation</th>
                </tr>
              </thead>
              <tbody>
                {a.touchList.map((t) => (
                  <tr key={`${t.seq}${t.ts}`}>
                    <td>{t.seq}</td>
                    <td>{t.boundary}</td>
                    <td>{human(t.role)}</td>
                    <td>{barLabel(t.ts, tf, true)}</td>
                    <td>{p(t.price)}</td>
                    <td>{p(t.line)}</td>
                    <td>
                      {t.deviationAtr >= 0 ? '+' : ''}
                      {t.deviationAtr.toFixed(2)} ATR
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {a.invalidation.length > 0 && (
            <>
              <h4 className="hr-sub">Invalidation</h4>
              <ul className="hv-list hv-inval">
                {a.invalidation.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          <h4 className="hr-sub">{tf} confidence evidence</h4>
          <EvidenceTable rows={a.evidence.map((e) => ({ ...e, tf }))} />
        </>
      )}
    </div>
  );
}

function VisionDrawer({ symbol, version, onClose }: { symbol: string; version: string; onClose: () => void }) {
  const [detail, setDetail] = useState<VisionDetail | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'D1' | 'H8' | 'Agreement' | 'Events' | 'History'>('D1');

  useEffect(() => {
    let cancelled = false;
    setErr('');
    fetchVisionDetail(symbol)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Detail unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, version]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const v = detail?.instrument;
  return (
    <div className="md-overlay" onClick={onClose}>
      <aside className="md-drawer hr-drawer hv-drawer" role="dialog" aria-modal="true" aria-label={`${symbol} structural drill-down`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <small>STAGE 5 · STRUCTURAL DRILL-DOWN</small>
            <h2>
              {symbol} {v && <Badge tone={headline(v).tone}>{headline(v).label}</Badge>}
            </h2>
          </div>
          <button type="button" className="md-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="md-drawer-body">
          {err && (
            <div className="hr-banner err">
              <AlertTriangle size={14} />
              <span>{err}</span>
            </div>
          )}
          {!detail && !err && <p className="hr-reason">Loading persisted analysis…</p>}
          {detail && !v && <p className="hr-reason">{symbol} has not been analysed yet.</p>}
          {v && (
            <>
              <div className="md-kpi">
                <div>
                  <span>Status</span>
                  <b>{human(v.status)}</b>
                </div>
                <div>
                  <span>Primary</span>
                  <b>{human(v.primaryDirection)}</b>
                </div>
                <div>
                  <span>Agreement</span>
                  <b>{human(v.agreement)}</b>
                </div>
                <div>
                  <span>Confidence</span>
                  <b>{pct(v.confidence, 1)}</b>
                </div>
              </div>
              <p className="hr-reason">{v.reason}</p>
              <Tabs items={['D1', 'H8', 'Agreement', 'Events', 'History']} active={tab} onChange={(x) => setTab(x as typeof tab)} idPrefix="hv-dd" label="Drill-down section" />
              {tab === 'D1' && <TfDetail tf="D1" rec={detail.channels.D1} />}
              {tab === 'H8' && <TfDetail tf="H8" rec={detail.channels.H8} />}
              {tab === 'Agreement' && (
                <>
                  <div className="kv hv-kv">
                    <span>D1 (primary)</span>
                    <b>
                      {human(v.d1?.status)} · {v.d1?.confirmed ? human(v.d1.direction) : 'unconfirmed'} · {pct(v.d1?.confidence, 1)}
                    </b>
                    <span>H8 (refinement)</span>
                    <b>
                      {human(v.h8?.status)} · {v.h8?.confirmed ? human(v.h8.direction) : 'unconfirmed'} · {pct(v.h8?.confidence, 1)}
                    </b>
                    <span>Agreement</span>
                    <b>{human(v.agreement)}</b>
                    <span>Combined confidence</span>
                    <b>
                      0.65 × D1 + 0.35 × H8{v.agreement === 'AGREE' ? ' + 5 agreement' : v.agreement === 'CONFLICT' ? ' − 12 conflict' : ''} = {pct(v.confidence, 1)}
                      {v.status === 'STALE' ? ' (×0.6 stale)' : ''}
                    </b>
                  </div>
                  <h4 className="hr-sub">Reasoning</h4>
                  <ul className="hv-list">
                    {v.reasoning.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <h4 className="hr-sub">Confidence evidence</h4>
                  <EvidenceTable rows={v.evidence} />
                </>
              )}
              {tab === 'Events' && <EventList events={detail.events} />}
              {tab === 'History' && (
                <div className="table-wrap">
                  <table className="cs-table">
                    <thead>
                      <tr>
                        <th>D1 bar</th>
                        <th>H8 bar</th>
                        <th>Status</th>
                        <th>Direction</th>
                        <th>Agreement</th>
                        <th>Phase</th>
                        <th>D1 pos</th>
                        <th>Conf.</th>
                        <th>Trigger</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.history.map((h) => (
                        <tr key={`${h.d1BarTs}-${h.h8BarTs}`}>
                          <td>{barLabel(h.d1BarTs, 'D1', true)}</td>
                          <td>{barLabel(h.h8BarTs, 'H8')}</td>
                          <td>{human(h.status)}</td>
                          <td>
                            <Badge tone={dirTone(h.primaryDirection)}>{human(h.primaryDirection)}</Badge>
                          </td>
                          <td>{human(h.agreement)}</td>
                          <td>{human(h.phase)}</td>
                          <td>{pct(h.d1.position, 0)}</td>
                          <td>{pct(h.confidence, 0)}</td>
                          <td>{h.trigger ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!detail.history.length && <p className="hr-reason">No history rows yet.</p>}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ events */

const EVENT_TONE: Record<string, string> = {
  BREAKOUT: 'red',
  FAILED_BREAKOUT: 'amber',
  RETEST: 'amber',
  INVALIDATED: 'gray',
  CHANNEL_VALIDATED: 'green',
  NEW_CHANNEL: 'blue',
  BOUNDARY_APPROACH: 'amber',
  INTRABAR_BREACH: 'red',
  VOLATILITY_SPIKE: 'amber',
  DATA_BLOCKED: 'red',
};

function EventList({ events, onSymbol }: { events: VisionEvent[]; onSymbol?: (s: string) => void }) {
  if (!events.length) return <p className="hr-reason">No structural events recorded.</p>;
  return (
    <div className="table-wrap hv-events">
      <table className="cs-table">
        <thead>
          <tr>
            <th>Bar</th>
            {onSymbol && <th>Instrument</th>}
            <th>TF</th>
            <th>Event</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{barLabel(e.ts, e.timeframe, true)}</td>
              {onSymbol && (
                <td>
                  <button type="button" className="cs-link" onClick={() => onSymbol(e.symbol)}>
                    {e.symbol}
                  </button>
                </td>
              )}
              <td>{e.timeframe}</td>
              <td>
                <Badge tone={EVENT_TONE[e.type] ?? (e.severity === 'WARNING' ? 'amber' : e.severity === 'ERROR' ? 'red' : 'blue')}>{human(e.type)}</Badge>
              </td>
              <td className="hv-wrap">{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

function matches(v: VisionInstrument, f: Filter): boolean {
  switch (f) {
    case 'Qualified':
      return !!v.scanner?.qualified;
    case 'Confirmed D1':
      return v.status === 'READY' && !!v.d1?.confirmed;
    case 'Breakout / retest':
      return !!(v.d1?.breakout || v.h8?.breakout) || v.phase === 'BREAKOUT' || v.phase === 'RETEST' || v.phase === 'FAILED_BREAKOUT';
    case 'Conflict':
      return v.agreement === 'CONFLICT';
    case 'Data issues':
      return v.status !== 'READY';
    default:
      return true;
  }
}

export function HtfVisionPage() {
  const { selected, setSelected, instruments: live } = useTrading();
  const store = useVisionStore();
  const [view, setView] = useState<View>('D1');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [drawer, setDrawer] = useState<string | null>(null);
  const [eventsAll, setEventsAll] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => startVisionStore(), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const list = useMemo(() => {
    const rows = store.state?.instruments ?? [];
    return [...rows].sort(
      (a, b) => Number(!!b.scanner?.qualified) - Number(!!a.scanner?.qualified) || (b.scanner?.conviction ?? 0) - (a.scanner?.conviction ?? 0) || a.symbol.localeCompare(b.symbol),
    );
  }, [store.state]);

  const shown = list.filter((v) => matches(v, filter) && v.symbol.toLowerCase().includes(query.trim().toLowerCase()));
  const v = list.find((i) => i.symbol === selected) ?? list[0] ?? null;
  const version = `${v?.analysedAt ?? ''}|${v?.d1?.lastTs ?? ''}|${v?.h8?.lastTs ?? ''}`;
  const charts = useCharts(v?.symbol ?? null, version);

  const liveRow = v ? live.find((i) => i.symbol === v.symbol) : undefined;
  const livePrice = liveRow && liveRow.bid > 0 && liveRow.ask >= liveRow.bid ? (liveRow.bid + liveRow.ask) / 2 : v?.live?.price ?? null;

  const status = visionStageStatus(store, now);
  const run = store.state?.run;
  const svc = store.state?.service;
  const age = visionRunAgeMs(store, now);
  const summary = run?.summary;
  const events = (store.state?.events ?? []).filter((e) => eventsAll || e.symbol === v?.symbol).slice(0, 60);
  const svcCfg = run?.config?.service as { loopSec?: number; fullEverySec?: number; scannerGate?: string } | undefined;

  return (
    <div className="hv-page">
      <PageHeader title="HTF Market Vision" subtitle="Autonomous D1/H8 channel detection, touch validation, phase and structural confidence (Stage 5)" />
      <div className="hr-status">
        <Badge tone={status === 'HEALTHY' ? 'green' : status === 'DEGRADED' || status === 'STALE' ? 'amber' : status === 'ERROR' ? 'red' : 'gray'}>STAGE 5 {status}</Badge>
        <span>{run?.message ?? (store.loading ? 'Loading persisted Stage 5 state…' : 'No Stage 5 run recorded yet')}</span>
        {age != null && (
          <span className="muted">
            Last run {ageText(run?.runAt, now)}
            {run?.triggers?.length ? ` · ${run.triggers.slice(0, 4).join(', ')}` : ''}
            {run?.durationMs != null ? ` · ${run.durationMs} ms` : ''}
          </span>
        )}
        {svcCfg && (
          <span className="muted">
            {store.error ? 'Last reported schedule, not a live engine. ' : ''}
            Bridge loop {svcCfg.loopSec}s · full sweep {Math.round((svcCfg.fullEverySec ?? 0) / 60)}m · scanner gate {svcCfg.scannerGate}
          </span>
        )}
        <button type="button" className="hr-run" title="Diagnostic reprocess for this instrument. Stage 5 already runs from promotions and D1/H8 closes." disabled={store.running || !v} onClick={() => v && void runVisionNow(v.symbol)}>
          <RefreshCw size={14} className={store.running ? 'hr-spin' : undefined} />
          {store.running ? 'Analysing…' : `Re-analyse ${v?.symbol ?? ''}`}
        </button>
      </div>
      {store.error && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>{store.error} — Stage 5 output is not published while the bridge is unreachable.</span>
        </div>
      )}
      {status === 'STALE' && !store.error && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>Stage 5 output is stale ({ageText(run?.runAt, now)}): the bridge engine has not completed a run within 20 minutes. Structural Direction treats it as unconfirmed.</span>
        </div>
      )}
      {(svc?.lastError || run?.status === 'DEGRADED') && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>
            {run?.failedNow ? `${run.failedNow} instrument(s) failed in the last run — failures are isolated per instrument. ` : ''}
            {svc?.lastError ?? ''}
          </span>
        </div>
      )}

      <div className="metrics hv-metrics">
        <Metric label="Analysed" value={summary?.analysed ?? list.length} sub={store.error ? 'Last known · bridge offline' : `${summary?.ready ?? list.filter((i) => i.status === 'READY').length} READY`} />
        <Metric label="Scanner qualified" value={summary?.qualified ?? list.filter((i) => i.scanner?.qualified).length} sub={store.error ? 'Not a live qualification' : `gate ${svcCfg?.scannerGate ?? list[0]?.scanner?.gate ?? '—'}`} />
        <Metric label="Confirmed D1 channels" value={summary?.confirmedD1 ?? list.filter((i) => i.status === 'READY' && i.d1?.confirmed).length} sub={store.error ? 'Last known · not published live' : '≥3 touches, parallel opposite side'} />
        <Metric label="D1 / H8 agree" value={summary?.agree ?? list.filter((i) => i.agreement === 'AGREE').length} sub={store.error ? 'Last known' : `${summary?.conflict ?? list.filter((i) => i.agreement === 'CONFLICT').length} in conflict`} />
      </div>

      <Card className="hv-picker">
        <div className="hv-picker-head">
          <label className="hv-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search instrument" aria-label="Search instrument" />
          </label>
          <div className="hr-chips" role="group" aria-label="Filter instruments">
            {FILTERS.map((f) => (
              <button key={f} type="button" className={filter === f ? 'on' : ''} style={{ borderColor: '#2b4d6e', color: '#cfe3f7' }} onClick={() => setFilter(f)}>
                {f} <small>{list.filter((x) => matches(x, f)).length}</small>
              </button>
            ))}
          </div>
        </div>
        {!list.length ? (
          <div className="empty-block">
            <b>{store.loading ? 'Loading…' : 'No Stage 5 instruments'}</b>
            <span>{store.error || 'The bridge analyses the Market Scanner universe on startup; no instrument has been persisted yet.'}</span>
          </div>
        ) : (
          <div className="hv-symbols" role="listbox" aria-label="Instruments">
            {shown.map((x) => (
              <button
                key={x.symbol}
                type="button"
                role="option"
                aria-selected={x.symbol === v?.symbol}
                className={`hv-sym ${x.symbol === v?.symbol ? 'on' : ''} ${x.scanner?.qualified ? '' : 'dim'}`}
                onClick={() => setSelected(x.symbol)}
                title={`${x.symbol}: ${x.status} · ${x.reason}`}
              >
                <i className={`hv-dot ${dataTone(x.status)}`} />
                <b className={x.symbol === 'XAUUSD' ? 'hr-gold' : undefined}>{x.symbol}</b>
                <span className={x.status === 'READY' && x.d1?.confirmed ? dirTone(x.primaryDirection) : 'gray'}>
                  {x.status === 'READY' && x.d1?.confirmed ? dirArrow(x.primaryDirection) : x.status === 'READY' ? '·' : '!'}
                </span>
              </button>
            ))}
            {!shown.length && <span className="muted">No instrument matches this filter.</span>}
          </div>
        )}
      </Card>

      {v && (
        <div className="grid-vision hv-grid">
          <ChartCard v={v} charts={charts} view={view} setView={setView} livePrice={livePrice} offline={Boolean(store.error)} />
          <Interpretation v={v} now={now} onInspect={() => setDrawer(v.symbol)} />
        </div>
      )}

      <Card>
        <div className="card-head">
          <div>
            <h3>Structural Universe</h3>
            <p>Every instrument analysed by Stage 5 · click a row to chart it, Inspect for the full evidence</p>
          </div>
          <Badge tone="blue">{list.length} instruments</Badge>
        </div>
        <div className="table-wrap">
          <table className="cs-table hv-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Scanner</th>
                <th>Status</th>
                <th>D1</th>
                <th>H8</th>
                <th>Agreement</th>
                <th>Phase</th>
                <th>Position</th>
                <th>Confidence</th>
                <th>Analysed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.symbol} className={`hr-click ${x.symbol === v?.symbol ? 'cs-focus' : ''}`} onClick={() => setSelected(x.symbol)}>
                  <td>
                    <b className={x.symbol === 'XAUUSD' ? 'hr-gold' : undefined}>{x.symbol}</b>
                  </td>
                  <td>
                    <Badge tone={x.scanner?.qualified ? 'green' : 'gray'}>{x.scanner?.qualified ? x.scanner.bias ?? 'YES' : 'NO'}</Badge>
                  </td>
                  <td title={x.reason}>
                    <Badge tone={dataTone(x.status)}>{human(x.status)}</Badge>
                  </td>
                  {(['d1', 'h8'] as const).map((k) => (
                    <td key={k} title={x[k]?.reason ?? x[k]?.dataReason}>
                      {x[k]?.dataStatus !== 'READY' ? (
                        <small className="muted">{human(x[k]?.dataStatus)}</small>
                      ) : (
                        <span className="hv-tfcell">
                          <Badge tone={statusTone(x[k]?.status)}>{!x[k]?.status ? 'NOT ANALYSED' : human(x[k]?.status === 'NONE' ? 'NO CHANNEL' : x[k]?.status)}</Badge>
                          <b className={x[k]?.confirmed ? dirTone(x[k]?.direction) : 'gray'}>{x[k]?.confirmed ? dirArrow(x[k]?.direction) : '·'}</b>
                        </span>
                      )}
                    </td>
                  ))}
                  <td>
                    <Badge tone={agreeTone(x.agreement)}>{human(x.agreement)}</Badge>
                  </td>
                  <td>{human(x.phase)}</td>
                  <td>{pct(visionPosition(x, 'd1'), 0)}</td>
                  <td>
                    <Conf v={x.status === 'BLOCKED' ? null : x.confidence} />
                  </td>
                  <td className="muted">{ageText(x.analysedAt, now)}</td>
                  <td>
                    <button
                      type="button"
                      className="cs-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDrawer(x.symbol);
                      }}
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h3>Recent Structural Events</h3>
            <p>Touches, validations, breakouts, failed breakouts, retests, invalidations and live boundary approaches persisted by the engine</p>
          </div>
          <div className="hr-chips" role="group" aria-label="Event scope">
            <button type="button" className={!eventsAll ? 'on' : ''} style={{ borderColor: '#2b4d6e', color: '#cfe3f7' }} onClick={() => setEventsAll(false)}>
              {v?.symbol ?? 'Selected'}
            </button>
            <button type="button" className={eventsAll ? 'on' : ''} style={{ borderColor: '#2b4d6e', color: '#cfe3f7' }} onClick={() => setEventsAll(true)}>
              All instruments
            </button>
          </div>
        </div>
        <EventList events={events} onSymbol={eventsAll ? setSelected : undefined} />
      </Card>

      {drawer && <VisionDrawer symbol={drawer} version={version} onClose={() => setDrawer(null)} />}
    </div>
  );
}
