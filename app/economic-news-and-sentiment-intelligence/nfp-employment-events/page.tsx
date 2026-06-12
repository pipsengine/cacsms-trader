'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BarChart3, CalendarClock, Loader2, Menu, RefreshCw, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DashboardPageFrame } from '@/components/dashboard-page-frame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type EmploymentKind =
  | 'nfp'
  | 'unemployment_rate'
  | 'avg_hourly_earnings'
  | 'jobless_claims'
  | 'employment_change'
  | 'adp'
  | 'unknown';

type Tone = 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'slate';

type EmploymentEvent = {
  id: string;
  event_name: string;
  normalized_event_name: string;
  country: string;
  currency: string;
  impact_level: string;
  event_date: string;
  event_time: string | null;
  utc_event_time: string | null;
  actual_value: string | null;
  forecast_value: string | null;
  previous_value: string | null;
  revised_previous_value: string | null;
  surprise_value: number | null;
  surprise_direction: string | null;
  status: string;
  source_url: string | null;
  updated_at: string;
  kind: EmploymentKind;
  released: boolean;
};

type DashboardPayload = {
  ok: boolean;
  generatedAt: string;
  error?: string;
  universe?: { currencies: string[]; kinds: string[] };
  summary?: {
    total: number;
    upcoming: number;
    released: number;
    upcomingByCurrency: Record<string, number>;
    lastReleaseByCurrency: Record<string, { eventDate: string; actualValue: string | null; forecastValue: string | null; previousValue: string | null; eventName: string }>;
  };
  upcoming: EmploymentEvent[];
  recent: EmploymentEvent[];
};

type SeriesPoint = {
  id: string;
  currency: string;
  country: string;
  eventName: string;
  kind: EmploymentKind;
  eventDate: string;
  eventTime: string | null;
  utcEventTime: string | null;
  actualValue: string | null;
  forecastValue: string | null;
  previousValue: string | null;
  impactLevel: string;
  status: string;
  sourceUrl: string | null;
  updatedAt: string;
};

type SeriesPayload = {
  ok: boolean;
  generatedAt: string;
  error?: string;
  currency: string;
  kind: EmploymentKind | null;
  from: string;
  to: string;
  series: SeriesPoint[];
};

function ToneBadge(props: { tone: Tone; children: ReactNode }) {
  const cls =
    props.tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : props.tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : props.tone === 'rose'
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : props.tone === 'cyan'
            ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
            : props.tone === 'violet'
              ? 'border-violet-200 bg-violet-50 text-violet-700'
              : 'border-slate-200 bg-slate-50 text-slate-700';
  return <Badge className={cn('border text-[10px] font-semibold', cls)}>{props.children}</Badge>;
}

async function readJson<T>(response: Response): Promise<T> {
  const status = response.status;
  const text = await response.text().catch(() => '');
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`Empty response body (HTTP ${status}).`);
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`Non-JSON response (HTTP ${status}): ${trimmed.slice(0, 240)}`);
  }
}

function parseMagnitude(value: string | null | undefined): number | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const hasPercent = raw.includes('%');
  const m = raw.match(/([-+]?\d[\d,]*\.?\d*)\s*([KMB])?/i);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const suffix = String(m[2] ?? '').toUpperCase();
  const mult = suffix === 'B' ? 1_000_000_000 : suffix === 'M' ? 1_000_000 : suffix === 'K' ? 1_000 : 1;
  const scaled = n * mult;
  if (hasPercent) return n;
  return scaled;
}

function fmtValue(value: string | null | undefined): string {
  const s = String(value ?? '').trim();
  return s ? s : '—';
}

function fmtNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

function fmtSurprise(n: number | null | undefined, kind: EmploymentKind): string {
  if (n == null) return '—';
  if (kind === 'unemployment_rate') return `${n.toFixed(2)}%`;
  return fmtNumber(n);
}

function toneForImpact(level: string): Tone {
  const s = String(level ?? '').toLowerCase();
  if (s === 'critical') return 'rose';
  if (s === 'high') return 'amber';
  if (s === 'medium') return 'cyan';
  return 'slate';
}

function labelForKind(kind: EmploymentKind): string {
  if (kind === 'nfp') return 'NFP';
  if (kind === 'unemployment_rate') return 'Unemployment Rate';
  if (kind === 'avg_hourly_earnings') return 'Avg Hourly Earnings';
  if (kind === 'jobless_claims') return 'Jobless Claims';
  if (kind === 'employment_change') return 'Employment Change';
  if (kind === 'adp') return 'ADP Employment';
  return 'Other';
}

const majorCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'] as const;
const kindButtons: EmploymentKind[] = ['nfp', 'unemployment_rate', 'avg_hourly_earnings', 'jobless_claims', 'employment_change', 'adp'];

export default function NfpEmploymentEventsPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [series, setSeries] = useState<SeriesPayload | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [selectedKind, setSelectedKind] = useState<EmploymentKind>('nfp');
  const [activeTab, setActiveTab] = useState<'overview' | 'upcoming' | 'recent'>('overview');
  const [loading, setLoading] = useState({ dashboard: true, series: true });
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async () => {
    setLoading((s) => ({ ...s, dashboard: true }));
    setError(null);
    try {
      const res = await fetch('/api/economic-calendar/nfp-employment', { cache: 'no-store' });
      const payload = await readJson<DashboardPayload>(res);
      setDashboard(payload);
      if (!payload.ok) setError(payload.error ?? 'Failed to load employment events.');
    } catch (e) {
      setDashboard(null);
      setError(e instanceof Error ? e.message : 'Failed to load employment events.');
    } finally {
      setLoading((s) => ({ ...s, dashboard: false }));
    }
  };

  const loadSeries = async (currency: string, kind: EmploymentKind) => {
    setLoading((s) => ({ ...s, series: true }));
    setError(null);
    try {
      const url = `/api/economic-calendar/nfp-employment?view=series&currency=${encodeURIComponent(currency)}&kind=${encodeURIComponent(kind)}`;
      const res = await fetch(url, { cache: 'no-store' });
      const payload = await readJson<SeriesPayload>(res);
      setSeries(payload);
      if (!payload.ok) setError(payload.error ?? 'Failed to load employment history.');
    } catch (e) {
      setSeries(null);
      setError(e instanceof Error ? e.message : 'Failed to load employment history.');
    } finally {
      setLoading((s) => ({ ...s, series: false }));
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    void loadSeries(selectedCurrency, selectedKind);
  }, [selectedCurrency, selectedKind]);

  const currencyCards = useMemo(() => {
    const summary = dashboard?.summary;
    return majorCurrencies.map((currency) => {
      const upcomingCount = summary?.upcomingByCurrency?.[currency] ?? 0;
      const last = summary?.lastReleaseByCurrency?.[currency] ?? null;
      return {
        currency,
        upcomingCount,
        lastDate: last?.eventDate ?? null,
        lastActual: last?.actualValue ?? null,
        lastForecast: last?.forecastValue ?? null,
      };
    });
  }, [dashboard?.summary]);

  const chartData = useMemo(() => {
    const rows = (series?.series ?? []).map((p) => {
      const actual = parseMagnitude(p.actualValue);
      const forecast = parseMagnitude(p.forecastValue);
      const previous = parseMagnitude(p.previousValue);
      const surprise = actual == null || forecast == null ? null : actual - forecast;
      return { date: p.eventDate, actual, forecast, previous, surprise };
    });
    return rows.filter((r) => r.actual != null || r.forecast != null || r.previous != null);
  }, [series?.series]);

  const headline = useMemo(() => {
    const total = dashboard?.summary?.total ?? 0;
    const upcoming = dashboard?.summary?.upcoming ?? 0;
    const released = dashboard?.summary?.released ?? 0;
    return { total, upcoming, released };
  }, [dashboard?.summary]);

  return (
    <DashboardPageFrame
      bridgeOnline={false}
      mobileOpen={mobileSidebarOpen}
      onMobileOpenChange={setMobileSidebarOpen}
      className="macro-light flex min-w-0 flex-1 flex-col bg-white text-slate-900 font-sans"
    >
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="Open navigation"
              className="grid h-10 w-10 place-items-center rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-700 lg:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">NFP / Employment Events</h1>
              <p className="text-xs font-mono uppercase tracking-wider text-indigo-700">DB-first employment releases from the internal economic calendar</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void loadDashboard()} disabled={loading.dashboard}>
              {loading.dashboard ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-white">
          <main className="space-y-5 p-4 md:p-6 lg:p-8">
            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
            ) : null}

            <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Card className="border-slate-200 bg-violet-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <Users className="h-4 w-4 text-violet-700" /> Employment Universe
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${headline.total} events in window`}</div>
                </CardHeader>
              </Card>

              <Card className="border-slate-200 bg-cyan-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <CalendarClock className="h-4 w-4 text-cyan-700" /> Upcoming
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${headline.upcoming} scheduled`}</div>
                </CardHeader>
              </Card>

              <Card className="border-slate-200 bg-emerald-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <TrendingUp className="h-4 w-4 text-emerald-700" /> Recent Releases
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${headline.released} recent rows`}</div>
                </CardHeader>
              </Card>

              <Card className="border-slate-200 bg-slate-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <BarChart3 className="h-4 w-4 text-slate-700" /> View
                  </CardTitle>
                  <div className="text-xs text-slate-600">{labelForKind(selectedKind)} · {selectedCurrency}</div>
                </CardHeader>
              </Card>
            </section>

            <section className="grid grid-cols-1 gap-4">
              <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <CardHeader className="border-b border-slate-200">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Major Currencies</div>
                      <div className="mt-1 text-xs text-slate-500">Select a currency to view its employment-release history.</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {kindButtons.map((k) => (
                        <Button key={k} type="button" size="sm" variant={selectedKind === k ? 'default' : 'outline'} onClick={() => setSelectedKind(k)}>
                          {labelForKind(k)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
                    {currencyCards.map((c) => {
                      const active = selectedCurrency === c.currency;
                      return (
                        <button
                          key={c.currency}
                          type="button"
                          onClick={() => setSelectedCurrency(c.currency)}
                          className={cn(
                            'rounded-xl border px-3 py-3 text-left shadow-sm transition',
                            active ? 'border-indigo-300 bg-indigo-50 shadow-indigo-900/10' : 'border-slate-200 bg-white hover:bg-slate-50',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-mono text-xs font-semibold text-slate-900">{c.currency}</div>
                            <ToneBadge tone={c.upcomingCount > 0 ? 'cyan' : 'slate'}>{c.upcomingCount} due</ToneBadge>
                          </div>
                          <div className="mt-2 text-[11px] text-slate-600">Last actual</div>
                          <div className="font-mono text-xs text-slate-900">{fmtValue(c.lastActual)}</div>
                          <div className="mt-1 text-[11px] text-slate-600">Forecast</div>
                          <div className="font-mono text-xs text-slate-700">{fmtValue(c.lastForecast)}</div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <CardHeader className="border-b border-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Employment History</div>
                      <div className="mt-1 text-xs text-slate-500">{selectedCurrency} · {labelForKind(selectedKind)}</div>
                    </div>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => void loadSeries(selectedCurrency, selectedKind)} disabled={loading.series}>
                      {loading.series ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  {loading.series ? (
                    <div className="flex h-[260px] items-center justify-center text-sm text-slate-600">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading history…
                    </div>
                  ) : chartData.length === 0 ? (
                    <div className="flex h-[260px] items-center justify-center text-sm text-slate-600">
                      No released employment rows yet for {selectedCurrency}.
                    </div>
                  ) : (
                    <div className="h-[260px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={18} />
                          <YAxis tick={{ fontSize: 10 }} width={56} />
                          <Tooltip
                            formatter={(value: any, name: any) => {
                              const n = typeof value === 'number' ? value : null;
                              const label = String(name);
                              if (n == null) return [value, label];
                              if (selectedKind === 'unemployment_rate') return [`${n.toFixed(2)}%`, label];
                              return [fmtNumber(n), label];
                            }}
                          />
                          <Line type="monotone" dataKey="actual" stroke="#4f46e5" strokeWidth={2} dot={false} name="Actual" />
                          <Line type="monotone" dataKey="forecast" stroke="#0ea5e9" strokeWidth={2} dot={false} name="Forecast" />
                          <Line type="monotone" dataKey="previous" stroke="#64748b" strokeWidth={1.5} dot={false} name="Previous" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <CardHeader className="border-b border-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Event Stream</div>
                      <div className="mt-1 text-xs text-slate-500">Upcoming and released employment events from the stored calendar.</div>
                    </div>
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-auto">
                      <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                        <TabsTrigger value="recent">Recent</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                    <TabsContent value="overview" className="m-0 p-4 space-y-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        This page is powered by the internal Economic Calendar tables. If the list is empty, open Economic Calendar Overview and run Discover Upcoming Events.
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold text-slate-600">Upcoming next 90 days</div>
                          <div className="mt-1 text-2xl font-semibold text-slate-950">{headline.upcoming}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold text-slate-600">Recent releases</div>
                          <div className="mt-1 text-2xl font-semibold text-slate-950">{headline.released}</div>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="upcoming" className="m-0">
                      <div className="w-full overflow-x-auto">
                        <Table>
                          <TableHeader className="bg-slate-50">
                            <TableRow className="hover:bg-transparent">
                              {['Date', 'Time', 'Country', 'CCY', 'Event', 'Impact', 'Status'].map((h) => (
                                <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                                  {h}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {loading.dashboard ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={7} className="h-20 text-center text-sm text-slate-600">
                                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                                </TableCell>
                              </TableRow>
                            ) : (dashboard?.upcoming ?? []).length === 0 ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={7} className="h-20 text-center text-sm text-slate-600">
                                  No upcoming employment events found in the current window.
                                </TableCell>
                              </TableRow>
                            ) : (
                              (dashboard?.upcoming ?? []).map((row) => (
                                <TableRow key={row.id} className="hover:bg-slate-50">
                                  <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.event_date}</TableCell>
                                  <TableCell className="px-3 py-2 font-mono text-xs text-slate-700">{row.event_time ?? '—'}</TableCell>
                                  <TableCell className="px-3 py-2 text-xs text-slate-700">{row.country}</TableCell>
                                  <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.currency}</TableCell>
                                  <TableCell className="px-3 py-2 text-xs text-slate-700">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate">{row.event_name}</span>
                                      <ToneBadge tone="violet">{labelForKind(row.kind)}</ToneBadge>
                                    </div>
                                  </TableCell>
                                  <TableCell className="px-3 py-2">
                                    <ToneBadge tone={toneForImpact(row.impact_level)}>{row.impact_level}</ToneBadge>
                                  </TableCell>
                                  <TableCell className="px-3 py-2">
                                    <ToneBadge tone="cyan">{row.status}</ToneBadge>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </TabsContent>

                    <TabsContent value="recent" className="m-0">
                      <div className="w-full overflow-x-auto">
                        <Table>
                          <TableHeader className="bg-slate-50">
                            <TableRow className="hover:bg-transparent">
                              {['Date', 'CCY', 'Event', 'Actual', 'Forecast', 'Previous', 'Surprise', 'Impact', 'Source'].map((h) => (
                                <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                                  {h}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {loading.dashboard ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={9} className="h-20 text-center text-sm text-slate-600">
                                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                                </TableCell>
                              </TableRow>
                            ) : (dashboard?.recent ?? []).length === 0 ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={9} className="h-20 text-center text-sm text-slate-600">
                                  No released employment rows found in the current window.
                                </TableCell>
                              </TableRow>
                            ) : (
                              (dashboard?.recent ?? []).map((row) => {
                                const actual = parseMagnitude(row.actual_value);
                                const forecast = parseMagnitude(row.forecast_value);
                                const surprise = actual == null || forecast == null ? null : actual - forecast;
                                const surpriseTone: Tone = surprise == null ? 'slate' : surprise > 0 ? 'emerald' : surprise < 0 ? 'rose' : 'slate';
                                return (
                                  <TableRow key={row.id} className="hover:bg-slate-50">
                                    <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.event_date}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.currency}</TableCell>
                                    <TableCell className="px-3 py-2 text-xs text-slate-700">
                                      <div className="flex items-center gap-2">
                                        <span className="truncate">{row.event_name}</span>
                                        <ToneBadge tone="violet">{labelForKind(row.kind)}</ToneBadge>
                                      </div>
                                    </TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs">{fmtValue(row.actual_value)}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs text-slate-600">{fmtValue(row.forecast_value)}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs text-slate-600">{fmtValue(row.revised_previous_value ?? row.previous_value)}</TableCell>
                                    <TableCell className="px-3 py-2">
                                      {surprise == null ? (
                                        <ToneBadge tone="slate">—</ToneBadge>
                                      ) : (
                                        <ToneBadge tone={surpriseTone}>{fmtSurprise(surprise, row.kind)}</ToneBadge>
                                      )}
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                      <ToneBadge tone={toneForImpact(row.impact_level)}>{row.impact_level}</ToneBadge>
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                      {row.source_url ? (
                                        <a className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline" href={row.source_url} target="_blank" rel="noreferrer">
                                          {surprise != null && surprise < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />} Investing
                                        </a>
                                      ) : (
                                        <span className="text-xs text-slate-500">—</span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </section>
          </main>
        </div>
    </DashboardPageFrame>
  );
}

