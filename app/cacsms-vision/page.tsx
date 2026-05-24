'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CandlestickChart,
  CheckCircle2,
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

import { TraderSidebar } from '@/components/trader-sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Tone = 'blue' | 'emerald' | 'orange' | 'purple' | 'rose' | 'slate';

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
  const [error, setError] = useState<string | null>(null);

  const latest = room?.annotatedChart ?? null;
  const matrix = useMemo(() => room?.timeframeMatrix ?? [], [room]);

  useEffect(() => {
    let active = true;
    async function loadRoom() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/cacsms-vision/status?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
        const payload = await response.json();
        if (!payload.ok) throw new Error(payload.error ?? 'Unable to load Cacsms Vision.');
        if (active) setRoom(payload.room);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Unable to load Cacsms Vision.');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadRoom();
    const interval = window.setInterval(loadRoom, 10000);
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
    <div className="flex h-screen overflow-hidden bg-white text-slate-950">
      <TraderSidebar bridgeOnline mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />
      <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur md:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button size="icon" variant="outline" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold md:text-xl">Cacsms Vision Intelligence Room</h1>
                <p className="truncate text-xs font-mono text-blue-700">Autonomous chart capture, computer vision, smart money analysis and execution readiness</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <HeaderChip icon={Eye} label="Mode" value={room?.systemStatus?.mode ?? 'sync'} tone="purple" />
              <HeaderChip icon={Activity} label="Workers" value={`${room?.systemStatus?.autonomy?.runningJobs ?? 0} running`} tone="emerald" />
              <HeaderChip icon={ShieldAlert} label="Alerts" value={`${room?.systemStatus?.autonomy?.openAlerts ?? 0}`} tone="orange" />
              <HeaderChip icon={Radar} label="Next Run" value={shortDate(room?.systemStatus?.autonomy?.nextRunAt)} tone="blue" />
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto_auto_auto]">
            <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold shadow-sm outline-none focus:border-blue-400" aria-label="Symbol" />
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {(room?.systemStatus?.activeTimeframes ?? ['W', 'D', 'H4', 'H1', 'M15']).map((item) => (
                <div key={item} className="flex-1 rounded-md bg-white px-3 py-2 text-center text-xs font-semibold text-slate-700 shadow-sm">{item}</div>
              ))}
            </div>
            <Button onClick={() => postAction('/api/cacsms-vision/scan')} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Reprocess
            </Button>
            <Button variant="outline" onClick={() => postAction('/api/cacsms-vision/pause')}><PauseCircle className="mr-2 h-4 w-4" /> Pause</Button>
            <Button variant="outline" onClick={() => postAction('/api/cacsms-vision/resume')}><PlayCircle className="mr-2 h-4 w-4" /> Resume</Button>
          </div>
        </header>

        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="space-y-4">
            {error ? <Alert text={error} /> : null}

            <Panel icon={Activity} title="Vision System Status">
              <div className="grid gap-3 md:grid-cols-4">
                <Metric label="Running jobs" value={String(room?.systemStatus?.autonomy?.runningJobs ?? 0)} tone="emerald" />
                <Metric label="Queued jobs" value={String(room?.systemStatus?.autonomy?.queuedJobs ?? 0)} tone="blue" />
                <Metric label="Recent failures" value={String(room?.systemStatus?.autonomy?.recentFailures ?? 0)} tone="orange" />
                <Metric label="Open alerts" value={String(room?.systemStatus?.autonomy?.openAlerts ?? 0)} tone="rose" />
              </div>
            </Panel>

            <Panel icon={GitBranch} title="Multi-Timeframe Analysis Matrix">
              <div className="grid gap-3 md:grid-cols-5">
                {matrix.map((row) => (
                  <div key={row.timeframe} className={cn('rounded-lg border p-3', toneBorder(toneForBias(row.bias)), toneBg(toneForBias(row.bias)))}>
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-lg font-semibold">{row.timeframe}</p>
                      <StatusBadge value={row.decision} />
                    </div>
                    <p className="mt-1 text-xs font-semibold uppercase text-slate-600">{row.bias}</p>
                    <Progress value={row.confidenceScore} className="mt-3 h-1.5 bg-white [&_[data-slot=progress-indicator]]:bg-blue-600" />
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-600">{row.explanation}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Narrative icon={CandlestickChart} title="Live Chart Capture Feed" tone="blue" text={captureFeedText(room?.liveCaptureFeed)} />
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
            <Panel icon={Activity} title="Vision Decision History">
              <ScrollArea className="h-[240px] pr-3">
                <div className="space-y-2">
                  {(room?.visionDecisionHistory ?? []).map((item, index) => (
                    <div key={`${String(item.id ?? index)}`} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{String(item.symbol ?? symbol)} {String(item.timeframe ?? '')}</p>
                        <StatusBadge value={String(item.decision ?? 'MONITOR')} />
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{String(item.reasonForDecision ?? item.reason_for_decision ?? 'No decision narrative yet.')}</p>
                    </div>
                  ))}
                  {!room?.visionDecisionHistory?.length ? <p className="text-sm text-slate-500">No autonomous decision history yet.</p> : null}
                </div>
              </ScrollArea>
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Panel({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-200">
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="h-5 w-5 text-blue-600" /> {title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

function HeaderChip({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: Tone }) {
  return (
    <div className={cn('rounded-xl border px-3 py-2 shadow-sm', toneBorder(tone), toneBg(tone))}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', toneText(tone))} />
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="truncate font-mono text-sm font-semibold text-slate-950">{value}</p>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className={cn('rounded-lg border p-3', toneBorder(tone), toneBg(tone))}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 font-mono text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function Narrative({ icon: Icon, title, text, tone }: { icon: LucideIcon; title: string; text: string; tone: Tone }) {
  return (
    <Card className={cn('border bg-white shadow-sm', toneBorder(tone))}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Icon className={cn('h-5 w-5', toneText(tone))} /> {title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-line text-sm leading-6 text-slate-600">{text}</p>
      </CardContent>
    </Card>
  );
}

function DecisionPanel({ latest }: { latest: VisionAnalysis | null }) {
  return (
    <Card className="border-blue-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Target className="h-5 w-5 text-blue-600" /> Latest Vision Decision</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Analysis status</p>
            <p className="mt-1 font-semibold text-slate-950">{latest?.analysisStatus ?? 'waiting'}</p>
          </div>
          <StatusBadge value={latest?.captureStatus ?? 'WAIT'} />
        </div>
        <Progress value={latest?.confidenceScore ?? 0} className="mt-4 h-2 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600" />
        <p className="mt-3 text-sm leading-6 text-slate-600">{latest?.institutionalInterpretation ?? 'No autonomous institutional interpretation has been produced yet.'}</p>
      </CardContent>
    </Card>
  );
}

function Alert({ text }: { text: string }) {
  return (
    <Card className="border-rose-200 bg-rose-50">
      <CardContent className="flex items-center gap-2 p-4 text-sm font-semibold text-rose-700"><AlertTriangle className="h-4 w-4" /> {text}</CardContent>
    </Card>
  );
}

function StatusBadge({ value }: { value: string }) {
  const tone = value.includes('BUY') || value.includes('captured') ? 'emerald' : value.includes('SELL') || value.includes('blocked') ? 'rose' : value.includes('WAIT') || value.includes('missing') ? 'orange' : 'slate';
  return <span className={cn('rounded-full border px-2 py-1 text-xs font-semibold uppercase', toneBorder(tone), toneBg(tone), toneText(tone))}>{value}</span>;
}

function captureFeedText(captures?: Capture[]) {
  if (!captures?.length) return 'No autonomous screenshots have been captured yet. The capture worker will report missing capture state rather than fabricating chart evidence.';
  return captures.slice(0, 5).map((item) => `${item.symbol} ${item.timeframe} from ${item.sourcePlatform} at ${shortDate(item.capturedAt)} (${item.processingStatus})`).join('\n');
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

function shortDate(value?: string | null) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function toneForBias(value: string): Tone {
  const text = value.toLowerCase();
  if (text.includes('bull') || text.includes('buy')) return 'emerald';
  if (text.includes('bear') || text.includes('sell')) return 'rose';
  if (text.includes('wait') || text.includes('mixed')) return 'orange';
  return 'slate';
}

function toneBg(tone: Tone) {
  return {
    blue: 'bg-blue-50',
    emerald: 'bg-emerald-50',
    orange: 'bg-orange-50',
    purple: 'bg-purple-50',
    rose: 'bg-rose-50',
    slate: 'bg-slate-50',
  }[tone];
}

function toneBorder(tone: Tone) {
  return {
    blue: 'border-blue-200',
    emerald: 'border-emerald-200',
    orange: 'border-orange-200',
    purple: 'border-purple-200',
    rose: 'border-rose-200',
    slate: 'border-slate-200',
  }[tone];
}

function toneText(tone: Tone) {
  return {
    blue: 'text-blue-700',
    emerald: 'text-emerald-700',
    orange: 'text-orange-700',
    purple: 'text-purple-700',
    rose: 'text-rose-700',
    slate: 'text-slate-700',
  }[tone];
}
