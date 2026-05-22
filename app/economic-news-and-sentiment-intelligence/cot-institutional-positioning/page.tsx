'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarClock,
  Database,
  Download,
  Filter,
  Menu,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, PieChart, Pie, Cell, Legend } from 'recharts';
import { TraderSidebar } from '@/components/trader-sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type Tone = 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'slate';

type CotPosition = {
  report_date: string;
  currency: string;
  long_positions: number | null;
  short_positions: number | null;
  change_long: number | null;
  change_short: number | null;
  percent_change: number | null;
  net_positions: number | null;
  bias: string | null;
  net_change: number | null;
  market_name: string | null;
  cftc_market_code: string | null;
  exchange: string | null;
  source_year: number | null;
  created_at: string;
  updated_at: string;
};

type SummaryPayload = {
  ok: boolean;
  generatedAt: string;
  summary: {
    latestCotReportDate: string | null;
    strongestBullishCurrency: string | null;
    strongestBearishCurrency: string | null;
    largestLongIncrease: { currency: string; value: number } | null;
    largestShortIncrease: { currency: string; value: number } | null;
    biggestNetPositionChange: { currency: string; value: number } | null;
    totalRecordsSynced: number;
    lastSyncStatus: string;
    lastSyncAt: string | null;
  };
};

type PositionsPayload = {
  ok: boolean;
  generatedAt: string;
  total: number;
  limit: number;
  offset: number;
  records: CotPosition[];
};

type CotLog = {
  id: string;
  job_type: string;
  status: string;
  message: string | null;
  source_url: string | null;
  source_year: number | null;
  fetched_at: string;
};

const currencies = ['All', 'USD Index', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
const biases = ['All', 'Strong Bullish', 'Bullish but weakening', 'Strong Bearish', 'Bearish but improving', 'Neutral'];
const dateRanges = ['Last 3 Months', 'Last 6 Months', 'Last 12 Months', 'Last 2 Years', 'All'];

function formatNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)}%`;
}

function biasTone(bias: string | null): Tone {
  const value = String(bias ?? '');
  if (value.includes('Bullish')) return value.includes('Strong') ? 'emerald' : 'cyan';
  if (value.includes('Bearish')) return value.includes('Strong') ? 'rose' : 'amber';
  if (value === 'Neutral') return 'amber';
  return 'slate';
}

function toneClass(tone: Tone): string {
  const map: Record<Tone, string> = {
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    amber: 'text-amber-700 bg-amber-50 border-amber-200',
    rose: 'text-rose-700 bg-rose-50 border-rose-200',
    cyan: 'text-cyan-700 bg-cyan-50 border-cyan-200',
    violet: 'text-violet-700 bg-violet-50 border-violet-200',
    slate: 'text-slate-700 bg-slate-50 border-slate-200',
  };
  return map[tone];
}

function buildDateRange(range: string): { from: string | null; to: string | null } {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime());
  if (range === 'Last 3 Months') from.setUTCMonth(from.getUTCMonth() - 3);
  else if (range === 'Last 6 Months') from.setUTCMonth(from.getUTCMonth() - 6);
  else if (range === 'Last 12 Months') from.setUTCFullYear(from.getUTCFullYear() - 1);
  else if (range === 'Last 2 Years') from.setUTCFullYear(from.getUTCFullYear() - 2);
  else return { from: null, to: null };
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { from: fmt(from), to: fmt(to) };
}

export default function CotInstitutionalPositioningPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [positions, setPositions] = useState<PositionsPayload | null>(null);
  const [logs, setLogs] = useState<CotLog[]>([]);
  const [loading, setLoading] = useState({ summary: false, positions: false, action: false, logs: false });
  const [toast, setToast] = useState<{ tone: Tone; message: string } | null>(null);
  const [filters, setFilters] = useState({
    dateRange: 'Last 2 Years',
    from: '',
    to: '',
    currency: 'All',
    bias: 'All',
    reportYear: 'All',
    search: '',
  });

  const showToast = (tone: Tone, message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 5000);
  };

  const refreshSummary = async () => {
    setLoading((s) => ({ ...s, summary: true }));
    try {
      const response = await fetch('/api/cot/summary', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? `Summary failed with HTTP ${response.status}`);
      if (payload?.ok !== true) {
        setSummary(null);
        showToast('amber', payload?.error ?? 'COT summary not available.');
        return;
      }
      setSummary(payload as SummaryPayload);
    } catch (err) {
      showToast('rose', err instanceof Error ? err.message : 'Unable to load summary.');
    } finally {
      setLoading((s) => ({ ...s, summary: false }));
    }
  };

  const refreshLogs = async () => {
    setLoading((s) => ({ ...s, logs: true }));
    try {
      const response = await fetch('/api/cot/logs?limit=200', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? `Logs failed with HTTP ${response.status}`);
      if (payload?.ok !== true) {
        setLogs([]);
        showToast('amber', payload?.error ?? 'COT logs not available.');
        return;
      }
      setLogs(Array.isArray(payload?.logs) ? payload.logs : []);
    } catch (err) {
      showToast('rose', err instanceof Error ? err.message : 'Unable to load logs.');
    } finally {
      setLoading((s) => ({ ...s, logs: false }));
    }
  };

  const refreshPositions = async () => {
    setLoading((s) => ({ ...s, positions: true }));
    try {
      const url = new URL('/api/cot/positions', window.location.origin);
      const range = buildDateRange(filters.dateRange);
      const from = filters.from || range.from;
      const to = filters.to || range.to;
      if (from) url.searchParams.set('from', from);
      if (to) url.searchParams.set('to', to);
      if (filters.currency !== 'All') url.searchParams.set('currency', filters.currency);
      if (filters.bias !== 'All') url.searchParams.set('bias', filters.bias);
      if (filters.reportYear !== 'All') url.searchParams.set('year', filters.reportYear);
      if (filters.search.trim()) url.searchParams.set('search', filters.search.trim());
      url.searchParams.set('limit', '800');
      const response = await fetch(url.toString(), { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? `Positions failed with HTTP ${response.status}`);
      if (payload?.ok !== true) {
        setPositions(null);
        showToast('amber', payload?.error ?? 'COT positions not available.');
        return;
      }
      setPositions(payload as PositionsPayload);
    } catch (err) {
      showToast('rose', err instanceof Error ? err.message : 'Unable to load positions.');
    } finally {
      setLoading((s) => ({ ...s, positions: false }));
    }
  };

  useEffect(() => {
    refreshSummary();
    refreshPositions();
    refreshLogs();
  }, []);

  const reportYears = useMemo(() => {
    const set = new Set<number>();
    for (const row of positions?.records ?? []) {
      const year = row.source_year;
      if (typeof year === 'number' && Number.isFinite(year)) set.add(year);
    }
    return ['All', ...Array.from(set.values()).sort((a, b) => b - a).map(String)];
  }, [positions?.records]);

  const rows = useMemo(() => positions?.records ?? [], [positions?.records]);

  const charts = useMemo(() => {
    const byDate = new Map<string, any>();
    const currenciesInData = Array.from(new Set(rows.map((r) => r.currency))).filter(Boolean);
    for (const row of [...rows].reverse()) {
      const dateKey = String(row.report_date).slice(0, 10);
      const existing = byDate.get(dateKey) ?? { date: dateKey };
      existing[row.currency] = row.net_positions ?? null;
      byDate.set(dateKey, existing);
    }
    const netTrend = Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-60);

    const selected = filters.currency !== 'All' ? filters.currency : (currenciesInData[0] ?? 'EUR');
    const longShort = [...rows]
      .filter((r) => r.currency === selected)
      .map((r) => ({
        date: String(r.report_date).slice(0, 10),
        long: r.long_positions ?? null,
        short: r.short_positions ?? null,
        netChange: r.net_change ?? null,
        bias: r.bias ?? '',
      }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(-60);

    const biasBuckets = (() => {
      const map = new Map<string, number>();
      for (const row of rows) {
        const key = String(row.bias ?? 'Unknown');
        map.set(key, (map.get(key) ?? 0) + 1);
      }
      return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    })();

    const ranking = (() => {
      const latest = summary?.summary.latestCotReportDate ? String(summary.summary.latestCotReportDate).slice(0, 10) : null;
      const latestRows = latest ? rows.filter((r) => String(r.report_date).slice(0, 10) === latest) : [];
      return latestRows
        .map((r) => ({ currency: r.currency, strength: Math.abs(Number(r.net_positions ?? 0)), net: Number(r.net_positions ?? 0) }))
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 8);
    })();

    return { netTrend, currenciesInData, longShort, biasBuckets, ranking, selected };
  }, [filters.currency, rows, summary?.summary.latestCotReportDate]);

  const onAction = async (path: string, label: string) => {
    setLoading((s) => ({ ...s, action: true }));
    try {
      const response = await fetch(path, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? `${label} failed with HTTP ${response.status}`);
      showToast(payload?.ok ? 'emerald' : 'amber', payload?.message ?? `${label} requested.`);
      await refreshSummary();
      await refreshPositions();
      await refreshLogs();
    } catch (err) {
      showToast('rose', err instanceof Error ? err.message : `${label} failed.`);
    } finally {
      setLoading((s) => ({ ...s, action: false }));
    }
  };

  const onExport = async () => {
    const url = new URL('/api/cot/export', window.location.origin);
    const range = buildDateRange(filters.dateRange);
    const from = filters.from || range.from;
    const to = filters.to || range.to;
    if (from) url.searchParams.set('from', from);
    if (to) url.searchParams.set('to', to);
    if (filters.currency !== 'All') url.searchParams.set('currency', filters.currency);
    if (filters.bias !== 'All') url.searchParams.set('bias', filters.bias);
    if (filters.reportYear !== 'All') url.searchParams.set('year', filters.reportYear);
    if (filters.search.trim()) url.searchParams.set('search', filters.search.trim());
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  };

  const summaryCards = [
    { icon: CalendarClock, label: 'Latest COT Report Date', value: summary?.summary.latestCotReportDate ? String(summary.summary.latestCotReportDate).slice(0, 10) : '—', tone: 'violet' as Tone },
    { icon: TrendingUp, label: 'Strongest Bullish Currency', value: summary?.summary.strongestBullishCurrency ?? '—', tone: 'emerald' as Tone },
    { icon: TrendingDown, label: 'Strongest Bearish Currency', value: summary?.summary.strongestBearishCurrency ?? '—', tone: 'rose' as Tone },
    { icon: Activity, label: 'Largest Long Increase', value: summary?.summary.largestLongIncrease ? `${summary.summary.largestLongIncrease.currency} • ${formatNumber(summary.summary.largestLongIncrease.value)}` : '—', tone: 'cyan' as Tone },
    { icon: Activity, label: 'Largest Short Increase', value: summary?.summary.largestShortIncrease ? `${summary.summary.largestShortIncrease.currency} • ${formatNumber(summary.summary.largestShortIncrease.value)}` : '—', tone: 'amber' as Tone },
    { icon: BarChart3, label: 'Biggest Net Position Change', value: summary?.summary.biggestNetPositionChange ? `${summary.summary.biggestNetPositionChange.currency} • ${formatNumber(summary.summary.biggestNetPositionChange.value)}` : '—', tone: 'violet' as Tone },
    { icon: Database, label: 'Total Records Synced', value: String(summary?.summary.totalRecordsSynced ?? 0), tone: 'slate' as Tone },
    { icon: ShieldAlert, label: 'Last Sync Status', value: summary?.summary.lastSyncStatus ?? '—', tone: 'slate' as Tone },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-900">
      <TraderSidebar bridgeOnline={false} mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />

      <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="Open navigation"
              className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-900 lg:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">COT & Institutional Positioning</h1>
              <p className="text-xs font-mono uppercase tracking-wider text-indigo-900">CFTC Commitments of Traders • Futures Only • Institutional bias dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={loading.summary || loading.positions} onClick={() => { refreshSummary(); refreshPositions(); refreshLogs(); }}>
              <RefreshCw className={cn('mr-2 h-4 w-4', (loading.summary || loading.positions) && 'animate-spin')} />
              Refresh
            </Button>
            <Button size="sm" variant="secondary" onClick={onExport}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50">
          <main className="space-y-5 p-4 md:p-6 lg:p-8">
            {toast ? (
              <div className={cn('rounded-lg border p-3 text-sm', toneClass(toast.tone))}>
                {toast.message}
              </div>
            ) : null}

            <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map((card) => (
                <Card key={card.label} className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                  <CardHeader className="border-b border-slate-200 py-3">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2 text-slate-800">
                      <card.icon className={cn('h-4 w-4', card.tone === 'violet' ? 'text-violet-700' : card.tone === 'emerald' ? 'text-emerald-700' : card.tone === 'rose' ? 'text-rose-700' : card.tone === 'amber' ? 'text-amber-700' : card.tone === 'cyan' ? 'text-cyan-700' : 'text-slate-700')} />
                      {card.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="text-sm font-mono text-slate-900">{card.value}</div>
                    {card.label === 'Last Sync Status' && summary?.summary.lastSyncAt ? (
                      <div className="mt-1 text-[11px] font-mono text-slate-500">at {new Date(summary.summary.lastSyncAt).toLocaleString()}</div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </section>

            <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
              <CardHeader className="border-b border-slate-200 py-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Filter className="w-4 h-4 text-indigo-900" /> Filters & Controls
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <select
                    className="md:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                    value={filters.dateRange}
                    onChange={(e) => setFilters((c) => ({ ...c, dateRange: e.target.value, from: '', to: '' }))}
                  >
                    {dateRanges.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <input
                    className="md:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                    placeholder="From (YYYY-MM-DD)"
                    value={filters.from}
                    onChange={(e) => setFilters((c) => ({ ...c, from: e.target.value }))}
                  />
                  <input
                    className="md:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                    placeholder="To (YYYY-MM-DD)"
                    value={filters.to}
                    onChange={(e) => setFilters((c) => ({ ...c, to: e.target.value }))}
                  />
                  <select
                    className="md:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                    value={filters.currency}
                    onChange={(e) => setFilters((c) => ({ ...c, currency: e.target.value }))}
                  >
                    {currencies.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select
                    className="md:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                    value={filters.bias}
                    onChange={(e) => setFilters((c) => ({ ...c, bias: e.target.value }))}
                  >
                    {biases.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select
                    className="md:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                    value={filters.reportYear}
                    onChange={(e) => setFilters((c) => ({ ...c, reportYear: e.target.value }))}
                  >
                    {reportYears.map((item) => <option key={item} value={item}>{item === 'All' ? 'All Years' : item}</option>)}
                  </select>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                      <input
                        className="h-9 w-[300px] max-w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 font-mono text-xs"
                        placeholder="Search market name…"
                        value={filters.search}
                        onChange={(e) => setFilters((c) => ({ ...c, search: e.target.value }))}
                      />
                    </div>
                    <Button size="sm" variant="secondary" disabled={loading.positions} onClick={refreshPositions}>
                      Apply
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" disabled={loading.action} onClick={() => onAction('/api/cot/sync-last-2-years', 'Sync last 2 years')}>
                      Sync Last 2 Years
                    </Button>
                    <Button size="sm" variant="secondary" disabled={loading.action} onClick={() => onAction('/api/cot/sync-current-year', 'Sync current year')}>
                      Sync Current Year
                    </Button>
                    <Button size="sm" variant="secondary" disabled={loading.action} onClick={() => onAction('/api/cot/sync-previous-year', 'Sync previous year')}>
                      Sync Previous Year
                    </Button>
                    <Button size="sm" variant="secondary" disabled={loading.action} onClick={() => onAction('/api/cot/sync-latest', 'Sync latest')}>
                      Sync Latest
                    </Button>
                    <Button size="sm" variant="secondary" disabled={loading.logs} onClick={refreshLogs}>
                      View Source Logs
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="dashboard">
              <TabsList className="grid w-full grid-cols-2 bg-white border border-slate-200">
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                <TabsTrigger value="logs">Logs</TabsTrigger>
              </TabsList>

              <TabsContent value="dashboard" className="space-y-5">
                <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                    <CardHeader className="border-b border-slate-200 py-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900">
                        <BarChart3 className="h-4 w-4 text-violet-700" /> Net Positions Trend by Currency
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="h-[260px] w-full min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={charts.netTrend}>
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            {charts.currenciesInData.slice(0, 8).map((c, index) => (
                              <Line key={c} type="monotone" dataKey={c} stroke={['#4f46e5', '#0891b2', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#6366f1', '#a855f7'][index % 8]} dot={false} strokeWidth={2} />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-2 text-[11px] font-mono text-slate-500">Last 60 points in current filter range.</div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                    <CardHeader className="border-b border-slate-200 py-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900">
                        <TrendingUp className="h-4 w-4 text-indigo-700" /> Long vs Short Trend ({charts.selected})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="h-[260px] w-full min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={charts.longShort}>
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Line type="monotone" dataKey="long" stroke="#10b981" dot={false} strokeWidth={2} />
                            <Line type="monotone" dataKey="short" stroke="#ef4444" dot={false} strokeWidth={2} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-2 text-[11px] font-mono text-slate-500">Select a currency in filters to change this chart.</div>
                    </CardContent>
                  </Card>
                </section>

                <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                    <CardHeader className="border-b border-slate-200 py-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Activity className="h-4 w-4 text-cyan-700" /> Weekly Net Change ({charts.selected})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="h-[220px] w-full min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={charts.longShort.slice(-24)}>
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Bar dataKey="netChange" fill="#6366f1" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                    <CardHeader className="border-b border-slate-200 py-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-amber-700" /> Bias Distribution
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="h-[220px] w-full min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={charts.biasBuckets.slice(0, 8)} dataKey="value" nameKey="name" outerRadius={80}>
                              {charts.biasBuckets.slice(0, 8).map((item, index) => (
                                <Cell key={item.name} fill={['#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#a855f7', '#64748b', '#1d4ed8', '#14b8a6'][index % 8]} />
                              ))}
                            </Pie>
                            <Tooltip />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                    <CardHeader className="border-b border-slate-200 py-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-violet-700" /> Institutional Strength Ranking
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="space-y-2">
                        {charts.ranking.length ? charts.ranking.map((item) => (
                          <div key={item.currency} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                            <div className="font-mono text-xs font-semibold text-slate-900">{item.currency}</div>
                            <div className="flex items-center gap-2">
                              <div className={cn('rounded-md border px-2 py-0.5 text-[11px] font-mono', toneClass(item.net >= 0 ? 'emerald' : 'rose'))}>
                                net {formatNumber(item.net)}
                              </div>
                              <div className="font-mono text-[11px] text-slate-500">strength {formatNumber(item.strength)}</div>
                            </div>
                          </div>
                        )) : <div className="text-xs text-slate-500">No ranking data yet.</div>}
                      </div>
                    </CardContent>
                  </Card>
                </section>

                <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                  <CardHeader className="border-b border-slate-200 py-4">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Database className="h-4 w-4 text-slate-700" /> COT Futures Only Records
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[520px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-slate-200 bg-slate-900 hover:bg-slate-900">
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Date</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Currency</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Long</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Short</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Change Long</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Change Short</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">%Change</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Net Positions</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Bias</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {!rows.length ? (
                            <TableRow className="border-slate-100 hover:bg-transparent">
                              <TableCell colSpan={9} className="h-48 text-center text-sm text-slate-500">
                                No COT records yet. Use “Sync Last 2 Years”.
                              </TableCell>
                            </TableRow>
                          ) : rows.map((row) => (
                            <TableRow key={`${String(row.report_date).slice(0, 10)}-${row.currency}`} className="border-slate-100 hover:bg-slate-50">
                              <TableCell className="font-mono text-xs text-slate-700">{String(row.report_date).slice(0, 10)}</TableCell>
                              <TableCell className="font-mono text-xs font-semibold text-slate-900">{row.currency}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-700">{formatNumber(row.long_positions)}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-700">{formatNumber(row.short_positions)}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-700">{formatNumber(row.change_long)}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-700">{formatNumber(row.change_short)}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-700">{formatPercent(row.percent_change)}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-700">{formatNumber(row.net_positions)}</TableCell>
                              <TableCell>
                                <Badge className={cn('border', toneClass(biasTone(row.bias)))}>{row.bias ?? 'N/A'}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="logs">
                <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                  <CardHeader className="border-b border-slate-200 py-4">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Database className="h-4 w-4 text-slate-700" /> Source Logs
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[560px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-slate-200 bg-slate-900 hover:bg-slate-900">
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Time</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Job</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Status</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Message</TableHead>
                            <TableHead className="text-white font-mono text-[11px] uppercase tracking-wider">Year</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {!logs.length ? (
                            <TableRow className="border-slate-100 hover:bg-transparent">
                              <TableCell colSpan={5} className="h-48 text-center text-sm text-slate-500">
                                No logs yet.
                              </TableCell>
                            </TableRow>
                          ) : logs.map((log) => (
                            <TableRow key={String(log.id)} className="border-slate-100 hover:bg-slate-50">
                              <TableCell className="font-mono text-xs text-slate-700">{new Date(log.fetched_at).toLocaleString()}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-700">{log.job_type}</TableCell>
                              <TableCell>
                                <Badge className={cn('border', toneClass(String(log.status).toLowerCase() === 'success' ? 'emerald' : String(log.status).toLowerCase() === 'error' ? 'rose' : 'amber'))}>
                                  {String(log.status).toUpperCase()}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-slate-700">{log.message ?? ''}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-700">{log.source_year ?? ''}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </div>
    </div>
  );
}
