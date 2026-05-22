'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BrainCircuit,
  CalendarClock,
  Cpu,
  Database,
  Gauge,
  Globe2,
  Landmark,
  LineChart,
  Menu,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { TraderSidebar } from '@/components/trader-sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type Tone = 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'slate';

const regimes: Array<{ label: string; score: number; probability: number; comparison: string; tone: Tone }> = [];
const currencies: Array<{ code: string; strength: number; rate: number; yields: number; cot: number; haven: number; bias: string }> = [];
const heatmapRows: Array<{ region: string; inflation: number; growth: number; employment: number; bank: number; yields: number; currency: number }> = [];
const macroRisks: Array<{ label: string; value: number; trend: string; tone: Tone }> = [];
const intermarket: Array<{ pair: string; corr: number; signal: string }> = [];

const sourcePipelines = [
  { source: 'TradingEconomics', cadence: '5m macro poll', payload: 'calendar, CPI, GDP, rates, employment' },
  { source: 'FRED', cadence: 'daily EOD', payload: 'liquidity, yield curves, inflation expectations' },
  { source: 'Finnhub', cadence: '30s market poll', payload: 'DXY proxies, equities, commodities, volatility' },
  { source: 'CFTC', cadence: 'weekly Friday', payload: 'COT net positions, dealer and asset manager flows' },
  { source: 'NewsAPI', cadence: '60s headline scan', payload: 'macro headlines, geopolitical escalation, risk tags' },
  { source: 'MarketAux', cadence: '60s sentiment scan', payload: 'entity sentiment, asset impact scoring' },
  { source: 'ForexFactory', cadence: '10m calendar sync', payload: 'event impact, revisions, blackout windows' },
];

const schemas = [
  'macro_events(id, source, country, currency, event_name, impact, actual, forecast, previous, released_at, revision_flag)',
  'macro_observations(id, country, indicator, period, value, z_score, surprise_score, source, observed_at)',
  'central_bank_policy(id, bank, decision_date, rate, guidance_score, vote_split, statement_hash, hawkish_score)',
  'cot_positions(id, market, report_date, noncommercial_long, noncommercial_short, net_position, percentile_3y)',
  'market_snapshots(id, symbol, asset_class, price, change_1d, vol_20d, source, captured_at)',
  'macro_scores(id, scope, score_type, score, confidence, contributors_json, computed_at)',
  'ai_macro_briefs(id, regime_id, narrative, risks_json, trade_bias_json, model, created_at)',
  'macro_alerts(id, severity, category, title, body, affected_assets_json, triggered_at, acknowledged_at)',
];

const apiContracts = [
  'GET /api/macro/overview',
  'GET /api/macro/regime',
  'GET /api/macro/currencies/strength',
  'GET /api/macro/heatmap',
  'GET /api/macro/intermarket',
  'GET /api/macro/alerts',
  'POST /api/macro/ingest/:source',
  'WS /api/macro/stream',
];

const scoringModels = [
  { name: 'Regime classifier', formula: 'weighted z-scores: growth + inflation + liquidity + volatility + policy + credit stress', output: '10 regime probabilities plus confidence' },
  { name: 'Currency strength', formula: 'rates 20%, inflation 12%, jobs 12%, GDP 10%, yields 16%, COT 12%, sentiment 10%, haven 8%', output: '0-100 score and rank' },
  { name: 'Policy direction', formula: 'rate path + statement NLP + inflation gap + labor slack + yield reaction', output: 'hawkish/dovish score' },
  { name: 'News risk', formula: 'impact tier x asset relevance x surprise likelihood x session liquidity penalty', output: 'blackout severity' },
  { name: 'Macro bias', formula: 'currency divergence + regime + central bank delta + COT crowding + intermarket confirmation', output: 'institutional bias' },
];

const schedules = [
  'Every 30s: market snapshots, VIX/DXY/yields proxy refresh, websocket fanout.',
  'Every 60s: NewsAPI and MarketAux headline classification with dedupe hashing.',
  'Every 5m: TradingEconomics and ForexFactory calendar/event sync.',
  'Hourly: currency strength recomputation and intermarket correlation windows.',
  'Daily 22:05 UTC: FRED macro series normalization and z-score rebuild.',
  'Friday after CFTC release: COT positioning ingestion and percentile recalculation.',
];

const alertRules = [
  'High-impact event inside blackout window for open symbol exposure.',
  'Regime transition probability above 65% with rising volatility confirmation.',
  'Currency divergence spread above 35 points between ranked currencies.',
  'Bond instability above 70 with equity drawdown and USD funding stress.',
  'Central bank guidance shock above 2 standard deviations from prior statement tone.',
  'Gold breaks correlation with USD and yields during risk-off headline cluster.',
];

const scalability = [
  'Provider adapters isolate source schemas from internal normalized facts.',
  'PostgreSQL partitions macro observations by month and market snapshots by day.',
  'Redis edge cache stores hot overview payloads with stale-while-revalidate behavior.',
  'BullMQ or pg-boss schedules source-specific ingestion jobs with retry budgets.',
  'Websocket topics stream only changed scores, alerts, and regime deltas.',
  'AI briefs are generated from compressed feature snapshots, never raw unbounded feeds.',
];

export default function MacroIntelligenceOverviewPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [now, setNow] = useState('');

  useEffect(() => {
    const tick = () => {
      setNow(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date()));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const strongest = currencies.length ? currencies.reduce((best, item) => item.strength > best.strength ? item : best, currencies[0]) : null;
  const weakest = currencies.length ? currencies.reduce((worst, item) => item.strength < worst.strength ? item : worst, currencies[0]) : null;
  const primaryRegime = regimes.length ? regimes.reduce((best, item) => item.score > best.score ? item : best, regimes[0]) : null;
  const transitionRisk = regimes.length ? Math.round(regimes.reduce((sum, item) => sum + item.probability, 0) / regimes.length) : null;

  const aiSummary = useMemo(() => [
    'Live macro regime scoring is not displayed until provider-backed observations, market snapshots, COT positioning and central-bank policy data are ingested.',
    'Currency strength rankings require real interest-rate differentials, inflation, employment, GDP, yield spreads, COT positioning, sentiment and safe-haven demand inputs.',
    'AI narrative generation is disabled for synthetic inputs. Configure live providers and the scoring engine will publish auditable summaries.',
  ], []);

  return (
    <div className="macro-light flex h-screen overflow-hidden bg-white text-slate-900 font-sans">
      <TraderSidebar bridgeOnline={false} mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />

      <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="Open navigation"
              className="grid h-10 w-10 place-items-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 lg:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">Macro Intelligence Overview</h1>
              <p className="text-xs font-mono uppercase tracking-wider text-indigo-700">Global regime, policy, liquidity, sentiment and intermarket command center</p>
            </div>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <StatusPill icon={CalendarClock} label="WAT" value={now || '--:--:--'} tone="cyan" />
            <StatusPill icon={Radio} label="Stream" value="Design ready" tone="emerald" />
            <StatusPill icon={RefreshCw} label="Cache" value="30s target" tone="violet" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50">
          <main className="space-y-5 p-4 md:p-6 lg:p-8">
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4 shadow-2xl shadow-black/20">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <KpiCard icon={Globe2} label="Dominant Regime" value={primaryRegime?.label ?? 'Awaiting live data'} detail={primaryRegime ? `${primaryRegime.score}% confidence` : 'No synthetic regime'} tone="rose" />
                  <KpiCard icon={TrendingUp} label="Strongest FX" value={strongest?.code ?? 'Awaiting live data'} detail={strongest ? `${strongest.strength}/100 strength` : 'No synthetic ranking'} tone="emerald" />
                  <KpiCard icon={TrendingDown} label="Weakest FX" value={weakest?.code ?? 'Awaiting live data'} detail={weakest ? `${weakest.strength}/100 strength` : 'No synthetic ranking'} tone="amber" />
                  <KpiCard icon={ShieldAlert} label="Transition Risk" value={transitionRisk == null ? 'Awaiting live data' : `${transitionRisk}%`} detail="Cross-regime probability" tone="violet" />
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {regimes.length ? regimes.map((regime) => (
                    <RegimeTile key={regime.label} {...regime} />
                  )) : <div className="md:col-span-2 xl:col-span-5"><EmptyLiveState /></div>}
                </div>
              </div>

              <Panel title="AI Intelligence Layer" icon={BrainCircuit}>
                <div className="space-y-3">
                  {aiSummary.map((line) => (
                    <div key={line} className="rounded-md border border-zinc-800 bg-black/30 p-3 text-sm leading-6 text-zinc-200">
                      {line}
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3">
                    <MiniSignal label="Capital flow" value="USD and CHF defensive inflow" tone="cyan" />
                    <MiniSignal label="Market vulnerability" value="Yields shock into equities" tone="rose" />
                    <MiniSignal label="Institutional outlook" value="Long USD vs low-yielders" tone="emerald" />
                    <MiniSignal label="Narrative risk" value="Inflation sticky, growth uneven" tone="amber" />
                  </div>
                </div>
              </Panel>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
              <Panel title="Currency Strength Matrix" icon={BarChart3}>
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-zinc-500">Currency</TableHead>
                      <TableHead className="text-zinc-500">Strength</TableHead>
                      <TableHead className="hidden text-zinc-500 md:table-cell">Drivers</TableHead>
                      <TableHead className="text-right text-zinc-500">Bias</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currencies.length ? currencies.map((currency) => (
                      <TableRow key={currency.code} className="border-zinc-800 hover:bg-zinc-900">
                        <TableCell className="font-mono text-sm font-semibold text-white">{currency.code}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <InlineBar value={currency.strength} className="w-28" />
                            <span className="font-mono text-xs text-zinc-300">{currency.strength}</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="grid grid-cols-4 gap-1 text-[10px] font-mono text-zinc-400">
                            <span>Rates {currency.rate}</span>
                            <span>Yields {currency.yields}</span>
                            <span>COT {currency.cot}</span>
                            <span>Haven {currency.haven}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs text-zinc-300">{currency.bias}</TableCell>
                      </TableRow>
                    )) : (
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableCell colSpan={4} className="h-28 text-center text-sm text-slate-600">
                          Currency strength matrix requires live provider-backed scoring. No mock rankings are displayed.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {strongest && weakest ? <div className="mt-4 rounded-md border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-100">
                  Divergence alert: {strongest.code}/{weakest.code} spread is {strongest.strength - weakest.strength} points. Prioritize pair selection where macro direction and central bank slope agree.
                </div> : null}
              </Panel>

              <Panel title="Macro Risk Monitor" icon={Gauge}>
                <div className="grid gap-3">
                  {macroRisks.length ? macroRisks.map((risk) => (
                    <MeterRow key={risk.label} {...risk} />
                  )) : <EmptyLiveState />}
                </div>
              </Panel>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
              <Panel title="Global Heatmap" icon={Activity}>
                <div className="overflow-x-auto">
                  <div className="min-w-[720px]">
                    <div className="grid grid-cols-[1.2fr_repeat(6,1fr)] gap-1 text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                      <span>Region</span>
                      <span>Inflation</span>
                      <span>GDP</span>
                      <span>Jobs</span>
                      <span>CB</span>
                      <span>Yields</span>
                      <span>FX</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {heatmapRows.map((row) => (
                        <div key={row.region} className="grid grid-cols-[1.2fr_repeat(6,1fr)] gap-1">
                          <div className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-2 text-xs font-semibold text-zinc-200">{row.region}</div>
                          <HeatCell value={row.inflation} />
                          <HeatCell value={row.growth} />
                          <HeatCell value={row.employment} />
                          <HeatCell value={row.bank} />
                          <HeatCell value={row.yields} />
                          <HeatCell value={row.currency} />
                        </div>
                      ))}
                    </div>
                    {heatmapRows.length === 0 ? <div className="mt-3"><EmptyLiveState /></div> : null}
                  </div>
                </div>
              </Panel>

              <Panel title="Intermarket Analysis" icon={LineChart}>
                <div className="space-y-2">
                  {intermarket.length ? intermarket.map((item) => (
                    <div key={item.pair} className="rounded-md border border-zinc-800 bg-black/25 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-zinc-100">{item.pair}</span>
                        <span className={cn('font-mono text-xs', item.corr < 0 ? 'text-rose-300' : 'text-emerald-300')}>
                          {item.corr > 0 ? '+' : ''}{item.corr.toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-400">{item.signal}</p>
                    </div>
                  )) : <EmptyLiveState />}
                </div>
              </Panel>
            </section>

            <Tabs defaultValue="architecture" className="rounded-lg border border-zinc-800 bg-zinc-900/80">
              <div className="flex flex-col gap-3 border-b border-zinc-800 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Cpu className="h-4 w-4 text-cyan-300" /> Backend Intelligence Design
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">Ingestion, normalization, scoring, caching, streaming, jobs, alerts and scale path.</p>
                </div>
                <TabsList className="h-9 border border-zinc-800 bg-black/30">
                  <TabsTrigger value="architecture" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-100">Architecture</TabsTrigger>
                  <TabsTrigger value="schema" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-100">Schema</TabsTrigger>
                  <TabsTrigger value="scoring" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-100">Scoring</TabsTrigger>
                  <TabsTrigger value="ops" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-100">Ops</TabsTrigger>
                </TabsList>
              </div>
              <CardContent className="p-4">
                <TabsContent value="architecture" className="m-0">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {sourcePipelines.map((pipeline) => (
                      <ArchitectureRow key={pipeline.source} icon={Database} title={pipeline.source} meta={pipeline.cadence} body={pipeline.payload} />
                    ))}
                    <ArchitectureRow icon={Zap} title="Normalization architecture" meta="provider adapters" body="Map source payloads into macro_events, macro_observations, market_snapshots and feature vectors with idempotent source keys." />
                    <ArchitectureRow icon={Radio} title="Websocket streaming" meta="changed deltas only" body="Stream regime deltas, currency ranks, event alerts and AI brief updates to subscribed dashboard clients." />
                  </div>
                </TabsContent>
                <TabsContent value="schema" className="m-0">
                  <CodeList items={schemas} />
                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {apiContracts.map((api) => <MiniSignal key={api} label="API" value={api} tone="cyan" />)}
                  </div>
                </TabsContent>
                <TabsContent value="scoring" className="m-0">
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {scoringModels.map((model) => (
                      <div key={model.name} className="rounded-md border border-zinc-800 bg-black/25 p-3">
                        <div className="text-sm font-semibold text-white">{model.name}</div>
                        <div className="mt-2 text-xs leading-5 text-zinc-400">{model.formula}</div>
                        <div className="mt-2 font-mono text-[11px] uppercase tracking-wider text-cyan-300">{model.output}</div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="ops" className="m-0">
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <OpsList title="Update Schedules" icon={CalendarClock} items={schedules} />
                    <OpsList title="Alert Systems" icon={Bell} items={alertRules} />
                    <OpsList title="Scalability Strategy" icon={Sparkles} items={scalability} />
                  </div>
                </TabsContent>
              </CardContent>
            </Tabs>
          </main>
        </div>
      </div>
    </div>
  );
}

function StatusPill(props: { icon: LucideIcon; label: string; value: string; tone: Tone }) {
  const Icon = props.icon;
  return (
    <div className={cn('flex items-center gap-2 rounded-md border px-3 py-1.5', toneBorder(props.tone), toneBg(props.tone))}>
      <Icon className={cn('h-4 w-4', toneText(props.tone))} />
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">{props.label}</span>
        <span className="font-mono text-xs text-zinc-100">{props.value}</span>
      </div>
    </div>
  );
}

function KpiCard(props: { icon: LucideIcon; label: string; value: string; detail: string; tone: Tone }) {
  const Icon = props.icon;
  return (
    <div className={cn('rounded-lg border p-4', toneBorder(props.tone), toneBg(props.tone))}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">{props.label}</span>
        <Icon className={cn('h-4 w-4', toneText(props.tone))} />
      </div>
      <div className="mt-3 text-2xl font-semibold text-white">{props.value}</div>
      <div className="mt-1 text-xs text-zinc-400">{props.detail}</div>
    </div>
  );
}

function Panel(props: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  const Icon = props.icon;
  return (
    <Card className="border-zinc-800 bg-zinc-900/80 text-zinc-100 shadow-2xl shadow-black/20">
      <CardHeader className="border-b border-zinc-800 py-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon className="h-4 w-4 text-cyan-300" /> {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">{props.children}</CardContent>
    </Card>
  );
}

function RegimeTile(props: { label: string; score: number; probability: number; comparison: string; tone: Tone }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-black/25 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-100">{props.label}</span>
        <span className={cn('font-mono text-xs', toneText(props.tone))}>{props.score}</span>
      </div>
      <InlineBar value={props.score} className="mt-3 h-1.5" />
      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
        <span>{props.comparison}</span>
        <span>{props.probability}% trans</span>
      </div>
    </div>
  );
}

function MiniSignal(props: { label: string; value: string; tone: Tone }) {
  return (
    <div className={cn('rounded-md border p-3', toneBorder(props.tone), toneBg(props.tone))}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{props.label}</div>
      <div className="mt-1 text-xs font-medium leading-5 text-zinc-100">{props.value}</div>
    </div>
  );
}

function MeterRow(props: { label: string; value: number; trend: string; tone: Tone }) {
  const UpIcon = props.trend.startsWith('+') ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="rounded-md border border-zinc-800 bg-black/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-200">{props.label}</span>
        <span className={cn('flex items-center gap-1 font-mono text-xs', toneText(props.tone))}>
          <UpIcon className="h-3 w-3" /> {props.trend}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <InlineBar value={props.value} />
        <span className="w-9 text-right font-mono text-xs text-zinc-300">{props.value}</span>
      </div>
    </div>
  );
}

function HeatCell(props: { value: number }) {
  const cls = props.value >= 70
    ? 'border-rose-400/30 bg-rose-500/25 text-rose-100'
    : props.value >= 55
      ? 'border-amber-400/30 bg-amber-500/20 text-amber-100'
      : props.value >= 40
        ? 'border-cyan-400/25 bg-cyan-500/15 text-cyan-100'
        : 'border-zinc-700 bg-zinc-900 text-zinc-300';

  return (
    <div className={cn('rounded-md border px-2 py-2 text-center font-mono text-xs', cls)}>{props.value}</div>
  );
}

function ArchitectureRow(props: { icon: LucideIcon; title: string; meta: string; body: string }) {
  const Icon = props.icon;
  return (
    <div className="flex gap-3 rounded-md border border-zinc-800 bg-black/25 p-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-cyan-400/25 bg-cyan-400/10">
        <Icon className="h-4 w-4 text-cyan-300" />
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-white">{props.title}</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{props.meta}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-zinc-400">{props.body}</p>
      </div>
    </div>
  );
}

function CodeList(props: { items: string[] }) {
  return (
    <div className="grid gap-2">
      {props.items.map((item) => (
        <div key={item} className="rounded-md border border-zinc-800 bg-black/30 px-3 py-2 font-mono text-[11px] leading-5 text-zinc-300">
          {item}
        </div>
      ))}
    </div>
  );
}

function OpsList(props: { title: string; icon: LucideIcon; items: string[] }) {
  const Icon = props.icon;
  return (
    <div className="rounded-md border border-zinc-800 bg-black/25 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <Icon className="h-4 w-4 text-cyan-300" /> {props.title}
      </div>
      <div className="mt-3 space-y-2">
        {props.items.map((item) => (
          <div key={item} className="rounded-md border border-zinc-800 bg-zinc-950/70 p-2 text-xs leading-5 text-zinc-400">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyLiveState() {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      Live provider data is required for this panel. No mock values are displayed.
    </div>
  );
}

function InlineBar(props: { value: number; className?: string }) {
  const value = Math.max(0, Math.min(100, props.value));
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-slate-200', props.className)}>
      <div className="h-full rounded-full bg-indigo-600" style={{ width: `${value}%` }} />
    </div>
  );
}

function toneBorder(tone: Tone): string {
  return {
    emerald: 'border-emerald-400/25',
    amber: 'border-amber-400/25',
    rose: 'border-rose-400/25',
    cyan: 'border-cyan-400/25',
    violet: 'border-violet-400/25',
    slate: 'border-zinc-700',
  }[tone];
}

function toneBg(tone: Tone): string {
  return {
    emerald: 'bg-emerald-500/10',
    amber: 'bg-amber-500/10',
    rose: 'bg-rose-500/10',
    cyan: 'bg-cyan-500/10',
    violet: 'bg-violet-500/10',
    slate: 'bg-zinc-900',
  }[tone];
}

function toneText(tone: Tone): string {
  return {
    emerald: 'text-emerald-300',
    amber: 'text-amber-300',
    rose: 'text-rose-300',
    cyan: 'text-cyan-300',
    violet: 'text-violet-300',
    slate: 'text-zinc-300',
  }[tone];
}
