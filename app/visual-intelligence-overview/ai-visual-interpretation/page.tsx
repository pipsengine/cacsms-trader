'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  GitBranch,
  Landmark,
  LineChart,
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
type Decision = 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
type Bias = 'bullish' | 'bearish' | 'neutral' | 'mixed';
type Tone = 'blue' | 'emerald' | 'orange' | 'purple' | 'rose' | 'slate';

interface Interpretation {
  id: string;
  captureId: string;
  symbol: string;
  timeframe: string;
  imageUrl: string | null;
  title: string;
  fullExplanation: string;
  dominantBias: Bias;
  institutionalBehavior: string;
  institutionalNarrative: string;
  retailTrapWarning: string;
  liquidityNarrative: string;
  marketStructureNarrative: string;
  confidenceScore: number;
  marketClarityScore: number;
  setupQualityScore: number;
  decision: Decision;
  entryLogic: string;
  invalidationLogic: string;
  riskWarning: string;
  dominantStory: string;
  higherTimeframeContext: string;
  rankedStructures: Array<{ label: string; score: number; narrative: string }>;
  reasoningTimeline: Array<{ stage: string; summary: string; score: number }>;
  components: Array<{ name: string; weight: number; bias: Bias; score: number; confidence: number; summary: string; evidence: string[] }>;
  createdAt: string;
}

const timeframes: Timeframe[] = ['W', 'D', 'H4', 'H1', 'M15'];

export default function AiVisualInterpretationPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('H1');
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState('');

  const decisionTone = toneForDecision(interpretation?.decision);
  const biasTone = toneForBias(interpretation?.dominantBias);

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
    async function loadLatest() {
      setLoading(true);
      setError(null);
      try {
        const latest = await fetch(`/api/visual-analysis/interpretation/${encodeURIComponent(symbol)}/${timeframe}/latest`, { cache: 'no-store' });
        if (latest.ok) {
          const payload = await latest.json();
          if (active) setInterpretation(payload.interpretation);
          return;
        }

        const analyzed = await fetch('/api/visual-analysis/interpretation/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, timeframe }),
        });
        const payload = await analyzed.json();
        if (!payload.ok) throw new Error(payload.error ?? 'Unable to generate interpretation.');
        if (active) setInterpretation(payload.interpretation);
      } catch (caught) {
        if (active) {
          setInterpretation(null);
          setError(caught instanceof Error ? caught.message : 'Unable to load AI visual interpretation.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadLatest();
    return () => {
      active = false;
    };
  }, [symbol, timeframe]);

  const regenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/visual-analysis/interpretation/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureId: interpretation?.captureId, symbol, timeframe }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Unable to regenerate interpretation.');
      setInterpretation(payload.interpretation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to regenerate interpretation.');
    } finally {
      setLoading(false);
    }
  };

  const contextItems = useMemo(() => interpretation?.components ?? [], [interpretation]);

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
                <h1 className="truncate text-lg font-semibold md:text-xl">AI Visual Interpretation</h1>
                <p className="truncate text-xs font-mono text-blue-700">Professional chart narrative, institutional behaviour, trap risk and execution decision</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <HeaderChip icon={BrainCircuit} label="Interpreter" value="hybrid.reasoner" tone="blue" />
              <HeaderChip icon={Sparkles} label="Decision" value={interpretation?.decision ?? 'SYNC'} tone={decisionTone} />
              <HeaderChip icon={Activity} label="Confidence" value={interpretation ? `${Math.round(interpretation.confidenceScore)}%` : '--'} tone="emerald" />
              <HeaderChip icon={Radar} label="WAT" value={now || '--:--:--'} tone="slate" />
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
            <Button onClick={regenerate} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Regenerate
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

            <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <LineChart className="h-5 w-5 text-blue-600" /> Main Chart Preview With AI Overlays
                  </CardTitle>
                  <span className="font-mono text-xs text-slate-500">{interpretation?.captureId ?? 'awaiting capture'}</span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ChartPreview interpretation={interpretation} loading={loading} />
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <NarrativeCard icon={BrainCircuit} title="AI Interpretation Summary" tone="blue" text={interpretation?.fullExplanation ?? 'The interpreter is waiting for a captured chart and detection outputs.'} />
              <NarrativeCard icon={GitBranch} title="Market Structure Narrative" tone="purple" text={interpretation?.marketStructureNarrative ?? 'No market structure narrative available yet.'} />
              <NarrativeCard icon={Landmark} title="Institutional Activity" tone="emerald" text={interpretation?.institutionalNarrative ?? 'Institutional behaviour will be inferred from structure, liquidity and order blocks.'} />
              <NarrativeCard icon={ShieldAlert} title="Retail Trap Risk" tone="orange" text={interpretation?.retailTrapWarning ?? 'Retail trap risk pending liquidity context.'} />
              <NarrativeCard icon={Radar} title="Liquidity Narrative" tone="blue" text={interpretation?.liquidityNarrative ?? 'Liquidity narrative pending sweep and stop-pool detection.'} />
              <NarrativeCard icon={AlertTriangle} title="Risk Warning" tone="rose" text={interpretation?.riskWarning ?? 'Risk warning pending decision synthesis.'} />
            </div>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-200">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-5 w-5 text-purple-600" /> AI Reasoning Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {(interpretation?.reasoningTimeline ?? []).map((item) => (
                    <div key={item.stage} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950">{item.stage}</p>
                        <span className="font-mono text-xs text-blue-700">{item.score}</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{item.summary}</p>
                    </div>
                  ))}
                  {!interpretation?.reasoningTimeline?.length ? <p className="text-sm text-slate-500">No reasoning timeline generated yet.</p> : null}
                </div>
              </CardContent>
            </Card>
          </section>

          <aside className="space-y-4">
            <DecisionCard interpretation={interpretation} tone={decisionTone} />
            <MeterCard interpretation={interpretation} />
            <SignalCard title="Market Bias" icon={interpretation?.dominantBias === 'bearish' ? TrendingDown : TrendingUp} value={interpretation?.dominantBias ?? 'pending'} tone={biasTone} detail={interpretation?.dominantStory ?? 'Bias pending visual reasoning.'} />
            <SignalCard title="Trade Decision" icon={Target} value={interpretation?.decision ?? 'SYNC'} tone={decisionTone} detail={interpretation?.entryLogic ?? 'Entry logic pending interpretation.'} />

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-5 w-5 text-blue-600" /> Multi-Timeframe Context
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-6 text-slate-600">{interpretation?.higherTimeframeContext ?? 'No higher timeframe context available yet.'}</p>
                <ScrollArea className="h-[260px] pr-3">
                  <div className="space-y-2">
                    {contextItems.map((item) => (
                      <div key={item.name} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold text-slate-900">{item.name}</p>
                          <span className={cn('font-mono text-xs', toneText(toneForBias(item.bias)))}>{Math.round(item.score * 100)}%</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-600">{item.summary}</p>
                      </div>
                    ))}
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

function ChartPreview({ interpretation, loading }: { interpretation: Interpretation | null; loading: boolean }) {
  return (
    <div className="relative min-h-[460px] overflow-hidden bg-slate-100">
      {interpretation?.imageUrl ? (
        <img src={interpretation.imageUrl} alt="Analyzed chart" className="h-full min-h-[460px] w-full object-cover" />
      ) : (
        <div className="flex min-h-[460px] items-center justify-center text-sm font-mono text-slate-400">
          {loading ? 'Synchronizing chart intelligence...' : 'No interpreted chart capture available'}
        </div>
      )}
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,rgba(37,99,235,0.16)_1px,transparent_1px),linear-gradient(to_bottom,rgba(37,99,235,0.12)_1px,transparent_1px)] bg-[size:72px_54px]" />
      <OverlayLabel className="left-[8%] top-[14%]" tone="blue" text={interpretation?.dominantBias ?? 'bias'} />
      <OverlayLabel className="right-[10%] top-[22%]" tone="emerald" text={interpretation?.institutionalBehavior ?? 'institutional read'} />
      <OverlayLabel className="left-[18%] bottom-[18%]" tone="orange" text={interpretation?.decision ?? 'decision'} />
      {interpretation?.rankedStructures?.slice(0, 3).map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className="absolute rounded-lg border border-blue-300 bg-blue-50/90 px-3 py-2 text-xs font-semibold text-blue-900 shadow-sm"
          style={{ left: `${18 + index * 22}%`, top: `${38 + index * 11}%` }}
        >
          {item.label} {item.score}
        </div>
      ))}
    </div>
  );
}

function DecisionCard({ interpretation, tone }: { interpretation: Interpretation | null; tone: Tone }) {
  return (
    <Card className={cn('border shadow-sm', toneBorder(tone), toneBg(tone))}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className={cn('h-5 w-5', toneText(tone))} /> Trade Decision
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-4xl font-semibold text-slate-950">{interpretation?.decision ?? '--'}</p>
        <p className="mt-3 text-sm leading-6 text-slate-700">{interpretation?.entryLogic ?? 'Awaiting AI interpretation.'}</p>
        <div className="mt-4 rounded-lg border border-white/70 bg-white/70 p-3 text-xs leading-5 text-slate-600">
          {interpretation?.invalidationLogic ?? 'Invalidation logic pending.'}
        </div>
      </CardContent>
    </Card>
  );
}

function MeterCard({ interpretation }: { interpretation: Interpretation | null }) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-5 w-5 text-emerald-600" /> Confidence Meter
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Meter label="Confidence" value={interpretation?.confidenceScore ?? 0} tone="emerald" />
        <Meter label="Market clarity" value={interpretation?.marketClarityScore ?? 0} tone="blue" />
        <Meter label="Setup quality" value={interpretation?.setupQualityScore ?? 0} tone="purple" />
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

function SignalCard(props: { title: string; icon: LucideIcon; value: string; tone: Tone; detail: string }) {
  const Icon = props.icon;
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={cn('h-5 w-5', toneText(props.tone))} /> {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={cn('font-mono text-2xl font-semibold uppercase', toneText(props.tone))}>{props.value}</p>
        <p className="mt-3 text-sm leading-6 text-slate-600">{props.detail}</p>
      </CardContent>
    </Card>
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

function OverlayLabel(props: { className: string; tone: Tone; text: string }) {
  return (
    <div className={cn('absolute rounded-lg border px-3 py-2 text-xs font-semibold shadow-sm backdrop-blur', toneBorder(props.tone), toneBg(props.tone), toneText(props.tone), props.className)}>
      <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
      {props.text}
    </div>
  );
}

function toneForDecision(decision?: string): Tone {
  if (decision === 'BUY') return 'emerald';
  if (decision === 'SELL') return 'rose';
  if (decision === 'AVOID') return 'orange';
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
