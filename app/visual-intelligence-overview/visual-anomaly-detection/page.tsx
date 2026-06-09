'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  DatabaseZap,
  Flame,
  Gauge,
  Menu,
  Radio,
  RefreshCw,
  ShieldAlert,
  Siren,
  Sparkles,
  Waves,
  type LucideIcon,
} from 'lucide-react';

import { TraderSidebar } from '@/components/trader-sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Timeframe = 'W' | 'D' | 'H4' | 'H1' | 'M15';
type Severity = 'Low' | 'Medium' | 'High' | 'Critical';
type Tone = 'green' | 'amber' | 'red' | 'purple' | 'navy' | 'blue' | 'slate';

interface Anomaly {
  id: string;
  anomalyType: string;
  severity: Severity;
  affectedTimeframe: string;
  affectedPriceZone: { low: number | null; high: number | null; midpoint: number | null };
  visualCoordinates: Record<string, unknown>;
  probabilityScore: number;
  tradingRiskMeaning: string;
  possibleCause: string;
  recommendedAction: string;
  resolved: boolean;
  createdAt: string;
}

interface AnomalyReport {
  job: {
    id: string;
    captureId: string | null;
    symbol: string;
    timeframe: string;
    status: string;
    modelVersion: string;
    createdAt: string;
  };
  severity: {
    lowCount: number;
    mediumCount: number;
    highCount: number;
    criticalCount: number;
    overallSeverity: Severity;
    manipulationProbability: number;
    feedQualityScore: number;
    imageIntegrityScore: number;
    volatilitySpikeScore: number;
    explanation: string;
  };
  anomalies: Anomaly[];
}

const timeframes: Timeframe[] = ['W', 'D', 'H4', 'H1', 'M15'];

export default function VisualAnomalyDetectionPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('H1');
  const [report, setReport] = useState<AnomalyReport | null>(null);
  const [history, setHistory] = useState<AnomalyReport[]>([]);
  const [events, setEvents] = useState<Array<{ type: string; message: string; time: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState('');

  const openAnomalies = useMemo(() => report?.anomalies.filter((item) => !item.resolved) ?? [], [report]);
  const critical = report?.severity.criticalCount ?? 0;
  const high = report?.severity.highCount ?? 0;
  const medium = report?.severity.mediumCount ?? 0;
  const low = report?.severity.lowCount ?? 0;

  useEffect(() => {
    const tick = () => setNow(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Lagos',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date()));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const latest = await fetch(`/api/visual-analysis/anomaly/${encodeURIComponent(symbol)}/${timeframe}/latest`, { cache: 'no-store' });
        if (latest.ok) {
          const payload = await latest.json();
          if (active) setReport(payload.report);
        } else {
          const analyzed = await fetch('/api/visual-analysis/anomaly/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol, timeframe }),
          });
          const payload = await analyzed.json();
          if (!payload.ok) throw new Error(payload.error ?? 'Unable to run anomaly scan.');
          if (active) setReport(payload.report);
        }

        const historyResponse = await fetch(`/api/visual-analysis/anomaly/${encodeURIComponent(symbol)}/history?limit=12`, { cache: 'no-store' });
        const historyPayload = await historyResponse.json();
        if (active && historyPayload.ok) setHistory(historyPayload.history ?? []);
      } catch (caught) {
        if (active) {
          setReport(null);
          setError(caught instanceof Error ? caught.message : 'Unable to load anomaly report.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    loadReport();
    return () => {
      active = false;
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    const source = new EventSource('/api/visual-intelligence/stream');
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { eventType?: string; payload?: Record<string, unknown> };
        if (!event.eventType?.startsWith('anomaly.')) return;
        setEvents((items) => [{
          type: event.eventType ?? 'anomaly.event',
          message: String(event.payload?.anomalyType ?? event.payload?.overallSeverity ?? event.payload?.symbol ?? 'visual anomaly update'),
          time: new Date().toLocaleTimeString(),
        }, ...items].slice(0, 10));
      } catch {
        // Keep anomaly event stream resilient to keepalive chunks.
      }
    };
    return () => source.close();
  }, []);

  async function runScan() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/visual-analysis/anomaly/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Unable to run anomaly scan.');
      setReport(payload.report);
      setHistory((items) => [payload.report, ...items.filter((item) => item.job.id !== payload.report.job.id)].slice(0, 12));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to run anomaly scan.');
    } finally {
      setLoading(false);
    }
  }

  async function resolveAnomaly(id: string) {
    const response = await fetch(`/api/visual-analysis/anomaly/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Resolved from Visual Anomaly Detection dashboard.' }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error ?? 'Unable to resolve anomaly.');
      return;
    }
    setReport((current) => current ? {
      ...current,
      anomalies: current.anomalies.map((item) => item.id === id ? { ...item, resolved: true } : item),
    } : current);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-950">
      <TraderSidebar bridgeOnline mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />

      <main className="min-w-0 flex-1 overflow-y-auto bg-white">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur md:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button size="icon" variant="outline" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold md:text-xl">Visual Anomaly Detection</h1>
                <p className="truncate text-xs font-mono text-blue-700">Volatility, wick, gap, feed integrity and manipulation surveillance</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <HeaderChip icon={Radio} label="Stream" value="anomaly.live" tone="green" />
              <HeaderChip icon={Siren} label="Severity" value={report?.severity.overallSeverity ?? 'SYNC'} tone={toneForSeverity(report?.severity.overallSeverity)} />
              <HeaderChip icon={DatabaseZap} label="Feed Quality" value={`${Math.round((report?.severity.feedQualityScore ?? 1) * 100)}%`} tone="blue" />
              <HeaderChip icon={Activity} label="WAT" value={now || '--:--:--'} tone="slate" />
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto]">
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold shadow-sm outline-none focus:border-blue-400"
              aria-label="Symbol"
            />
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {timeframes.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTimeframe(item)}
                  className={cn('h-8 flex-1 rounded-md text-xs font-semibold transition', timeframe === item ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900')}
                >
                  {item}
                </button>
              ))}
            </div>
            <Button onClick={runScan} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Run Scan
            </Button>
          </div>
        </header>

        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="space-y-4">
            {error ? (
              <Card className="border-rose-200 bg-rose-50">
                <CardContent className="flex items-center gap-2 p-4 text-sm font-semibold text-rose-700">
                  <AlertTriangle className="h-4 w-4" /> {error}
                </CardContent>
              </Card>
            ) : null}

            <div className="grid gap-3 md:grid-cols-4">
              <SeverityCard label="Low" value={low} tone="green" />
              <SeverityCard label="Medium" value={medium} tone="amber" />
              <SeverityCard label="High" value={high} tone="red" />
              <SeverityCard label="Critical" value={critical} tone="navy" />
            </div>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-200">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-5 w-5 text-blue-600" /> Anomaly Dashboard
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <AnomalyHeatmap anomalies={openAnomalies} />
                <div className="space-y-3">
                  <Meter label="Manipulation probability" value={(report?.severity.manipulationProbability ?? 0) * 100} tone="purple" />
                  <Meter label="Volatility spike" value={(report?.severity.volatilitySpikeScore ?? 0) * 100} tone="red" />
                  <Meter label="Image integrity" value={(report?.severity.imageIntegrityScore ?? 1) * 100} tone="green" />
                  <Meter label="Feed quality" value={(report?.severity.feedQualityScore ?? 1) * 100} tone="blue" />
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <DetectorCard icon={Flame} title="Abnormal Candle Detector" tone="red" anomaly={findAnomaly(openAnomalies, ['Abnormally large candle', 'Price displacement without normal structure'])} />
              <DetectorCard icon={Waves} title="Abnormal Wick Detector" tone="purple" anomaly={findAnomaly(openAnomalies, ['Abnormally long wick', 'Stop hunt spike', 'Liquidity sweep anomaly'])} />
              <DetectorCard icon={Activity} title="Price Gap Detector" tone="amber" anomaly={findAnomaly(openAnomalies, ['Sudden gap', 'Missing candle anomaly'])} />
              <DetectorCard icon={DatabaseZap} title="Feed Quality Detector" tone="navy" anomaly={findAnomaly(openAnomalies, ['Chart feed distortion', 'Duplicate candle anomaly', 'Missing candle anomaly'])} />
              <DetectorCard icon={ShieldAlert} title="Manipulation Alert Panel" tone="purple" anomaly={findAnomaly(openAnomalies, ['Manipulation probability elevated', 'Abnormally long wick', 'Unusual compression before expansion'])} />
              <DetectorCard icon={AlertOctagon} title="Broker/Chart Data Integrity Alert" tone="navy" anomaly={findAnomaly(openAnomalies, ['Chart feed distortion', 'Duplicate candle anomaly', 'Missing candle anomaly'])} />
            </div>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-200">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-5 w-5 text-purple-600" /> AI Explanation Panel
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <p className="text-sm leading-6 text-slate-600">{report?.severity.explanation ?? 'No anomaly explanation generated yet.'}</p>
              </CardContent>
            </Card>
          </section>

          <aside className="space-y-4">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Siren className="h-5 w-5 text-red-600" /> Real-Time Anomaly Feed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[360px] pr-3">
                  <div className="space-y-3">
                    {openAnomalies.map((anomaly) => (
                      <div key={anomaly.id} className={cn('rounded-lg border p-3', toneBorder(toneForSeverity(anomaly.severity)), toneBg(toneForSeverity(anomaly.severity)))}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-950">{anomaly.anomalyType}</p>
                            <p className="mt-1 font-mono text-xs text-slate-500">{anomaly.affectedTimeframe} / {Math.round(anomaly.probabilityScore * 100)}%</p>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => resolveAnomaly(anomaly.id)}>Resolve</Button>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-700">{anomaly.tradingRiskMeaning}</p>
                        <p className="mt-2 text-xs font-semibold text-slate-800">Action: {anomaly.recommendedAction}</p>
                      </div>
                    ))}
                    {!openAnomalies.length ? <p className="text-sm text-slate-500">No unresolved anomalies in the latest scan.</p> : null}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Radio className="h-5 w-5 text-emerald-600" /> WebSocket Events
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {events.map((event, index) => (
                    <div key={`${event.time}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <p className="text-xs font-semibold text-slate-900">{event.type}</p>
                      <p className="text-xs text-slate-500">{event.message} / {event.time}</p>
                    </div>
                  ))}
                  {!events.length ? <p className="text-sm text-slate-500">Live anomaly events will appear here.</p> : null}
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gauge className="h-5 w-5 text-blue-600" /> Symbol History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {history.slice(0, 6).map((item) => (
                    <div key={item.job.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-900">{item.job.timeframe}</p>
                        <span className={cn('font-mono text-xs', toneText(toneForSeverity(item.severity.overallSeverity)))}>{item.severity.overallSeverity}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{item.anomalies.length} anomaly signal(s)</p>
                    </div>
                  ))}
                  {!history.length ? <p className="text-sm text-slate-500">No anomaly history loaded yet.</p> : null}
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}

function SeverityCard(props: { label: Severity; value: number; tone: Tone }) {
  return (
    <Card className={cn('border shadow-sm', toneBorder(props.tone), toneBg(props.tone))}>
      <CardContent className="p-4">
        <p className="text-xs font-semibold text-slate-600">{props.label}</p>
        <p className={cn('mt-2 font-mono text-3xl font-semibold', toneText(props.tone))}>{props.value}</p>
      </CardContent>
    </Card>
  );
}

function AnomalyHeatmap({ anomalies }: { anomalies: Anomaly[] }) {
  const cells = Array.from({ length: 36 }, (_, index) => anomalies[index % Math.max(1, anomalies.length)]);
  return (
    <div className="grid grid-cols-6 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {cells.map((anomaly, index) => (
        <div
          key={index}
          className={cn('grid aspect-square place-items-center rounded-md border text-[10px] font-mono', anomaly ? heatClass(anomaly.severity) : 'border-emerald-200 bg-emerald-50 text-emerald-700')}
        >
          {anomaly ? Math.round(anomaly.probabilityScore * 99) : 0}
        </div>
      ))}
    </div>
  );
}

function DetectorCard(props: { icon: LucideIcon; title: string; tone: Tone; anomaly?: Anomaly }) {
  const Icon = props.icon;
  const tone = props.anomaly ? toneForSeverity(props.anomaly.severity) : 'green';
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="flex items-center gap-2"><Icon className={cn('h-5 w-5', toneText(props.tone))} /> {props.title}</span>
          <span className={cn('rounded-md border px-2 py-1 text-[11px] font-semibold', toneBorder(tone), toneBg(tone), toneText(tone))}>
            {props.anomaly?.severity ?? 'Normal'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-slate-600">{props.anomaly?.tradingRiskMeaning ?? 'No active anomaly detected in this detector.'}</p>
        <p className="mt-3 text-xs font-semibold text-slate-700">{props.anomaly ? `Cause: ${props.anomaly.possibleCause}` : 'Action: Ignore'}</p>
      </CardContent>
    </Card>
  );
}

function Meter(props: { label: string; value: number; tone: Tone }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-600">{props.label}</span>
        <span className={cn('font-mono font-semibold', toneText(props.tone))}>{Math.round(props.value)}%</span>
      </div>
      <Progress value={props.value} className="h-2 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600" />
    </div>
  );
}

function HeaderChip(props: { icon: LucideIcon; label: string; value: string; tone: Tone }) {
  const Icon = props.icon;
  return (
    <div className={cn('rounded-lg border px-3 py-2 shadow-sm', toneBorder(props.tone), toneBg(props.tone))}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', toneText(props.tone))} />
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500">{props.label}</p>
          <p className="truncate font-mono text-xs font-semibold text-slate-950">{props.value}</p>
        </div>
      </div>
    </div>
  );
}

function findAnomaly(anomalies: Anomaly[], names: string[]) {
  return anomalies.find((item) => names.includes(item.anomalyType));
}

function toneForSeverity(severity?: Severity): Tone {
  if (severity === 'Critical') return 'navy';
  if (severity === 'High') return 'red';
  if (severity === 'Medium') return 'amber';
  if (severity === 'Low') return 'green';
  return 'green';
}

function heatClass(severity: Severity) {
  return {
    Low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    Medium: 'border-amber-200 bg-amber-50 text-amber-700',
    High: 'border-rose-200 bg-rose-50 text-rose-700',
    Critical: 'border-slate-800 bg-slate-950 text-white',
  }[severity];
}

function toneBorder(tone: Tone) {
  return {
    green: 'border-emerald-200',
    amber: 'border-amber-200',
    red: 'border-rose-200',
    purple: 'border-purple-200',
    navy: 'border-slate-800',
    blue: 'border-blue-200',
    slate: 'border-slate-200',
  }[tone];
}

function toneBg(tone: Tone) {
  return {
    green: 'bg-emerald-50',
    amber: 'bg-amber-50',
    red: 'bg-rose-50',
    purple: 'bg-purple-50',
    navy: 'bg-slate-950',
    blue: 'bg-blue-50',
    slate: 'bg-slate-50',
  }[tone];
}

function toneText(tone: Tone) {
  return {
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-rose-700',
    purple: 'text-purple-700',
    navy: 'text-slate-100',
    blue: 'text-blue-700',
    slate: 'text-slate-700',
  }[tone];
}
