'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CandlestickChart,
  Eye,
  GitBranch,
  Landmark,
  Layers3,
  Menu,
  PauseCircle,
  PlayCircle,
  Radar,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { DashboardPageFrame } from '@/components/dashboard-page-frame';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  type DashboardTone,
  toneBadge,
  toneBody,
  toneCard,
  toneCardHeader,
  toneInsetSurface,
  toneMetric,
  toneMuted,
  toneProgress,
  toneTitle,
} from '@/lib/dashboard-card-tones';
import { cn } from '@/lib/utils';

const TIMEFRAME_TONES: Record<string, DashboardTone> = {
  W: 'purple',
  D: 'blue',
  H4: 'emerald',
  H1: 'orange',
  M15: 'rose',
};

interface VisionRoom {
  systemStatus?: {
    autonomy?: { queuedJobs: number; runningJobs: number; recentFailures: number; openAlerts: number; nextRunAt: string | null };
    activeTimeframes?: string[];
    mode?: string;
  };
  liveCaptureFeed?: Capture[];
  timeframeMatrix?: MatrixRow[];
  screenshotEvidence?: Capture[];
  annotatedChart?: VisionAnalysis | null;
  institutionalLiquidityMap?: Record<string, unknown>;
  orderBlockAndFvgDetector?: { orderBlocks?: unknown[]; fairValueGaps?: unknown[] };
  marketStructureDetector?: Record<string, unknown>;
  smartMoneyBehavior?: string;
  retailTrapDetector?: string;
  aiReasoningConsole?: Record<string, unknown>;
  tradeOpportunityRadar?: Array<Record<string, unknown>>;
  executionReadiness?: Record<string, unknown> | null;
  riskIntelligence?: Record<string, unknown>;
  visionDecisionHistory?: Array<Record<string, unknown>>;
  auditLogs?: Array<Record<string, unknown>>;
}

interface Capture {
  id: string;
  symbol: string;
  timeframe: string;
  sourcePlatform: string;
  imageUrl: string;
  capturedAt: string;
  processingStatus: string;
}

interface MatrixRow {
  timeframe: string;
  bias: string;
  decision: string;
  confidenceScore: number;
  captureStatus: string;
  explanation: string;
}

interface VisionAnalysis {
  symbol: string;
  timeframe: string;
  confidenceScore: number;
  marketMeaning: string;
  institutionalInterpretation: string;
  retailTrapWarning: string;
  captureStatus: string;
  analysisStatus: string;
  createdAt: string;
}

export default function CacsmsVisionPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [room, setRoom] = useState<VisionRoom | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [serverGeneratedAt, setServerGeneratedAt] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => new Date());
  const [bridgeOnline, setBridgeOnline] = useState(false);

  const latest = room?.annotatedChart ?? null;
  const matrix = useMemo(() => room?.timeframeMatrix ?? [], [room]);
  const syncAgeMs = lastSyncAt ? Math.max(0, clockNow.getTime() - new Date(lastSyncAt).getTime()) : null;
  const isLive = syncAgeMs !== null && syncAgeMs < 6000;

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadBridgeStatus() {
      try {
        const response = await fetch('/api/mt5/status', { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!active) return;
        setBridgeOnline(Boolean(payload?.ok));
      } catch {
        if (active) setBridgeOnline(false);
      }
    }
    void loadBridgeStatus();
    const interval = window.setInterval(() => void loadBridgeStatus(), 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadRoom(initial = false) {
      if (initial) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const response = await fetch(`/api/cacsms-vision/status?symbol=${encodeURIComponent(symbol)}&t=${Date.now()}`, {
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!payload.ok) throw new Error(payload.error ?? 'Unable to load Cacsms Vision.');
        if (!active) return;
        setRoom(payload.room);
        setLastSyncAt(new Date().toISOString());
        setServerGeneratedAt(typeof payload.generatedAt === 'string' ? payload.generatedAt : null);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Unable to load Cacsms Vision.');
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void loadRoom(true);
    const interval = window.setInterval(() => void loadRoom(false), 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [symbol]);

  async function postAction(path: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Action failed.');
      const status = await fetch(`/api/cacsms-vision/status?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
      const next = await status.json();
      if (next.ok) setRoom(next.room);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardPageFrame
      bridgeOnline={bridgeOnline}
      mobileOpen={mobileSidebarOpen}
      onMobileOpenChange={setMobileSidebarOpen}
      className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden"
    >
        <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white px-4 py-3 md:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button size="icon" variant="outline" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-lg font-bold text-slate-950 md:text-xl">Cacsms Vision Intelligence Room</h1>
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', isLive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>
                    <span className={cn('h-2 w-2 rounded-full', isLive ? 'animate-pulse bg-emerald-500' : 'bg-amber-500')} />
                    {isLive ? 'Live' : 'Stale'}
                  </span>
                </div>
                <p className="truncate text-xs font-mono text-slate-500">
                  WAT {formatWatClock(clockNow)} · Synced {formatRelativeTime(lastSyncAt, clockNow)}
                  {serverGeneratedAt ? ` · Snapshot ${formatRelativeTime(serverGeneratedAt, clockNow)}` : ''}
                  {refreshing ? ' · updating…' : ''}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <HeaderChip icon={Eye} label="Mode" value={room?.systemStatus?.mode ?? 'sync'} tone="purple" />
              <HeaderChip icon={Activity} label="Workers" value={`${room?.systemStatus?.autonomy?.runningJobs ?? 0} running`} tone="emerald" />
              <HeaderChip icon={ShieldAlert} label="Alerts" value={`${room?.systemStatus?.autonomy?.openAlerts ?? 0}`} tone="orange" />
              <HeaderChip icon={Radar} label="Next run" value={formatRelativeTime(room?.systemStatus?.autonomy?.nextRunAt ?? null, clockNow, true)} tone="blue" />
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto_auto_auto]">
            <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold shadow-sm outline-none focus:border-blue-400" aria-label="Symbol" />
            <div className="flex gap-1 rounded-lg border border-violet-300/50 bg-violet-100/60 p-1 shadow-inner">
              {(room?.systemStatus?.activeTimeframes ?? ['MN', 'W', 'D', 'H4', 'H1', 'M15']).map((item) => {
                const chipTone = TIMEFRAME_TONES[item] ?? 'slate';
                return (
                  <div
                    key={item}
                    className={cn('flex-1 rounded-md border px-3 py-2 text-center text-xs font-bold shadow-sm', toneMetric(chipTone), toneTitle(chipTone))}
                  >
                    {item}
                  </div>
                );
              })}
            </div>
            <Button onClick={() => postAction('/api/cacsms-vision/scan')} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Reprocess
            </Button>
            <Button variant="outline" onClick={() => postAction('/api/cacsms-vision/pause')}><PauseCircle className="mr-2 h-4 w-4" /> Pause</Button>
            <Button variant="outline" onClick={() => postAction('/api/cacsms-vision/resume')}><PlayCircle className="mr-2 h-4 w-4" /> Resume</Button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-white">
        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="space-y-4">
            {error ? <Alert text={error} /> : null}

            <Panel icon={Activity} title="Vision System Status" tone="violet">
              <div className="grid gap-3 md:grid-cols-4">
                <Metric label="Running jobs" value={String(room?.systemStatus?.autonomy?.runningJobs ?? 0)} tone="emerald" />
                <Metric label="Queued jobs" value={String(room?.systemStatus?.autonomy?.queuedJobs ?? 0)} tone="blue" />
                <Metric label="Recent failures" value={String(room?.systemStatus?.autonomy?.recentFailures ?? 0)} tone="orange" />
                <Metric label="Open alerts" value={String(room?.systemStatus?.autonomy?.openAlerts ?? 0)} tone="rose" />
              </div>
            </Panel>

            <Panel icon={GitBranch} title="Multi-Timeframe Analysis Matrix" tone="cyan">
              <div className="grid gap-3 md:grid-cols-5">
                {matrix.map((row) => {
                  const rowTone = toneForBias(row.bias);
                  return (
                    <div key={row.timeframe} className={cn('rounded-xl border p-3 shadow-sm', toneMetric(rowTone))}>
                      <div className="flex items-center justify-between">
                        <p className={cn('font-mono text-lg font-bold', toneTitle(rowTone))}>{row.timeframe}</p>
                        <StatusBadge value={row.decision} />
                      </div>
                      <p className={cn('mt-1 text-xs font-bold uppercase', toneMuted(rowTone))}>{row.bias}</p>
                      <Progress value={row.confidenceScore} className={cn('mt-3 h-3 bg-white/70', toneProgress(rowTone))} />
                      <p className={cn('mt-2 line-clamp-3 text-xs leading-5', toneBody(rowTone))}>{row.explanation}</p>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <CaptureFeedPanel captures={room?.liveCaptureFeed} now={clockNow} />
              <Narrative icon={Eye} title="Screenshot Evidence Viewer" tone="slate" text={evidenceText(room?.screenshotEvidence)} />
              <Narrative icon={Sparkles} title="Annotated AI Chart Viewer" tone="purple" text={latest?.marketMeaning ?? 'Waiting for autonomous chart analysis output.'} />
              <Narrative icon={Radar} title="Institutional Liquidity Map" tone="blue" text={jsonText(room?.institutionalLiquidityMap)} />
              <Narrative icon={Layers3} title="Order Block & FVG Detector" tone="emerald" text={zoneText(room?.orderBlockAndFvgDetector)} />
              <Narrative icon={GitBranch} title="Market Structure Detector" tone="purple" text={jsonText(room?.marketStructureDetector)} />
              <Narrative icon={Landmark} title="Smart Money Behavior Panel" tone="emerald" text={room?.smartMoneyBehavior ?? 'Waiting for institutional behavior output.'} />
              <Narrative icon={ShieldAlert} title="Retail Trap Detector" tone="orange" text={room?.retailTrapDetector ?? 'Waiting for retail trap analysis.'} />
            </div>
          </section>

          <aside className="space-y-4">
            <DecisionPanel latest={latest} />
            <Narrative icon={BrainCircuit} title="AI Reasoning Console" tone="purple" text={jsonText(room?.aiReasoningConsole)} />
            <Narrative icon={Target} title="Trade Opportunity Radar" tone="blue" text={historyText(room?.tradeOpportunityRadar)} />
            <Narrative icon={Zap} title="Execution Readiness Board" tone="emerald" text={jsonText(room?.executionReadiness)} />
            <Narrative icon={ShieldAlert} title="Risk Intelligence Center" tone="rose" text={jsonText(room?.riskIntelligence)} />
            <Panel icon={Activity} title="Vision Decision History" tone="amber">
              <ScrollArea className="h-[240px] pr-3">
                <div className="space-y-2">
                  {(room?.visionDecisionHistory ?? []).map((item, index) => {
                    const itemTone = toneForDecision(String(item.decision ?? 'MONITOR'));
                    return (
                      <div key={`${String(item.id ?? index)}`} className={cn('rounded-lg border p-3 shadow-sm', toneMetric(itemTone))}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={cn('text-sm font-semibold', toneTitle(itemTone))}>{String(item.symbol ?? symbol)} {String(item.timeframe ?? '')}</p>
                          <StatusBadge value={String(item.decision ?? 'MONITOR')} />
                        </div>
                        <p className={cn('mt-2 text-xs leading-5', toneBody(itemTone))}>{String(item.reasonForDecision ?? item.reason_for_decision ?? 'No decision narrative yet.')}</p>
                      </div>
                    );
                  })}
                  {!room?.visionDecisionHistory?.length ? <p className="text-sm font-medium text-slate-600">No autonomous decision history yet.</p> : null}
                </div>
              </ScrollArea>
            </Panel>
          </aside>
        </div>
        </main>
    </DashboardPageFrame>
  );
}

function Panel({ icon: Icon, title, tone = 'blue', children }: { icon: LucideIcon; title: string; tone?: DashboardTone; children: ReactNode }) {
  return (
    <Card className={cn('overflow-hidden', toneCard(tone))}>
      <CardHeader className={cn('border-b py-4', toneCardHeader(tone))}>
        <CardTitle className={cn('flex items-center gap-2 text-base font-bold', toneTitle(tone))}>
          <Icon className="h-5 w-5" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn('p-4', toneBody(tone))}>{children}</CardContent>
    </Card>
  );
}

function HeaderChip({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: DashboardTone }) {
  return (
    <div className={cn('rounded-xl border px-3 py-2 shadow-sm', toneMetric(tone))}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', toneBody(tone))} />
        <div className="min-w-0">
          <p className={cn('text-xs font-semibold uppercase tracking-wide', toneMuted(tone))}>{label}</p>
          <p className={cn('truncate font-mono text-sm font-bold', toneTitle(tone))}>{value}</p>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: DashboardTone }) {
  return (
    <div className={cn('rounded-xl border p-3 shadow-sm', toneMetric(tone))}>
      <p className={cn('text-xs font-bold uppercase tracking-wide', toneMuted(tone))}>{label}</p>
      <p className={cn('mt-2 font-mono text-2xl font-bold', toneTitle(tone))}>{value}</p>
    </div>
  );
}

function Narrative({ icon: Icon, title, text, tone }: { icon: LucideIcon; title: string; text: string; tone: DashboardTone }) {
  return (
    <Card className={cn('overflow-hidden', toneCard(tone))}>
      <CardHeader className={cn('border-b py-4', toneCardHeader(tone))}>
        <CardTitle className={cn('flex items-center gap-2 text-base font-bold', toneTitle(tone))}>
          <Icon className="h-5 w-5" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <p className={cn('whitespace-pre-line rounded-lg border p-3 font-mono text-xs leading-6 shadow-inner', toneInsetSurface(tone), toneBody(tone))}>{text}</p>
      </CardContent>
    </Card>
  );
}

function DecisionPanel({ latest }: { latest: VisionAnalysis | null }) {
  const tone: DashboardTone = 'blue';
  return (
    <Card className={cn('overflow-hidden', toneCard(tone))}>
      <CardHeader className={cn('border-b py-4', toneCardHeader(tone))}>
        <CardTitle className={cn('flex items-center gap-2 text-base font-bold', toneTitle(tone))}>
          <Target className="h-5 w-5" /> Latest Vision Decision
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className={cn('flex items-center justify-between gap-3 rounded-lg border p-3 shadow-inner', toneInsetSurface(tone))}>
          <div>
            <p className={cn('text-xs font-bold uppercase', toneMuted(tone))}>Analysis status</p>
            <p className={cn('mt-1 font-bold', toneTitle(tone))}>{latest?.analysisStatus ?? 'waiting'}</p>
            {latest?.createdAt ? (
              <p className={cn('mt-1 font-mono text-[10px]', toneMuted(tone))}>{formatWatClock(new Date(latest.createdAt))}</p>
            ) : null}
          </div>
          <StatusBadge value={latest?.captureStatus ?? 'WAIT'} />
        </div>
        <Progress value={latest?.confidenceScore ?? 0} className={cn('mt-4 h-3 bg-white/70', toneProgress(tone))} />
        <p className={cn('mt-3 text-sm font-medium leading-6', toneBody(tone))}>{latest?.institutionalInterpretation ?? 'No autonomous institutional interpretation has been produced yet.'}</p>
      </CardContent>
    </Card>
  );
}

function Alert({ text }: { text: string }) {
  return (
    <Card className={cn('shadow-md', toneCard('rose'))}>
      <CardContent className="flex items-center gap-2 p-4 text-sm font-bold text-rose-900">
        <AlertTriangle className="h-4 w-4" /> {text}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ value }: { value: string }) {
  const tone = toneForDecision(value);
  return <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase shadow-sm', toneBadge(tone))}>{value}</span>;
}

function toneForDecision(value: string): DashboardTone {
  const text = value.toUpperCase();
  if (text.includes('BUY') || text.includes('CAPTURED') || text.includes('READY')) return 'emerald';
  if (text.includes('SELL') || text.includes('BLOCKED') || text.includes('AVOID')) return 'rose';
  if (text.includes('WAIT') || text.includes('MISSING') || text.includes('MONITOR')) return 'orange';
  return 'slate';
}

function CaptureFeedPanel({ captures, now }: { captures?: Capture[]; now: Date }) {
  const tone: DashboardTone = 'blue';
  return (
    <Card className={cn('overflow-hidden', toneCard(tone))}>
      <CardHeader className={cn('border-b py-4', toneCardHeader(tone))}>
        <CardTitle className={cn('flex items-center gap-2 text-base font-bold', toneTitle(tone))}>
          <CandlestickChart className="h-5 w-5" /> Live Chart Capture Feed
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4">
        {!captures?.length ? (
          <p className={cn('text-sm font-medium', toneBody(tone))}>No autonomous screenshots captured yet.</p>
        ) : (
          captures.slice(0, 6).map((item) => {
            const itemTone: DashboardTone = 'cyan';
            return (
            <div key={item.id} className={cn('flex items-center justify-between gap-3 rounded-lg border px-3 py-2 shadow-sm', toneMetric(itemTone))}>
              <div>
                <p className={cn('font-mono text-sm font-bold', toneTitle(itemTone))}>{item.symbol} · {item.timeframe}</p>
                <p className={cn('text-[11px]', toneMuted(itemTone))}>{item.sourcePlatform} · {item.processingStatus}</p>
              </div>
              <div className="text-right">
                <p className={cn('font-mono text-[11px] font-bold', toneBody(itemTone))}>{formatRelativeTime(item.capturedAt, now)}</p>
                <p className={cn('font-mono text-[10px]', toneMuted(itemTone))}>{formatWatClock(new Date(item.capturedAt))}</p>
              </div>
            </div>
          );
          })
        )}
      </CardContent>
    </Card>
  );
}

function formatWatClock(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);
}

function formatRelativeTime(value: string | null | undefined, now: Date, future = false): string {
  if (!value) return '--';
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return value;
  const diffMs = target.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  if (abs < 5000) return future && diffMs > 0 ? 'in moments' : 'just now';
  const seconds = Math.round(abs / 1000);
  if (seconds < 60) return future && diffMs > 0 ? `in ${seconds}s` : `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return future && diffMs > 0 ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return future && diffMs > 0 ? `in ${hours}h` : `${hours}h ago`;
}

function evidenceText(captures?: Capture[]) {
  if (!captures?.length) return 'Screenshot evidence is waiting for chart capture output.';
  return `Latest evidence: ${captures[0].symbol} ${captures[0].timeframe} ${captures[0].imageUrl}`;
}

function zoneText(data?: { orderBlocks?: unknown[]; fairValueGaps?: unknown[] }) {
  return `Order blocks: ${data?.orderBlocks?.length ?? 0}\nFair value gaps: ${data?.fairValueGaps?.length ?? 0}`;
}

function historyText(items?: Array<Record<string, unknown>>) {
  if (!items?.length) return 'No autonomous trade opportunity has been logged yet.';
  return items.slice(0, 5).map((item) => `${String(item.symbol ?? '')} ${String(item.timeframe ?? '')}: ${String(item.decision ?? 'MONITOR')} - ${String(item.reasonForDecision ?? '')}`).join('\n');
}

function jsonText(value: unknown) {
  if (!value || (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0)) return 'No backend output available yet.';
  return JSON.stringify(value, null, 2);
}

function toneForBias(value: string): DashboardTone {
  const text = value.toLowerCase();
  if (text.includes('bull') || text.includes('buy')) return 'emerald';
  if (text.includes('bear') || text.includes('sell')) return 'rose';
  if (text.includes('wait') || text.includes('mixed')) return 'orange';
  return 'slate';
}
