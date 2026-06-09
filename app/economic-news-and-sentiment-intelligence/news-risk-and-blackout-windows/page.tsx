'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarClock, Loader2, Menu, RefreshCw, ShieldAlert, Timer, TrendingDown, TrendingUp } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TraderSidebar } from '@/components/trader-sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type Tone = 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'slate';
type WindowKey = '24h' | '7d' | '30d' | '90d';
type StatusKey = 'all' | 'active' | 'upcoming' | 'recent';

type NewsRiskEvent = {
  id: string;
  event_name: string;
  normalized_event_name: string;
  country: string;
  currency: string;
  impact_level: string;
  event_date: string;
  event_time: string | null;
  utc_event_time: string | null;
  trade_restriction_required: boolean;
  restriction_start_time: string | null;
  restriction_end_time: string | null;
  status: string;
  source_url: string | null;
  affected_pairs: unknown;
  updated_at: string;
  window_start: string | null;
  window_end: string | null;
  window_status: 'active' | 'upcoming' | 'recent' | 'unknown';
};

type DashboardPayload = {
  ok: boolean;
  generatedAt: string;
  error?: string;
  filters?: { window: WindowKey; fromDate: string; toDate: string; currencies: string[]; status: StatusKey };
  universe?: { currencies: string[] };
  summary?: {
    total: number;
    activeNow: number;
    upcoming: number;
    upcomingNext24h: number;
    endedRecently: number;
    criticalUpcoming: number;
    byCurrency: Record<string, { active: number; upcoming: number; recent: number; criticalUpcoming: number }>;
  };
  active: NewsRiskEvent[];
  upcoming: NewsRiskEvent[];
  recent: NewsRiskEvent[];
};

type TimelinePoint = { date: string; active: number; upcoming: number; ended: number; critical: number };
type TimelinePayload = { ok: boolean; generatedAt: string; error?: string; days: number; from: string; to: string; points: TimelinePoint[] };

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

function toneForImpact(level: string): Tone {
  const s = String(level ?? '').toLowerCase();
  if (s === 'critical') return 'rose';
  if (s === 'high') return 'amber';
  if (s === 'medium') return 'cyan';
  return 'slate';
}

function fmtIso(value: string | null | undefined): string {
  const ts = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function fmtValue(value: string | null | undefined): string {
  const s = String(value ?? '').trim();
  return s ? s : '—';
}

const majorCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'] as const;
const windowButtons: WindowKey[] = ['24h', '7d', '30d', '90d'];
const statusButtons: Array<{ key: StatusKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active Now' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'recent', label: 'Recently Ended' },
];

export default function NewsRiskAndBlackoutWindowsPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [windowKey, setWindowKey] = useState<WindowKey>('7d');
  const [statusKey, setStatusKey] = useState<StatusKey>('all');
  const [activeTab, setActiveTab] = useState<'overview' | 'active' | 'upcoming' | 'recent'>('overview');
  const [loading, setLoading] = useState({ dashboard: true, timeline: true });
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async () => {
    setLoading((x) => ({ ...x, dashboard: true }));
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('window', windowKey);
      qs.set('status', statusKey);
      if (selectedCurrency) qs.set('currency', selectedCurrency);
      const res = await fetch(`/api/economic-calendar/news-risk?${qs.toString()}`, { cache: 'no-store' });
      const payload = await readJson<DashboardPayload>(res);
      setDashboard(payload);
      if (!payload.ok) setError(payload.error ?? 'Failed to load news risk windows.');
    } catch (e) {
      setDashboard(null);
      setError(e instanceof Error ? e.message : 'Failed to load news risk windows.');
    } finally {
      setLoading((x) => ({ ...x, dashboard: false }));
    }
  };

  const loadTimeline = async () => {
    setLoading((x) => ({ ...x, timeline: true }));
    setError(null);
    try {
      const res = await fetch(`/api/economic-calendar/news-risk?view=timeline&days=45`, { cache: 'no-store' });
      const payload = await readJson<TimelinePayload>(res);
      setTimeline(payload);
      if (!payload.ok) setError(payload.error ?? 'Failed to load blackout timeline.');
    } catch (e) {
      setTimeline(null);
      setError(e instanceof Error ? e.message : 'Failed to load blackout timeline.');
    } finally {
      setLoading((x) => ({ ...x, timeline: false }));
    }
  };

  useEffect(() => {
    void Promise.all([loadDashboard(), loadTimeline()]);
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [windowKey, statusKey, selectedCurrency]);

  const summary = dashboard?.summary ?? null;
  const byCurrency = summary?.byCurrency ?? {};

  const currencyCards = useMemo(() => {
    return majorCurrencies.map((currency) => {
      const stats = byCurrency[currency] ?? { active: 0, upcoming: 0, recent: 0, criticalUpcoming: 0 };
      return { currency, ...stats };
    });
  }, [byCurrency]);

  const chartData = useMemo(() => {
    return (timeline?.points ?? []).map((p) => ({
      date: p.date,
      active: p.active,
      upcoming: p.upcoming,
      ended: p.ended,
      critical: p.critical,
    }));
  }, [timeline?.points]);

  return (
    <div className="macro-light flex h-screen overflow-hidden bg-white text-slate-900 font-sans">
      <TraderSidebar bridgeOnline={false} mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />

      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="Open navigation"
              className="grid h-10 w-10 place-items-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 lg:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">News Risk & Blackout Windows</h1>
              <p className="text-xs font-mono uppercase tracking-wider text-amber-700">Auto blackout windows derived from stored economic events</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void Promise.all([loadDashboard(), loadTimeline()])} disabled={loading.dashboard || loading.timeline}>
              {loading.dashboard || loading.timeline ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-white">
          <main className="space-y-5 p-4 md:p-6 lg:p-8">
            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
            ) : null}

            <section className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <Card className="border-slate-200 bg-amber-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <Timer className="h-4 w-4 text-amber-700" /> Active Now
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${summary?.activeNow ?? 0} active windows`}</div>
                </CardHeader>
              </Card>
              <Card className="border-slate-200 bg-cyan-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <CalendarClock className="h-4 w-4 text-cyan-700" /> Upcoming
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${summary?.upcoming ?? 0} windows`}</div>
                </CardHeader>
              </Card>
              <Card className="border-slate-200 bg-violet-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <ShieldAlert className="h-4 w-4 text-violet-700" /> Next 24H
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${summary?.upcomingNext24h ?? 0} upcoming`}</div>
                </CardHeader>
              </Card>
              <Card className="border-slate-200 bg-rose-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <AlertTriangle className="h-4 w-4 text-rose-700" /> Critical Upcoming
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${summary?.criticalUpcoming ?? 0} critical`}</div>
                </CardHeader>
              </Card>
              <Card className="border-slate-200 bg-slate-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <TrendingUp className="h-4 w-4 text-slate-700" /> Total
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${summary?.total ?? 0} rows`}</div>
                </CardHeader>
              </Card>
            </section>

            <section className="grid grid-cols-1 gap-4">
              <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <CardHeader className="border-b border-slate-200">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Filters</div>
                      <div className="mt-1 text-xs text-slate-500">Window and status apply to blackout windows; select a currency to focus the stream.</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {windowButtons.map((w) => (
                        <Button key={w} type="button" size="sm" variant={windowKey === w ? 'default' : 'outline'} onClick={() => setWindowKey(w)}>
                          {w.toUpperCase()}
                        </Button>
                      ))}
                      <div className="h-8 w-px bg-slate-200" />
                      {statusButtons.map((s) => (
                        <Button key={s.key} type="button" size="sm" variant={statusKey === s.key ? 'default' : 'outline'} onClick={() => setStatusKey(s.key)}>
                          {s.label}
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
                            active ? 'border-amber-300 bg-amber-50 shadow-amber-900/10' : 'border-slate-200 bg-white hover:bg-slate-50',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-mono text-xs font-semibold text-slate-900">{c.currency}</div>
                            <ToneBadge tone={c.criticalUpcoming > 0 ? 'rose' : c.active > 0 ? 'amber' : c.upcoming > 0 ? 'cyan' : 'slate'}>
                              {c.active} / {c.upcoming}
                            </ToneBadge>
                          </div>
                          <div className="mt-2 text-[11px] text-slate-600">Active</div>
                          <div className="font-mono text-xs text-slate-900">{c.active}</div>
                          <div className="mt-1 text-[11px] text-slate-600">Upcoming</div>
                          <div className="font-mono text-xs text-slate-700">{c.upcoming}</div>
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
                      <div className="text-sm font-semibold text-slate-950">Blackout Timeline</div>
                      <div className="mt-1 text-xs text-slate-500">Last 45 days (all currencies).</div>
                    </div>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => void loadTimeline()} disabled={loading.timeline}>
                      {loading.timeline ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  {loading.timeline ? (
                    <div className="flex h-[260px] items-center justify-center text-sm text-slate-600">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading timeline…
                    </div>
                  ) : chartData.length === 0 ? (
                    <div className="flex h-[260px] items-center justify-center text-sm text-slate-600">No timeline rows yet.</div>
                  ) : (
                    <div className="h-[260px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={18} />
                          <YAxis tick={{ fontSize: 10 }} width={36} allowDecimals={false} />
                          <Tooltip />
                          <Line type="monotone" dataKey="active" stroke="#f59e0b" strokeWidth={2} dot={false} name="Active" />
                          <Line type="monotone" dataKey="upcoming" stroke="#0ea5e9" strokeWidth={2} dot={false} name="Upcoming" />
                          <Line type="monotone" dataKey="critical" stroke="#e11d48" strokeWidth={2} dot={false} name="Critical" />
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
                      <div className="text-sm font-semibold text-slate-950">Windows</div>
                      <div className="mt-1 text-xs text-slate-500">Active, upcoming and recently ended blackout windows.</div>
                    </div>
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-auto">
                      <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="active">Active</TabsTrigger>
                        <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                        <TabsTrigger value="recent">Ended</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                    <TabsContent value="overview" className="m-0 p-4 space-y-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        Blackout windows come from stored economic events. If restriction times are missing, the system derives a safe window around the UTC event time based on impact.
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold text-slate-600">Active right now</div>
                          <div className="mt-1 text-2xl font-semibold text-slate-950">{summary?.activeNow ?? 0}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold text-slate-600">Upcoming next 24h</div>
                          <div className="mt-1 text-2xl font-semibold text-slate-950">{summary?.upcomingNext24h ?? 0}</div>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="active" className="m-0">
                      <WindowTable loading={loading.dashboard} rows={dashboard?.active ?? []} selectedCurrency={selectedCurrency} />
                    </TabsContent>
                    <TabsContent value="upcoming" className="m-0">
                      <WindowTable loading={loading.dashboard} rows={dashboard?.upcoming ?? []} selectedCurrency={selectedCurrency} />
                    </TabsContent>
                    <TabsContent value="recent" className="m-0">
                      <WindowTable loading={loading.dashboard} rows={dashboard?.recent ?? []} selectedCurrency={selectedCurrency} />
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

function WindowTable(props: { loading: boolean; rows: NewsRiskEvent[]; selectedCurrency: string }) {
  const rows = props.rows.filter((r) => !props.selectedCurrency || String(r.currency ?? '').toUpperCase() === props.selectedCurrency);
  return (
    <div className="w-full overflow-x-auto">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            {['CCY', 'Event', 'Impact', 'Window Start', 'Window End', 'Status', 'Source'].map((h) => (
              <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.loading ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="h-20 text-center text-sm text-slate-600">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="h-20 text-center text-sm text-slate-600">
                No windows found for this filter.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} className="hover:bg-slate-50">
                <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.currency}</TableCell>
                <TableCell className="px-3 py-2 text-xs text-slate-700">{row.event_name}</TableCell>
                <TableCell className="px-3 py-2">
                  <ToneBadge tone={toneForImpact(row.impact_level)}>{row.impact_level}</ToneBadge>
                </TableCell>
                <TableCell className="px-3 py-2 font-mono text-xs text-slate-700">{fmtIso(row.window_start)}</TableCell>
                <TableCell className="px-3 py-2 font-mono text-xs text-slate-700">{fmtIso(row.window_end)}</TableCell>
                <TableCell className="px-3 py-2">
                  {row.window_status === 'active' ? <ToneBadge tone="amber">ACTIVE</ToneBadge> : null}
                  {row.window_status === 'upcoming' ? <ToneBadge tone="cyan">UPCOMING</ToneBadge> : null}
                  {row.window_status === 'recent' ? <ToneBadge tone="slate">ENDED</ToneBadge> : null}
                  {row.window_status === 'unknown' ? <ToneBadge tone="slate">UNKNOWN</ToneBadge> : null}
                </TableCell>
                <TableCell className="px-3 py-2">
                  {row.source_url ? (
                    <a className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline" href={row.source_url} target="_blank" rel="noreferrer">
                      {row.window_status === 'upcoming' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />} Investing
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">{fmtValue(row.source_url)}</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

