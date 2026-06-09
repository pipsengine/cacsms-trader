'use client';

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Archive,
  Ban,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Eye,
  Filter,
  History,
  Landmark,
  ListChecks,
  Menu,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Square,
  TrendingDown,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { TraderSidebar } from '@/components/trader-sidebar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type Impact = 'Low' | 'Medium' | 'High' | 'Critical';
type Status = 'UPCOMING' | 'SCHEDULED' | 'PRE_MONITORING' | 'WATCHING' | 'RELEASED' | 'ANALYZED' | 'ARCHIVED' | 'FAILED' | 'CONFLICTED' | 'SOURCE_CONFLICT';
type Bias = 'Strong Bullish' | 'Mild Bullish' | 'Neutral' | 'Mild Bearish' | 'Strong Bearish' | 'Conflicted' | 'Not Enough Data';
type Tone = 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'slate';

type EconomicEvent = {
  id: string;
  sourceId: string | null;
  sourceName: string;
  sourceUrl: string | null;
  eventKey: string;
  eventName: string;
  normalizedEventName: string;
  country: string;
  currency: string;
  impactLevel: Impact;
  eventDate: string;
  eventTime: string | null;
  sourceTimezone: string;
  localEventTime: string | null;
  utcEventTime: string | null;
  brokerEventTime: string | null;
  actualValue: string | null;
  actualSource: string | null;
  actualCaptureStatus: string | null;
  actualCapturedAt: string | null;
  websiteActualValue: string | null;
  xmlActualValue: string | null;
  sourcePriorityUsed: string | null;
  forecastValue: string | null;
  previousValue: string | null;
  revisedPreviousValue: string | null;
  unit: string | null;
  status: Status;
  surpriseValue: number | null;
  surprisePercentage: number | null;
  surpriseDirection: string | null;
  bias: Bias;
  biasStrength: number;
  affectedPairs: string[];
  tradeRestrictionRequired: boolean;
  restrictionStartTime: string | null;
  restrictionEndTime: string | null;
  aiSummary: string | null;
  aiReasoning: string | null;
  sourceReliabilityScore: number;
  validationStatus: string;
  conflictStatus: string;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type SourceView = {
  id: string;
  sourceName: string;
  sourceType: string;
  sourceUrl: string;
  priority: number;
  enabled: boolean;
  requiresCredentials: boolean;
  reliabilityScore: number;
  successfulFetchCount: number;
  failedFetchCount: number;
  conflictCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastCheckedAt: string | null;
  status: 'ok' | 'disabled' | 'degraded' | 'failed' | 'needs_review';
};

type DashboardPayload = {
  ok: boolean;
  generatedAt: string;
  events: EconomicEvent[];
  sources: SourceView[];
  summary: {
    todaysHighImpactEvents: number;
    upcomingNext24Hours: number;
    monitoringNow: number;
    releasedAwaitingAnalysis: number;
    activeTradeRestrictions: number;
    sourceCollectionHealth: number;
    strongestBullishCurrencyToday: string | null;
    strongestBearishCurrencyToday: string | null;
  };
  currencyBias: Array<{ currency: string; score: number; bias: Bias; eventCount: number }>;
  conflicts: Array<{ id: string; eventId: string | null; conflictType: string; fieldName: string; sourceA: string; sourceB: string; valueA: string | null; valueB: string | null; createdAt: string }>;
  sourceLogs: Array<{ id: string; sourceName: string; jobType: string; status: string; message: string | null; fetchedAt: string }>;
  providerStatuses: Array<{ provider: string; status: string; message: string }>;
};

const emptyDashboard: DashboardPayload = {
  ok: false,
  generatedAt: '',
  events: [],
  sources: [],
  summary: {
    todaysHighImpactEvents: 0,
    upcomingNext24Hours: 0,
    monitoringNow: 0,
    releasedAwaitingAnalysis: 0,
    activeTradeRestrictions: 0,
    sourceCollectionHealth: 0,
    strongestBullishCurrencyToday: null,
    strongestBearishCurrencyToday: null,
  },
  currencyBias: [],
  conflicts: [],
  sourceLogs: [],
  providerStatuses: [],
};

const monitoredCurrencies = ['AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'NZD', 'USD'];
const currencies = ['All', ...monitoredCurrencies];
const impacts = ['All', 'Low', 'Medium', 'High', 'Critical'];
const statuses = ['All', 'UPCOMING', 'SCHEDULED', 'PRE_MONITORING', 'WATCHING', 'RELEASED', 'ANALYZED', 'ARCHIVED', 'FAILED', 'SOURCE_CONFLICT', 'CONFLICTED'];
const biases = ['All', 'Strong Bullish', 'Mild Bullish', 'Neutral', 'Mild Bearish', 'Strong Bearish', 'Conflicted', 'Not Enough Data'];
const dateRanges = ['All', 'Today', 'Tomorrow', 'This Week', 'Next Week'];

const actions = [
  { label: 'Run Hybrid Sync', endpoint: '/api/economic-calendar/forex-factory/hybrid-sync', icon: RefreshCw },
  { label: 'Run XML Sync', endpoint: '/api/economic-calendar/forex-factory/xml-sync', icon: ListChecks },
  { label: 'Run Website Browser Sync', endpoint: '/api/economic-calendar/forex-factory/browser-sync', icon: Eye },
  { label: 'Browser Actual Sync', endpoint: '/api/economic-calendar/forex-factory/browser-actual-sync', icon: CheckCircle2 },
  { label: 'Discover Upcoming Events', endpoint: '/api/economic-calendar/discover', icon: Search },
  { label: 'Refresh Calendar', endpoint: '/api/economic-calendar/refresh', icon: RefreshCw },
  { label: 'Start Monitoring', endpoint: '/api/economic-calendar/monitor/start', icon: Play },
  { label: 'Stop Monitoring', endpoint: '/api/economic-calendar/monitor/stop', icon: Square },
  { label: 'Retry Failed Events', endpoint: '/api/economic-calendar/failed/retry', icon: RotateCcw },
  { label: 'Analyze Released Events', endpoint: '/api/economic-calendar/analyze', icon: Zap },
  { label: 'Archive Completed Events', endpoint: '/api/economic-calendar/archive', icon: Archive },
];

function EconomicCalendarIntelligencePage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardPayload>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [now, setNow] = useState('');
  const [query, setQuery] = useState('');
  const [dateRange, setDateRange] = useState('All');
  const [currency, setCurrency] = useState('All');
  const [country, setCountry] = useState('All');
  const [impact, setImpact] = useState('All');
  const [status, setStatus] = useState('All');
  const [source, setSource] = useState('All');
  const [bias, setBias] = useState('All');
  const [restrictionOnly, setRestrictionOnly] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [activeTab, setActiveTab] = useState('table');
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (!tab) return;
    const allowed = new Set(['table', 'timeline', 'currency', 'impact', 'source', 'history', 'conflict', 'restriction']);
    if (!allowed.has(tab)) return;
    setActiveTab(tab);
  }, [searchParams]);

  const loadDashboard = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/economic-calendar/events', { cache: 'no-store' });
      const payload = (await response.json()) as DashboardPayload;
      if (!response.ok) {
        throw new Error(payload.providerStatuses?.[0]?.message ?? `Economic calendar returned HTTP ${response.status}`);
      }
      setDashboard(payload);
      setSelectedEventId((current) => current || payload.events[0]?.id || '');
    } catch (error) {
      setDashboard(emptyDashboard);
      setLoadError(error instanceof Error ? error.message : 'Cacsms Trader could not collect data from the selected source.');
    } finally {
      setLoading(false);
    }
  };

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

  useEffect(() => {
    queueMicrotask(loadDashboard);
    const interval = window.setInterval(loadDashboard, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const countries = useMemo(() => ['All', ...Array.from(new Set(dashboard.events.map((event) => event.country).filter(Boolean))).sort()], [dashboard.events]);
  const sources = useMemo(() => ['All', ...Array.from(new Set(dashboard.events.map((event) => event.sourceName).filter(Boolean))).sort()], [dashboard.events]);

  const filteredEvents = useMemo(() => {
    return dashboard.events.filter((event) => {
      const searchText = `${event.eventName} ${event.normalizedEventName} ${event.currency} ${event.country} ${event.sourceName}`.toLowerCase();
      if (query && !searchText.includes(query.toLowerCase())) return false;
      if (currency !== 'All' && event.currency !== currency) return false;
      if (country !== 'All' && event.country !== country) return false;
      if (impact !== 'All' && event.impactLevel !== impact) return false;
      if (status !== 'All' && event.status !== status) return false;
      if (source !== 'All' && event.sourceName !== source) return false;
      if (bias !== 'All' && event.bias !== bias) return false;
      if (restrictionOnly && !event.tradeRestrictionRequired) return false;
      if (!matchesDateRange(resolveEventDateTime(event), dateRange)) return false;
      return true;
    });
  }, [bias, country, currency, dashboard.events, dateRange, impact, query, restrictionOnly, source, status]);

  const selectedEvent = dashboard.events.find((event) => event.id === selectedEventId) ?? dashboard.events[0] ?? null;
  const sourceHealthTone: Tone = dashboard.summary.sourceCollectionHealth >= 80 ? 'emerald' : dashboard.summary.sourceCollectionHealth >= 50 ? 'amber' : 'rose';

  const runAction = async (endpoint: string, label: string) => {
    setActionMessage(`${label} requested...`);
    try {
      const response = await fetch(endpoint, { method: 'POST' });
      const payload = await response.json() as { ok: boolean; message: string };
      setActionMessage(payload.message || `${label} completed.`);
      await loadDashboard();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : `${label} failed.`);
    }
  };

  const captureActual = async (eventId: string) => {
    setActionMessage('Fetching actual from website...');
    try {
      const response = await fetch(`/api/economic-calendar/events/${encodeURIComponent(eventId)}/capture-actual`, { method: 'POST' });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      setActionMessage(payload.message || (payload.ok ? 'Captured.' : 'Capture failed.'));
      await loadDashboard();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Capture failed.');
    }
  };

  const exportJson = (name: string, value: unknown) => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="macro-light flex h-screen overflow-hidden bg-white text-slate-900 font-sans">
      <TraderSidebar bridgeOnline={false} mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-6">
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="Open navigation"
              className="grid h-10 w-10 place-items-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 lg:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">Economic Calendar Intelligence</h1>
              <p className="max-w-5xl text-xs font-mono uppercase tracking-wider text-indigo-700">
                Autonomous economic news monitoring, event impact analysis, currency bias generation, and historical market intelligence for Cacsms Trader.
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 xl:flex">
            <StatusPill icon={Clock} label="Local WAT" value={now || '--:--:--'} tone="cyan" />
            <StatusPill icon={Database} label="Events" value={String(dashboard.events.length)} tone="violet" />
            <StatusPill icon={ShieldAlert} label="Restrictions" value={String(dashboard.summary.activeTradeRestrictions)} tone="rose" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-white">
          <main className="space-y-5 p-4 md:p-6 lg:p-8">
            {loadError ? (
              <AlertBanner tone="rose" icon={AlertTriangle}>
                Cacsms Trader could not collect data from the selected source. Check source health, retry collection, or enable backup sources. {loadError}
              </AlertBanner>
            ) : null}
            {actionMessage ? <AlertBanner tone="cyan" icon={Bell}>{actionMessage}</AlertBanner> : null}
            {!loading && dashboard.events.length === 0 ? (
              <AlertBanner tone="amber" icon={Search}>
                No economic events have been collected yet. Start by running Discover Upcoming Events to allow Cacsms Trader to build its internal calendar from enabled free sources.
              </AlertBanner>
            ) : null}

            <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard icon={ShieldAlert} label="Today's High Impact Events" value={dashboard.summary.todaysHighImpactEvents} detail="High and critical events scheduled today." tone="rose" />
              <SummaryCard icon={CalendarClock} label="Upcoming Next 24 Hours" value={dashboard.summary.upcomingNext24Hours} detail="Events approaching active monitoring." tone="cyan" />
              <SummaryCard icon={Eye} label="Being Monitored" value={dashboard.summary.monitoringNow} detail="PRE_MONITORING or WATCHING lifecycle." tone="violet" />
              <SummaryCard icon={ListChecks} label="Awaiting Analysis" value={dashboard.summary.releasedAwaitingAnalysis} detail="Released events not yet analyzed." tone="amber" />
              <SummaryCard icon={Ban} label="Trade Restrictions" value={dashboard.summary.activeTradeRestrictions} detail="Active protection windows right now." tone="rose" />
              <SummaryCard icon={Database} label="Source Health" value={`${dashboard.summary.sourceCollectionHealth}/100`} detail="Reliability from enabled source history." tone={sourceHealthTone} />
              <SummaryCard icon={TrendingUp} label="Strongest Bullish Currency" value={dashboard.summary.strongestBullishCurrencyToday ?? 'None'} detail="Computed only from analyzed events." tone="emerald" />
              <SummaryCard icon={TrendingDown} label="Strongest Bearish Currency" value={dashboard.summary.strongestBearishCurrencyToday ?? 'None'} detail="Computed only from analyzed events." tone="amber" />
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
              <Panel title="Calendar Control Center" icon={Landmark}>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {actions.map((action) => (
                    <button
                      key={action.endpoint}
                      type="button"
                      className="flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                      onClick={() => runAction(action.endpoint, action.label)}
                    >
                      <action.icon className="h-4 w-4" /> {action.label}
                    </button>
                  ))}
                  <button type="button" className="flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50" onClick={() => exportJson('economic-calendar', dashboard.events)}>
                    <Download className="h-4 w-4" /> Export Calendar
                  </button>
                  <button type="button" className="flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50" onClick={() => exportJson('economic-history', dashboard)}>
                    <History className="h-4 w-4" /> Export History
                  </button>
                  <button type="button" className="flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50" onClick={() => setActiveTab('conflict')}>
                    <ShieldAlert className="h-4 w-4" /> View Conflicts
                  </button>
                  <button type="button" className="flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50" onClick={() => setActiveTab('source')}>
                    <Database className="h-4 w-4" /> View Sources
                  </button>
                </div>
              </Panel>

              <Panel title="Today's Economic Intelligence Summary" icon={Zap}>
                <p className="text-sm leading-6 text-slate-700">{buildDailySummary(dashboard)}</p>
              </Panel>
            </section>

            <Panel title="Filters & Search" icon={Filter}>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_repeat(7,1fr)]">
                <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search event, currency, country, source, CPI, NFP, GDP, PMI, Retail Sales, Interest Rate"
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </div>
                <Select value={dateRange} onChange={setDateRange} options={dateRanges} />
                <Select value={currency} onChange={setCurrency} options={currencies} />
                <Select value={country} onChange={setCountry} options={countries} />
                <Select value={impact} onChange={setImpact} options={impacts} />
                <Select value={status} onChange={setStatus} options={statuses} />
                <Select value={source} onChange={setSource} options={sources} />
                <Select value={bias} onChange={setBias} options={biases} />
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={restrictionOnly} onChange={(event) => setRestrictionOnly(event.target.checked)} />
                Trade restriction active or required
              </label>
            </Panel>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">Economic Event Intelligence Views</h2>
                  <p className="mt-1 text-xs text-slate-500">Upcoming, live, released, analyzed, failed, conflicted, archived, and restriction-focused event views.</p>
                </div>
                <TabsList className="h-auto flex-wrap justify-start bg-slate-100">
                  <TabsTrigger value="table">Table</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="currency">Currency</TabsTrigger>
                  <TabsTrigger value="impact">Impact</TabsTrigger>
                  <TabsTrigger value="source">Source</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                  <TabsTrigger value="conflict">Conflict</TabsTrigger>
                  <TabsTrigger value="restriction">Restrictions</TabsTrigger>
                </TabsList>
              </div>
              <CardContent className="p-0">
                <TabsContent value="table" className="m-0">
                  <EventTable
                    events={filteredEvents}
                    totalEvents={dashboard.events.length}
                    filtersActive={dateRange !== 'All' || currency !== 'All' || country !== 'All' || impact !== 'All' || status !== 'All' || source !== 'All' || bias !== 'All' || restrictionOnly || Boolean(query.trim())}
                    loading={loading}
                    selectedId={selectedEvent?.id ?? ''}
                    onSelect={setSelectedEventId}
                    onCaptureActual={captureActual}
                  />
                </TabsContent>
                <TabsContent value="timeline" className="m-0 p-4">
                  <TimelineView events={filteredEvents} onSelect={setSelectedEventId} />
                </TabsContent>
                <TabsContent value="currency" className="m-0 p-4">
                  <CurrencyView events={filteredEvents} currencyBias={dashboard.currencyBias} />
                </TabsContent>
                <TabsContent value="impact" className="m-0 p-4">
                  <GroupedCards events={filteredEvents} groupBy={(event) => event.impactLevel} empty="No events for the selected impact filters." />
                </TabsContent>
                <TabsContent value="source" className="m-0 p-4">
                  <SourceHealthPanel sources={dashboard.sources} />
                </TabsContent>
                <TabsContent value="history" className="m-0 p-4">
                  <GroupedCards events={filteredEvents.filter((event) => event.status === 'ARCHIVED')} groupBy={(event) => event.currency} empty="No archived economic events have been recorded yet." />
                </TabsContent>
                <TabsContent value="conflict" className="m-0 p-4">
                  <ConflictPanel conflicts={dashboard.conflicts} />
                </TabsContent>
                <TabsContent value="restriction" className="m-0 p-4">
                  <TradeRestrictionPanel events={filteredEvents.filter((event) => event.tradeRestrictionRequired)} />
                </TabsContent>
              </CardContent>
            </Tabs>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <EventDetailPanel event={selectedEvent} onOpenComparison={() => setComparisonOpen(true)} />
              <div className="grid gap-4">
                <SourceLogsPanel logs={dashboard.sourceLogs} providerStatuses={dashboard.providerStatuses} />
                <SettingsPanel />
              </div>
            </section>
          </main>
        </div>
      </div>
      <SourceComparisonModal open={comparisonOpen} onClose={() => setComparisonOpen(false)} event={selectedEvent} />
    </div>
  );
}

function EventTable(props: {
  events: EconomicEvent[];
  totalEvents: number;
  filtersActive: boolean;
  loading: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  onCaptureActual: (id: string) => Promise<void>;
}) {
  return (
    <div className="w-full overflow-x-auto">
      <Table>
      <TableHeader className="bg-slate-50">
        <TableRow className="hover:bg-transparent">
          {['Date', 'Time', 'Local Time', 'Currency', 'Country', 'Event Name', 'Impact', 'Actual', 'Actual Source', 'Capture', 'Forecast', 'Previous', 'Surprise', 'Bias', 'Status', 'Source', 'Reliability', 'Trade Restriction', 'Last Checked', 'Actions'].map((column) => (
            <TableHead key={column} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.loading || props.events.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={18} className="h-36 text-center text-sm text-slate-600">
              {props.loading
                ? 'Collecting and validating economic calendar data...'
                : props.totalEvents > 0 && props.filtersActive
                  ? `No events match the current filters (${props.totalEvents} collected). Try "All" for the date range or run Refresh Calendar for the latest week.`
                  : 'No economic events have been collected yet. Start by running Discover Upcoming Events to allow Cacsms Trader to build its internal calendar from enabled free sources.'}
            </TableCell>
          </TableRow>
        ) : props.events.map((event) => (
          <TableRow key={event.id} className={cn('cursor-pointer hover:bg-indigo-50/50', props.selectedId === event.id && 'bg-indigo-50')} onClick={() => props.onSelect(event.id)}>
            <TableCell className="px-3 font-mono text-xs">{event.eventDate}</TableCell>
            <TableCell className="px-3 font-mono text-xs">{event.eventTime ?? '--'}</TableCell>
            <TableCell className="px-3 font-mono text-xs">{formatDateTime(event.localEventTime)}</TableCell>
            <TableCell className="px-3"><CurrencyBadge currency={event.currency} /></TableCell>
            <TableCell className="px-3 text-xs text-slate-700">{event.country}</TableCell>
            <TableCell className="min-w-[260px] px-3">
              <div className="text-sm font-semibold text-slate-950">{event.eventName}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <SourceIndicators event={event} />
              </div>
              <div className="text-xs text-slate-500">{event.normalizedEventName}</div>
            </TableCell>
            <TableCell className="px-3"><ImpactBadge impact={event.impactLevel} /></TableCell>
            <TableCell className="px-3 font-mono text-xs">
              {actualDisplayValue(event)}
            </TableCell>
            <TableCell className="px-3 text-xs"><Badge className="border border-slate-200 bg-slate-50 text-slate-700">{event.actualSource ?? 'NONE'}</Badge></TableCell>
            <TableCell className="px-3 text-xs"><Badge className="border border-slate-200 bg-slate-50 text-slate-700">{event.actualCaptureStatus ?? 'PENDING'}</Badge></TableCell>
            <TableCell className="px-3 font-mono text-xs">{event.forecastValue ?? '--'}</TableCell>
            <TableCell className="px-3 font-mono text-xs">{event.revisedPreviousValue ?? event.previousValue ?? '--'}</TableCell>
            <TableCell className="px-3 font-mono text-xs">{event.surprisePercentage == null ? 'Pending' : `${event.surprisePercentage}%`}</TableCell>
            <TableCell className="px-3"><BiasBadge bias={event.bias} /></TableCell>
            <TableCell className="px-3"><StatusBadge status={event.status} /></TableCell>
            <TableCell className="px-3 text-xs">{event.sourcePriorityUsed ?? (String(event.validationStatus ?? '').toUpperCase().includes('INVESTING') ? 'INVESTING' : event.sourceName)}</TableCell>
            <TableCell className="px-3 font-mono text-xs">{event.sourceReliabilityScore}/100</TableCell>
            <TableCell className="px-3">{event.tradeRestrictionRequired ? <Badge className="bg-rose-50 text-rose-700 border border-rose-200">Restricted</Badge> : <Badge className="bg-slate-50 text-slate-600 border border-slate-200">None</Badge>}</TableCell>
            <TableCell className="px-3 font-mono text-xs">{formatDateTime(event.lastCheckedAt)}</TableCell>
            <TableCell className="px-3">
              <button
                type="button"
                className="mr-2 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                disabled={Boolean(event.actualValue)}
                onClick={async (e) => {
                  e.stopPropagation();
                  await props.onCaptureActual(event.id);
                }}
              >
                Fetch Actual
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
                onClick={(e) => {
                  e.stopPropagation();
                  if (event.sourceUrl) window.open(event.sourceUrl, '_blank', 'noopener,noreferrer');
                }}
              >
                Open
              </button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      </Table>
    </div>
  );
}

function EventDetailPanel({ event, onOpenComparison }: { event: EconomicEvent | null; onOpenComparison: () => void }) {
  return (
    <Panel title="Event Detail Drawer" icon={Eye}>
      {!event ? (
        <EmptyState text="Select an economic event to inspect source comparison, release data, bias, restrictions, and archive status." />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">{event.eventName}</h3>
              <p className="text-sm text-slate-500">{event.normalizedEventName}</p>
            </div>
            <div className="flex gap-2"><ImpactBadge impact={event.impactLevel} /><StatusBadge status={event.status} /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Info label="Currency" value={event.currency} />
            <Info label="Country" value={event.country} />
            <Info label="Source Timezone" value={event.sourceTimezone} />
            <Info label="UTC Time" value={formatDateTime(event.utcEventTime)} />
            <Info label="Local Time" value={formatDateTime(event.localEventTime)} />
            <Info label="Broker Time" value={formatDateTime(event.brokerEventTime)} />
            <Info label="Actual" value={event.actualValue ?? valueState(event.status)} />
            <Info label="Forecast" value={event.forecastValue ?? '--'} />
            <Info label="Previous" value={event.revisedPreviousValue ?? event.previousValue ?? '--'} />
            <Info label="Revised Previous" value={event.revisedPreviousValue ?? '--'} />
            <Info label="Surprise" value={event.surprisePercentage == null ? 'Pending' : `${event.surprisePercentage}%`} />
            <Info label="Reliability" value={`${event.sourceReliabilityScore}/100`} />
          </div>
          <Info label="Source URL" value={event.sourceUrl ?? 'No source URL recorded'} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50" onClick={onOpenComparison}>
              Compare Sources
            </button>
          </div>
          <Info label="Affected Pairs" value={event.affectedPairs.length ? event.affectedPairs.join(', ') : 'No affected pairs computed yet'} />
          <Info label="Trading Risk Instruction" value={tradeInstruction(event)} />
          <Info label="AI Interpretation" value={event.aiSummary ?? 'AI can interpret only after actual value is collected or manually confirmed.'} />
          <Info label="AI Reasoning" value={event.aiReasoning ?? 'Not Enough Data'} />
          <Info label="Collection Attempts" value={`Last checked: ${formatDateTime(event.lastCheckedAt)}`} />
          <Info label="Source Comparison" value={event.conflictStatus === 'NONE' ? event.validationStatus : `Conflict: ${event.conflictStatus}`} />
          <Info label="Archive Status" value={event.archivedAt ? `Archived ${formatDateTime(event.archivedAt)}` : 'Not archived'} />
        </div>
      )}
    </Panel>
  );
}

function SourceIndicators({ event }: { event: EconomicEvent }) {
  const tags: Array<{ label: string; cls: string }> = [];
  const validation = String(event.validationStatus ?? '').toUpperCase();
  if (validation.includes('PROVISIONAL') || validation.includes('XML')) tags.push({ label: 'XML', cls: 'border-slate-200 bg-slate-50 text-slate-700' });
  if (validation.includes('WEBSITE')) tags.push({ label: 'WEB', cls: 'border-indigo-200 bg-indigo-50 text-indigo-700' });
  if (validation.includes('PREFERRED')) tags.push({ label: 'WEB PREFERRED', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' });
  const conflict = String(event.conflictStatus ?? '').toUpperCase();
  if (event.status === 'SOURCE_CONFLICT' || conflict.includes('CONFLICT')) tags.push({ label: 'CONFLICT', cls: 'border-rose-200 bg-rose-50 text-rose-700' });
  if (!event.actualValue && (event.status === 'WATCHING' || event.status === 'PRE_MONITORING')) tags.push({ label: 'ACTUAL PENDING', cls: 'border-amber-200 bg-amber-50 text-amber-700' });
  if (event.actualValue) tags.push({ label: 'ACTUAL CAPTURED', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' });
  if (event.status === 'ANALYZED') tags.push({ label: 'ANALYZED', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' });
  if (event.status === 'ARCHIVED') tags.push({ label: 'ARCHIVED', cls: 'border-slate-200 bg-slate-50 text-slate-700' });
  return tags.length ? tags.map((tag) => <Badge key={tag.label} className={cn('rounded-md border px-2 py-0.5 text-[10px] font-mono', tag.cls)}>{tag.label}</Badge>) : null;
}

function SourceComparisonModal(props: { open: boolean; onClose: () => void; event: EconomicEvent | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshots, setSnapshots] = useState<Array<{ id: string; source_name: string; raw_payload: unknown; captured_at: string }>>([]);
  const [conflicts, setConflicts] = useState<Array<{ id: string; conflict_type: string; field_name: string; source_a: string; value_a: string | null; source_b: string; value_b: string | null; created_at: string }>>([]);

  useEffect(() => {
    if (!props.open || !props.event?.id) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/economic-calendar/event-sources?eventId=${encodeURIComponent(props.event.id)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        setSnapshots(body.snapshots ?? []);
        setConflicts(body.conflicts ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load sources.');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.event?.id, props.open]);

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={props.onClose}>
      <div className="w-full max-w-4xl rounded-lg border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold text-slate-950">Source Comparison</div>
          <button type="button" className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={props.onClose}>Close</button>
        </div>
        <div className="space-y-4 p-4">
          {loading ? <div className="text-sm text-slate-600">Loading...</div> : null}
          {error ? <AlertBanner tone="rose" icon={AlertTriangle}>{error}</AlertBanner> : null}
          {!loading && !error ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs font-mono uppercase tracking-wider text-slate-500">Snapshots</div>
                {snapshots.length ? snapshots.map((snap) => (
                  <div key={snap.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">{snap.source_name}</div>
                      <div className="text-[11px] font-mono text-slate-500">{snap.captured_at}</div>
                    </div>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-white p-2 text-[11px] text-slate-700">{JSON.stringify(snap.raw_payload, null, 2)}</pre>
                  </div>
                )) : <EmptyState text="No source snapshots stored yet. Run XML Sync or Website Browser Sync." />}
              </div>
              <div className="space-y-2">
                <div className="text-xs font-mono uppercase tracking-wider text-slate-500">Conflicts</div>
                {conflicts.length ? conflicts.map((conflict) => (
                  <div key={conflict.id} className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                    <div className="font-semibold">{conflict.field_name}</div>
                    <div className="mt-1 text-xs">{conflict.source_a}: {conflict.value_a ?? '--'}</div>
                    <div className="text-xs">{conflict.source_b}: {conflict.value_b ?? '--'}</div>
                    <div className="mt-1 text-[11px] font-mono text-rose-700">{conflict.created_at}</div>
                  </div>
                )) : <EmptyState text="No conflicts recorded for this event." />}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TimelineView(props: { events: EconomicEvent[]; onSelect: (id: string) => void }) {
  const sessions = ['Asian Session', 'London Session', 'New York Session'];
  const grouped = Object.fromEntries(sessions.map((session) => [session, props.events.filter((event) => sessionForEvent(event) === session)]));
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {sessions.map((session) => (
        <div key={session} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-3 text-sm font-semibold text-slate-950">{session}</div>
          <div className="space-y-2">
            {grouped[session].length ? grouped[session].map((event) => (
              <button key={event.id} type="button" className="block w-full rounded-md border border-slate-200 bg-white p-3 text-left hover:border-indigo-200 hover:bg-indigo-50" onClick={() => props.onSelect(event.id)}>
                <div className="flex items-center justify-between gap-3"><CurrencyBadge currency={event.currency} /><ImpactBadge impact={event.impactLevel} /></div>
                <div className="mt-2 text-sm font-semibold text-slate-950">{event.eventName}</div>
                <div className="mt-1 text-xs text-slate-500">{formatDateTime(event.localEventTime)} / Forecast {event.forecastValue ?? '--'} / Previous {event.revisedPreviousValue ?? event.previousValue ?? '--'}</div>
                <div className="mt-2"><StatusBadge status={event.status} /> {event.tradeRestrictionRequired ? <Badge className="ml-2 border border-rose-200 bg-rose-50 text-rose-700">Restriction</Badge> : null}</div>
              </button>
            )) : <EmptyState text="No events in this session." />}
          </div>
        </div>
      ))}
    </div>
  );
}

function CurrencyView(props: { events: EconomicEvent[]; currencyBias: DashboardPayload['currencyBias'] }) {
  const allCurrencies = monitoredCurrencies;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
      {allCurrencies.map((currency) => {
        const events = props.events.filter((event) => event.currency === currency);
        const bias = props.currencyBias.find((item) => item.currency === currency);
        return (
          <div key={currency} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between"><CurrencyBadge currency={currency} /><BiasBadge bias={bias?.bias ?? 'Not Enough Data'} /></div>
            <div className="mt-3 font-mono text-2xl font-semibold text-slate-950">{bias?.score ?? 0}</div>
            <div className="text-xs text-slate-500">Net daily bias score / {events.length} filtered events</div>
            <div className="mt-3 space-y-1">{events.slice(0, 4).map((event) => <div key={event.id} className="truncate rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">{event.eventName}</div>)}</div>
          </div>
        );
      })}
    </div>
  );
}

function SourceHealthPanel({ sources }: { sources: SourceView[] }) {
  return sources.length ? (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {sources.map((source) => (
        <div key={source.id} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-slate-950">{source.sourceName}</div>
            <SourceBadge status={source.status} />
          </div>
          <div className="mt-2 text-xs text-slate-500">{source.sourceType} / priority {source.priority}</div>
          <div className="mt-3 font-mono text-2xl font-semibold text-slate-950">{source.reliabilityScore}/100</div>
          <div className="mt-2 text-xs text-slate-600">Success {source.successfulFetchCount} / Failed {source.failedFetchCount} / Conflicts {source.conflictCount}</div>
          <div className="mt-2 text-xs text-slate-500">Last checked {formatDateTime(source.lastCheckedAt)}</div>
        </div>
      ))}
    </div>
  ) : <EmptyState text="No economic sources are registered yet. Run migration 008 to install source registry defaults." />;
}

function ConflictPanel({ conflicts }: { conflicts: DashboardPayload['conflicts'] }) {
  return conflicts.length ? (
    <div className="space-y-2">
      {conflicts.map((conflict) => (
        <div key={conflict.id} className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          {conflict.conflictType} on {conflict.fieldName}: {conflict.sourceA}={conflict.valueA ?? '--'} vs {conflict.sourceB}={conflict.valueB ?? '--'}
        </div>
      ))}
    </div>
  ) : <EmptyState text="No source conflicts are currently recorded. Conflicted events will block automatic trade permission." />;
}

function TradeRestrictionPanel({ events }: { events: EconomicEvent[] }) {
  return events.length ? (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {events.map((event) => (
        <div key={event.id} className="rounded-md border border-rose-200 bg-rose-50 p-3">
          <div className="font-semibold text-rose-950">{event.eventName}</div>
          <div className="mt-1 text-xs text-rose-800">{event.currency} / {event.affectedPairs.join(', ') || 'affected pairs pending'}</div>
          <div className="mt-2 text-xs text-rose-700">{formatDateTime(event.restrictionStartTime)} to {formatDateTime(event.restrictionEndTime)}</div>
        </div>
      ))}
    </div>
  ) : <EmptyState text="No trade restriction windows match the current filters." />;
}

function GroupedCards(props: { events: EconomicEvent[]; groupBy: (event: EconomicEvent) => string; empty: string }) {
  const groups = useMemo(() => {
    const map = new Map<string, EconomicEvent[]>();
    for (const event of props.events) {
      const key = props.groupBy(event) || 'Unknown';
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return Array.from(map.entries());
  }, [props]);

  return groups.length ? (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      {groups.map(([group, events]) => (
        <div key={group} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="font-semibold text-slate-950">{group}</div>
          <div className="mt-3 space-y-2">{events.map((event) => <div key={event.id} className="rounded bg-slate-50 p-2 text-xs text-slate-700">{event.eventName} / {event.currency} / {event.status}</div>)}</div>
        </div>
      ))}
    </div>
  ) : <EmptyState text={props.empty} />;
}

function SourceLogsPanel(props: { logs: DashboardPayload['sourceLogs']; providerStatuses: DashboardPayload['providerStatuses'] }) {
  return (
    <Panel title="Source Logs & Health Indicators" icon={Bell}>
      <div className="space-y-2">
        {props.providerStatuses.map((status) => (
          <div key={`${status.provider}-${status.status}`} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"><span className="font-semibold">{status.provider}</span>: {status.message}</div>
        ))}
        {props.logs.length ? props.logs.slice(0, 8).map((log) => (
          <div key={log.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700">{formatDateTime(log.fetchedAt)} / {log.sourceName} / {log.jobType} / {log.status} / {log.message ?? ''}</div>
        )) : <EmptyState text="No source fetch logs have been recorded yet." />}
      </div>
    </Panel>
  );
}

function SettingsPanel() {
  const settings = [
    'Enable/disable source and set source priority',
    'Set scraping frequency and monitoring intervals',
    'Set source, local, broker, and UTC timezone handling',
    'Set trade restriction rules by impact level',
    'Set affected pairs per currency',
    'Set event importance and normalization rules',
    'Enable AI analysis only after real actual value is collected',
    'Enable auto-archive, conflict protection, and retry on failure',
  ];
  return (
    <Panel title="Admin Settings" icon={Settings2}>
      <div className="grid gap-2">
        {settings.map((setting) => <div key={setting} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{setting}</div>)}
      </div>
    </Panel>
  );
}

function Panel(props: { title: string; icon: LucideIcon; children: ReactNode }) {
  const Icon = props.icon;
  return (
    <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950"><Icon className="h-4 w-4 text-indigo-700" /> {props.title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">{props.children}</CardContent>
    </Card>
  );
}

function SummaryCard(props: { icon: LucideIcon; label: string; value: number | string; detail: string; tone: Tone }) {
  const Icon = props.icon;
  return (
    <div className={cn('rounded-lg border p-4 shadow-sm', toneBorder(props.tone), toneBg(props.tone))}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500">{props.label}</span>
        <Icon className={cn('h-4 w-4', toneText(props.tone))} />
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-950">{props.value}</div>
      <div className="mt-1 text-xs text-slate-600">{props.detail}</div>
    </div>
  );
}

function StatusPill(props: { icon: LucideIcon; label: string; value: string; tone: Tone }) {
  const Icon = props.icon;
  return (
    <div className={cn('flex items-center gap-2 rounded-md border px-3 py-1.5', toneBorder(props.tone), toneBg(props.tone))}>
      <Icon className={cn('h-4 w-4', toneText(props.tone))} />
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{props.label}</span>
        <span className="font-mono text-xs text-slate-950">{props.value}</span>
      </div>
    </div>
  );
}

function AlertBanner(props: { tone: Tone; icon: LucideIcon; children: ReactNode }) {
  const Icon = props.icon;
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border p-3 text-sm', toneBorder(props.tone), toneBg(props.tone), toneText(props.tone))}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-slate-800">{props.children}</div>
    </div>
  );
}

function Select(props: { value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <select className="h-10 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={props.value} onChange={(event) => props.onChange(event.target.value)}>
      {props.options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}

function CurrencyBadge({ currency }: { currency: string }) {
  return <Badge className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 font-mono text-[11px] text-indigo-700">{currency}</Badge>;
}

function ImpactBadge({ impact }: { impact: Impact }) {
  const cls = {
    Critical: 'border-rose-200 bg-rose-50 text-rose-700',
    High: 'border-amber-200 bg-amber-50 text-amber-700',
    Medium: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    Low: 'border-slate-200 bg-slate-50 text-slate-600',
  }[impact];
  return <Badge className={cn('rounded-md border px-2 py-1 text-[10px] uppercase tracking-wider', cls)}>{impact}</Badge>;
}

function StatusBadge({ status }: { status: Status }) {
  const cls = status === 'FAILED' || status === 'CONFLICTED' || status === 'SOURCE_CONFLICT' ? 'border-rose-200 bg-rose-50 text-rose-700'
    : status === 'ANALYZED' || status === 'ARCHIVED' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'WATCHING' || status === 'PRE_MONITORING' ? 'border-violet-200 bg-violet-50 text-violet-700'
        : 'border-slate-200 bg-slate-50 text-slate-600';
  return <Badge className={cn('rounded-md border px-2 py-1 text-[10px] uppercase tracking-wider', cls)}>{status}</Badge>;
}

function BiasBadge({ bias }: { bias: Bias }) {
  const cls = bias.includes('Bullish') ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : bias.includes('Bearish') ? 'border-rose-200 bg-rose-50 text-rose-700'
      : bias === 'Conflicted' ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-600';
  return <Badge className={cn('rounded-md border px-2 py-1 text-[10px]', cls)}>{bias}</Badge>;
}

function SourceBadge({ status }: { status: SourceView['status'] }) {
  const cls = status === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : status === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-700'
      : status === 'needs_review' ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-600';
  return <Badge className={cn('rounded-md border px-2 py-1 text-[10px]', cls)}>{status}</Badge>;
}

function Info(props: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{props.label}</div>
      <div className="mt-1 break-words text-sm text-slate-800">{props.value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{text}</div>;
}

function formatDateTime(value: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function resolveEventDateTime(event: EconomicEvent): string | null {
  return event.utcEventTime ?? event.localEventTime ?? (event.eventDate ? `${String(event.eventDate).slice(0, 10)}T12:00:00` : null);
}

function calendarWeekBounds(reference: Date, weekOffset: number): { start: number; end: number } {
  const day = reference.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + mondayOffset + weekOffset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.getTime(), end: end.getTime() };
}

function matchesDateRange(value: string | null, range: string): boolean {
  if (range === 'All') return true;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const time = date.getTime();
  if (range === 'Today') return time >= startToday && time < startToday + dayMs;
  if (range === 'Tomorrow') return time >= startToday + dayMs && time < startToday + dayMs * 2;
  if (range === 'This Week') {
    const { start, end } = calendarWeekBounds(now, 0);
    return time >= start && time < end;
  }
  if (range === 'Next Week') {
    const { start, end } = calendarWeekBounds(now, 1);
    return time >= start && time < end;
  }
  return true;
}

function sessionForEvent(event: EconomicEvent): string {
  const date = new Date(event.localEventTime ?? event.utcEventTime ?? event.eventDate);
  const hour = Number.isNaN(date.getTime()) ? 0 : date.getHours();
  if (hour < 8) return 'Asian Session';
  if (hour < 13) return 'London Session';
  return 'New York Session';
}

function valueState(status: Status): string {
  if (status === 'UPCOMING' || status === 'SCHEDULED' || status === 'PRE_MONITORING' || status === 'WATCHING') return 'Pending';
  return 'Not Available';
}

function tradeInstruction(event: EconomicEvent): string {
  if (event.conflictStatus !== 'NONE' || event.status === 'CONFLICTED' || event.status === 'SOURCE_CONFLICT') return 'Conflict protection active. Do not grant automatic trade permission.';
  if (!event.tradeRestrictionRequired) return 'No automatic restriction recorded for this event.';
  return `Restrict new trades from ${formatDateTime(event.restrictionStartTime)} to ${formatDateTime(event.restrictionEndTime)}. Allow trading only after spread and volatility normalize.`;
}

function actualDisplayValue(event: EconomicEvent): string {
  if (event.actualValue) return event.actualValue;
  if (String(event.actualCaptureStatus ?? '').toUpperCase() === 'FAILED') return 'Failed';
  if (event.status === 'UPCOMING' || event.status === 'SCHEDULED' || event.status === 'PRE_MONITORING' || event.status === 'WATCHING') return 'Pending';
  return 'Not Available';
}

function buildDailySummary(dashboard: DashboardPayload): string {
  if (dashboard.events.length === 0) {
    return 'No economic events have been collected yet. Run Discover Upcoming Events after enabling reviewed free/public sources. Cacsms Trader will not invent actual, forecast, previous, or bias values.';
  }
  const critical = dashboard.events.filter((event) => event.impactLevel === 'Critical');
  const currencies = Array.from(new Set(dashboard.events.map((event) => event.currency))).join(', ');
  return `Today has ${dashboard.summary.todaysHighImpactEvents} high-impact events and ${dashboard.summary.activeTradeRestrictions} active trade restriction windows. Monitored currencies: ${currencies || 'none'}. Strongest bullish currency: ${dashboard.summary.strongestBullishCurrencyToday ?? 'not enough data'}. Strongest bearish currency: ${dashboard.summary.strongestBearishCurrencyToday ?? 'not enough data'}. ${critical.length ? `Critical risk: ${critical.slice(0, 3).map((event) => event.eventName).join(', ')}.` : 'No critical event is currently collected.'}`;
}

function toneBorder(tone: Tone): string {
  return {
    emerald: 'border-emerald-200',
    amber: 'border-amber-200',
    rose: 'border-rose-200',
    cyan: 'border-cyan-200',
    violet: 'border-violet-200',
    slate: 'border-slate-200',
  }[tone];
}

function toneBg(tone: Tone): string {
  return {
    emerald: 'bg-emerald-50',
    amber: 'bg-amber-50',
    rose: 'bg-rose-50',
    cyan: 'bg-cyan-50',
    violet: 'bg-violet-50',
    slate: 'bg-slate-50',
  }[tone];
}

function toneText(tone: Tone): string {
  return {
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
    cyan: 'text-cyan-700',
    violet: 'text-violet-700',
    slate: 'text-slate-700',
  }[tone];
}

function toneBadgeClass(tone: Tone): string {
  return `${toneBorder(tone)} ${toneBg(tone)} ${toneText(tone)}`;
}

function policyBiasTone(value: string | null): Tone {
  const raw = String(value ?? '');
  if (raw.includes('Strong Bullish')) return 'emerald';
  if (raw.includes('Mild Bullish')) return 'cyan';
  if (raw.includes('Strong Bearish')) return 'rose';
  if (raw.includes('Mild Bearish')) return 'amber';
  if (raw.includes('Neutral')) return 'slate';
  return 'slate';
}

function decisionTone(value: string | null): Tone {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'HIKE') return 'emerald';
  if (raw === 'CUT') return 'rose';
  if (raw === 'HOLD') return 'slate';
  return 'slate';
}

export default function EconomicCalendarIntelligencePageRoute() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white text-slate-600 p-6">Loading economic calendar...</div>}>
      <EconomicCalendarIntelligencePage />
    </Suspense>
  );
}

function surpriseTone(value: string | null): Tone {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'HAWKISH_SURPRISE') return 'emerald';
  if (raw === 'DOVISH_SURPRISE') return 'rose';
  if (raw === 'AS_EXPECTED') return 'slate';
  return 'slate';
}
