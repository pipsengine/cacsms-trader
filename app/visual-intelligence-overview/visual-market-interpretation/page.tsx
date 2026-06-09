'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  GitBranch,
  Landmark,
  Menu,
  Radar,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import { TraderSidebar } from '@/components/trader-sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Timeframe = 'W' | 'D' | 'H4' | 'H1' | 'M15';
type Decision = 'BUY' | 'SELL' | 'WAIT' | 'AVOID' | 'MONITOR';
type Bias = 'bullish' | 'bearish' | 'neutral' | 'mixed';
type Tone = 'blue' | 'emerald' | 'orange' | 'purple' | 'rose' | 'slate';

interface Interpretation {
  id: string;
  symbol: string;
  timeframe: string;
  dominantTimeframe: string;
  finalMarketBias: Bias;
  institutionalInterpretation: string;
  liquidityObjective: string;
  marketPhase: string;
  setupReadinessScore: number;
  finalDecision: Decision;
  confidenceScore: number;
  entryReadiness: string;
  invalidationCondition: string;
  riskWarning: string;
  fullNarrative: string;
  previousInterpretation: Record<string, unknown>;
  timeframeStates: Array<{ timeframe: string; bias: Bias; controlScore: number; confirmsEntry: boolean; narrative: string }>;
  decisionScores: Record<string, number>;
  auditTrail: Array<{ stage: string; finding: string; score: number }>;
  signals: Array<{ name: string; weight: number; bias: Bias; confidence: number; confirmsEntry: boolean; narrative: string }>;
}

interface AutonomyStatus {
  summary?: {
    queuedJobs: number;
    runningJobs: number;
    recentFailures: number;
    openAlerts: number;
    nextRunAt: string | null;
  };
  health?: Array<{ status: string; emergencyStopped: boolean; message: string }>;
}

const timeframes: Timeframe[] = ['W', 'D', 'H4', 'H1', 'M15'];

export default function VisualMarketInterpretationPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('H1');
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState('');
  const [autonomy, setAutonomy] = useState<AutonomyStatus | null>(null);

  const decisionTone = toneForDecision(interpretation?.finalDecision);
  const biasTone = toneForBias(interpretation?.finalMarketBias);
  const tfStates = useMemo(() => {
    const map = new Map((interpretation?.timeframeStates ?? []).map((state) => [state.timeframe, state]));
    return timeframes.map((item) => map.get(item) ?? { timeframe: item, bias: 'neutral' as Bias, controlScore: 0, confirmsEntry: false, narrative: 'No control state available.' });
  }, [interpretation]);

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
    async function loadAutonomyStatus() {
      try {
        const response = await fetch('/api/autonomy/status', { cache: 'no-store' });
        const payload = await response.json();
        if (active && payload.ok) setAutonomy(payload.status);
      } catch {
        if (active) setAutonomy(null);
      }
    }
    loadAutonomyStatus();
    const interval = window.setInterval(loadAutonomyStatus, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadInterpretation() {
      setLoading(true);
      setError(null);
      try {
        const latest = await fetch(`/api/visual-analysis/market-interpretation/${encodeURIComponent(symbol)}/${timeframe}`, { cache: 'no-store' });
        if (latest.ok) {
          const payload = await latest.json();
          if (active) setInterpretation(payload.interpretation);
          return;
        }
        const analyzed = await fetch('/api/visual-analysis/market-interpretation/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, timeframe }),
        });
        const payload = await analyzed.json();
        if (!payload.ok) throw new Error(payload.error ?? 'Unable to generate market interpretation.');
        if (active) setInterpretation(payload.interpretation);
      } catch (caught) {
        if (active) {
          setInterpretation(null);
          setError(caught instanceof Error ? caught.message : 'Unable to load market interpretation.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    loadInterpretation();
    return () => {
      active = false;
    };
  }, [symbol, timeframe]);

  async function regenerate() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/visual-analysis/market-interpretation/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Unable to regenerate market interpretation.');
      setInterpretation(payload.interpretation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to regenerate market interpretation.');
    } finally {
      setLoading(false);
    }
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
                <h1 className="truncate text-lg font-semibold md:text-xl">Visual Market Interpretation</h1>
                <p className="truncate text-xs font-mono text-blue-700">Final visual reasoning, timeframe control and trade-readiness assessment</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <HeaderChip icon={Target} label="Decision" value={interpretation?.finalDecision ?? 'SYNC'} tone={decisionTone} />
              <HeaderChip icon={GitBranch} label="Dominant TF" value={interpretation?.dominantTimeframe ?? '--'} tone="blue" />
              <HeaderChip icon={Activity} label="Readiness" value={`${Math.round(interpretation?.setupReadinessScore ?? 0)}%`} tone="emerald" />
              <HeaderChip icon={Radar} label="WAT" value={now || '--:--:--'} tone="slate" />
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto]">
            <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold shadow-sm outline-none focus:border-blue-400" aria-label="Symbol" />
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {timeframes.map((item) => (
                <button key={item} type="button" onClick={() => setTimeframe(item)} className={cn('h-8 flex-1 rounded-md text-xs font-semibold transition', timeframe === item ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900')}>
                  {item}
                </button>
              ))}
            </div>
            <Button onClick={regenerate} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Regenerate
            </Button>
          </div>
        </header>

        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_410px]">
          <section className="space-y-4">
            {error ? (
              <Card className="border-rose-200 bg-rose-50">
                <CardContent className="flex items-center gap-2 p-4 text-sm font-semibold text-rose-700">
                  <AlertTriangle className="h-4 w-4" /> {error}
                </CardContent>
              </Card>
            ) : null}

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-200">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BrainCircuit className="h-5 w-5 text-blue-600" /> Market Interpretation Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <p className="whitespace-pre-line text-sm leading-6 text-slate-600">{interpretation?.fullNarrative ?? 'No final market interpretation generated yet.'}</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-200">
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-5 w-5 text-purple-600" /> Five-Timeframe Control Panel
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 p-4 md:grid-cols-5">
                {tfStates.map((state) => (
                  <div key={state.timeframe} className={cn('rounded-lg border p-3', toneBorder(toneForBias(state.bias)), toneBg(toneForBias(state.bias)), state.timeframe === interpretation?.dominantTimeframe && 'ring-2 ring-blue-500')}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-lg font-semibold text-slate-950">{state.timeframe}</p>
                      {state.confirmsEntry ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}
                    </div>
                    <p className={cn('mt-1 text-xs font-semibold uppercase', toneText(toneForBias(state.bias)))}>{state.bias}</p>
                    <Progress value={state.controlScore} className="mt-3 h-1.5 bg-white/70 [&_[data-slot=progress-indicator]]:bg-blue-600" />
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <NarrativeCard icon={GitBranch} title="Dominant Timeframe" tone="blue" text={`${interpretation?.dominantTimeframe ?? '--'} is currently controlling the final visual decision context. Lower timeframe evidence is treated as entry confirmation only when it aligns with this control state.`} />
              <NarrativeCard icon={Landmark} title="Institutional Bias" tone={biasTone} text={interpretation?.institutionalInterpretation ?? 'Institutional bias pending.'} />
              <NarrativeCard icon={Sparkles} title="Retail Behaviour" tone="orange" text={interpretation?.signals.find((signal) => signal.name === 'Liquidity condition')?.narrative ?? 'Retail behaviour pending liquidity and trap context.'} />
              <NarrativeCard icon={Radar} title="Liquidity Roadmap" tone="blue" text={interpretation?.liquidityObjective ?? 'Liquidity objective pending.'} />
              <NarrativeCard icon={GitBranch} title="Market Phase Map" tone="purple" text={interpretation?.marketPhase ?? 'Market phase pending.'} />
              <NarrativeCard icon={ShieldAlert} title="Risk And Invalidation" tone="rose" text={`${interpretation?.riskWarning ?? 'Risk pending.'}\n\n${interpretation?.invalidationCondition ?? ''}`} />
              <NarrativeCard icon={BrainCircuit} title="Previous Interpretation Comparison" tone="slate" text={previousText(interpretation)} />
            </div>
          </section>

          <aside className="space-y-4">
            <AutonomyCard status={autonomy} />
            <DecisionCard interpretation={interpretation} tone={decisionTone} />
            <ReadinessCard interpretation={interpretation} />

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-5 w-5 text-blue-600" /> Confidence Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(interpretation?.signals ?? []).map((signal) => (
                  <Meter key={signal.name} label={signal.name} value={signal.confidence * 100} tone={toneForBias(signal.bias)} />
                ))}
                {!interpretation?.signals.length ? <p className="text-sm text-slate-500">No confidence breakdown available.</p> : null}
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-5 w-5 text-purple-600" /> Decision Audit Trail
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[330px] pr-3">
                  <div className="space-y-3">
                    {(interpretation?.auditTrail ?? []).map((item) => (
                      <div key={item.stage} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-950">{item.stage}</p>
                          <span className="font-mono text-xs text-blue-700">{Math.round(item.score)}</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-600">{item.finding}</p>
                      </div>
                    ))}
                    {!interpretation?.auditTrail.length ? <p className="text-sm text-slate-500">No decision audit trail generated yet.</p> : null}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}

function AutonomyCard({ status }: { status: AutonomyStatus | null }) {
  const emergencyStopped = status?.health?.some((item) => item.emergencyStopped) ?? false;
  return (
    <Card className={cn('border bg-white shadow-sm', emergencyStopped ? 'border-rose-200' : 'border-emerald-200')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className={cn('h-5 w-5', emergencyStopped ? 'text-rose-600' : 'text-emerald-600')} /> Autonomous Runtime
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm">
        <MiniStat label="Running jobs" value={String(status?.summary?.runningJobs ?? 0)} />
        <MiniStat label="Queued jobs" value={String(status?.summary?.queuedJobs ?? 0)} />
        <MiniStat label="Open alerts" value={String(status?.summary?.openAlerts ?? 0)} />
        <MiniStat label="Failures" value={String(status?.summary?.recentFailures ?? 0)} />
        <div className="col-span-2 rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Next autonomous run</p>
          <p className="mt-1 truncate font-mono text-xs font-semibold text-slate-900">{status?.summary?.nextRunAt ?? 'syncing'}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function DecisionCard({ interpretation, tone }: { interpretation: Interpretation | null; tone: Tone }) {
  return (
    <Card className={cn('border shadow-sm', toneBorder(tone), toneBg(tone))}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className={cn('h-5 w-5', toneText(tone))} /> Trade Action Recommendation
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-4xl font-semibold text-slate-950">{interpretation?.finalDecision ?? '--'}</p>
        <p className="mt-3 text-sm leading-6 text-slate-700">{interpretation?.entryReadiness ?? 'Entry readiness pending.'}</p>
      </CardContent>
    </Card>
  );
}

function ReadinessCard({ interpretation }: { interpretation: Interpretation | null }) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-5 w-5 text-emerald-600" /> Setup Readiness Score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Meter label="Setup readiness" value={interpretation?.setupReadinessScore ?? 0} tone="emerald" />
        <Meter label="Confidence" value={interpretation?.confidenceScore ?? 0} tone="blue" />
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">{interpretation?.riskWarning ?? 'Risk state pending.'}</div>
      </CardContent>
    </Card>
  );
}

function NarrativeCard(props: { icon: LucideIcon; title: string; tone: Tone; text: string }) {
  const Icon = props.icon;
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={cn('h-5 w-5', toneText(props.tone))} /> {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-line text-sm leading-6 text-slate-600">{props.text}</p>
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

function previousText(interpretation: Interpretation | null) {
  const previous = interpretation?.previousInterpretation;
  if (!previous || !Object.keys(previous).length) return 'No previous interpretation is available for comparison yet.';
  return `Previous decision: ${String(previous.decision ?? '--')}. Previous confidence: ${String(previous.confidence ?? '--')}. Created at: ${String(previous.createdAt ?? '--')}.`;
}

function toneForDecision(decision?: string): Tone {
  if (decision === 'BUY') return 'emerald';
  if (decision === 'SELL') return 'rose';
  if (decision === 'AVOID') return 'orange';
  if (decision === 'MONITOR') return 'purple';
  return 'blue';
}

function toneForBias(bias?: string): Tone {
  if (bias === 'bullish') return 'emerald';
  if (bias === 'bearish') return 'rose';
  if (bias === 'mixed') return 'orange';
  return 'blue';
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
