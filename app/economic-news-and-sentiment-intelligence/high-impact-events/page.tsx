'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarClock, Loader2, Menu, RefreshCw, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TraderSidebar } from '@/components/trader-sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type Tone = 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'slate';
type WindowKey = 'today' | '24h' | '7d' | '30d' | '90d';
type StatusKey = 'all' | 'upcoming' | 'released';

type HighImpactEvent = {
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
  restriction_start_time: string | null;
  restriction_end_time: string | null;
  trade_restriction_required: boolean;
  updated_at: string;
  released: boolean;
};

type DashboardPayload = {
  ok: boolean;
  generatedAt: string;
  error?: string;
  filters?: { window: WindowKey; from: string; to: string; currencies: string[]; status: string };
  universe?: { currencies: string[] };
  summary?: {
    total: number;
    upcoming: number;
    released: number;
    critical: number;
    byCurrency: Record<string, { total: number; upcoming: number; released: number; critical: number }>;
    nextByCurrency: Record<string, { eventDate: string; eventTime: string | null; eventName: string; impactLevel: string; restrictionStart: string | null; restrictionEnd: string | null }>;
  };
  upcoming: HighImpactEvent[];
  recent: HighImpactEvent[];
};

type TimelinePoint = { date: string; total: number; released: number; upcoming: number; critical: number };
type TimelinePayload = { ok: boolean; generatedAt: string; error?: string; days: number; points: TimelinePoint[] };

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
  return 'slate';
}

function fmtValue(value: string | null | undefined): string {
  const s = String(value ?? '').trim();
  return s ? s : '—';
}

const majorCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'] as const;
const windowButtons: WindowKey[] = ['today', '24h', '7d', '30d', '90d'];
const statusButtons: Array<{ key: StatusKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'released', label: 'Released' },
];

export default function HighImpactEventsPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [windowKey, setWindowKey] = useState<WindowKey>('7d');
  const [statusKey, setStatusKey] = useState<StatusKey>('all');
  const [activeTab, setActiveTab] = useState<'overview' | 'upcoming' | 'recent'>('overview');
  const [loading, setLoading] = useState({ dashboard: true, timeline: true });
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async (props?: { window?: WindowKey; status?: StatusKey; currency?: string }) => {
    const w = props?.window ?? windowKey;
    const s = props?.status ?? statusKey;
    const cur = props?.currency ?? selectedCurrency;

    setLoading((x) => ({ ...x, dashboard: true }));
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('window', w);
      qs.set('status', s);
      if (cur) qs.set('currency', cur);
      const res = await fetch(`/api/economic-calendar/high-impact?${qs.toString()}`, { cache: 'no-store' });
      const payload = await readJson<DashboardPayload>(res);
      setDashboard(payload);
      if (!payload.ok) setError(payload.error ?? 'Failed to load high-impact events.');
    } catch (e) {
      setDashboard(null);
      setError(e instanceof Error ? e.message : 'Failed to load high-impact events.');
    } finally {
      setLoading((x) => ({ ...x, dashboard: false }));
    }
  };

  const loadTimeline = async () => {
    setLoading((x) => ({ ...x, timeline: true }));
    setError(null);
    try {
      const res = await fetch(`/api/economic-calendar/high-impact?view=timeline&days=45`, { cache: 'no-store' });
      const payload = await readJson<TimelinePayload>(res);
      setTimeline(payload);
      if (!payload.ok) setError(payload.error ?? 'Failed to load high-impact timeline.');
    } catch (e) {
      setTimeline(null);
      setError(e instanceof Error ? e.message : 'Failed to load high-impact timeline.');
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

  const headline = useMemo(() => {
    const total = dashboard?.summary?.total ?? 0;
    const upcoming = dashboard?.summary?.upcoming ?? 0;
    const released = dashboard?.summary?.released ?? 0;
    const critical = dashboard?.summary?.critical ?? 0;
    return { total, upcoming, released, critical };
  }, [dashboard?.summary]);

  const currencyCards = useMemo(() => {
    const byCurrency = dashboard?.summary?.byCurrency ?? {};
    const next = dashboard?.summary?.nextByCurrency ?? {};
    return majorCurrencies.map((currency) => {
      const stats = byCurrency[currency] ?? { total: 0, upcoming: 0, released: 0, critical: 0 };
      const n = next[currency] ?? null;
      return {
        currency,
        total: stats.total,
        upcoming: stats.upcoming,
        released: stats.released,
        critical: stats.critical,
        nextDate: n?.eventDate ?? null,
        nextName: n?.eventName ?? null,
        nextImpact: n?.impactLevel ?? null,
      };
    });
  }, [dashboard?.summary]);

  const chartData = useMemo(() => {
    return (timeline?.points ?? []).map((p) => ({
      date: p.date,
      total: p.total,
      released: p.released,
      upcoming: p.upcoming,
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
              className="grid h-10 w-10 place-items-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-700 lg:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">High-Impact Events</h1>
              <p className="text-xs font-mono uppercase tracking-wider text-rose-700">High & critical macro releases from the internal economic calendar</p>
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

            <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Card className="border-slate-200 bg-rose-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <ShieldAlert className="h-4 w-4 text-rose-700" /> High-Impact Universe
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${headline.total} events`}</div>
                </CardHeader>
              </Card>
              <Card className="border-slate-200 bg-cyan-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <CalendarClock className="h-4 w-4 text-cyan-700" /> Upcoming
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${headline.upcoming} upcoming`}</div>
                </CardHeader>
              </Card>
              <Card className="border-slate-200 bg-emerald-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <TrendingUp className="h-4 w-4 text-emerald-700" /> Released
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${headline.released} released`}</div>
                </CardHeader>
              </Card>
              <Card className="border-slate-200 bg-amber-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <AlertTriangle className="h-4 w-4 text-amber-700" /> Critical
                  </CardTitle>
                  <div className="text-xs text-slate-600">{loading.dashboard ? 'Loading…' : `${headline.critical} critical`}</div>
                </CardHeader>
              </Card>
            </section>

            <section className="grid grid-cols-1 gap-4">
              <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <CardHeader className="border-b border-slate-200">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Filters</div>
                      <div className="mt-1 text-xs text-slate-500">Window and status apply to the event stream. Currency selection focuses on one major currency.</div>
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
                      const nextTone = c.nextImpact ? toneForImpact(c.nextImpact) : 'slate';
                      return (
                        <button
                          key={c.currency}
                          type="button"
                          onClick={() => setSelectedCurrency(c.currency)}
                          className={cn(
                            'rounded-xl border px-3 py-3 text-left shadow-sm transition',
                            active ? 'border-rose-300 bg-rose-50 shadow-rose-900/10' : 'border-slate-200 bg-white hover:bg-slate-50',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-mono text-xs font-semibold text-slate-900">{c.currency}</div>
                            <ToneBadge tone={c.critical > 0 ? 'rose' : c.upcoming > 0 ? 'amber' : 'slate'}>{c.upcoming} due</ToneBadge>
                          </div>
                          <div className="mt-2 text-[11px] text-slate-600">Next event</div>
                          <div className="truncate text-xs text-slate-900">{c.nextDate ?? '—'}</div>
                          <div className="mt-1">
                            <ToneBadge tone={nextTone}>{c.nextImpact ?? '—'}</ToneBadge>
                          </div>
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
                      <div className="text-sm font-semibold text-slate-950">High-Impact Timeline</div>
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
                          <Line type="monotone" dataKey="total" stroke="#4f46e5" strokeWidth={2} dot={false} name="Total" />
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
                      <div className="text-sm font-semibold text-slate-950">Event Stream</div>
                      <div className="mt-1 text-xs text-slate-500">Filtered by window/status and focused currency.</div>
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
                        This page shows only High/Critical impact events. If empty, open Economic Calendar Overview and run Discover Upcoming Events.
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold text-slate-600">Window</div>
                          <div className="mt-1 text-2xl font-semibold text-slate-950">{windowKey.toUpperCase()}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold text-slate-600">Status filter</div>
                          <div className="mt-1 text-2xl font-semibold text-slate-950">{statusKey.toUpperCase()}</div>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="upcoming" className="m-0">
                      <div className="w-full overflow-x-auto">
                        <Table>
                          <TableHeader className="bg-slate-50">
                            <TableRow className="hover:bg-transparent">
                              {['Date', 'Time', 'Country', 'CCY', 'Event', 'Impact', 'Blackout', 'Status'].map((h) => (
                                <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                                  {h}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {loading.dashboard ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={8} className="h-20 text-center text-sm text-slate-600">
                                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                                </TableCell>
                              </TableRow>
                            ) : (dashboard?.upcoming ?? []).length === 0 ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={8} className="h-20 text-center text-sm text-slate-600">
                                  No upcoming high-impact events in this window.
                                </TableCell>
                              </TableRow>
                            ) : (
                              (dashboard?.upcoming ?? [])
                                .filter((row) => !selectedCurrency || String(row.currency ?? '').toUpperCase() === selectedCurrency)
                                .map((row) => (
                                  <TableRow key={row.id} className="hover:bg-slate-50">
                                    <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.event_date}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs text-slate-700">{row.event_time ?? '—'}</TableCell>
                                    <TableCell className="px-3 py-2 text-xs text-slate-700">{row.country}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.currency}</TableCell>
                                    <TableCell className="px-3 py-2 text-xs text-slate-700">{row.event_name}</TableCell>
                                    <TableCell className="px-3 py-2">
                                      <ToneBadge tone={toneForImpact(row.impact_level)}>{row.impact_level}</ToneBadge>
                                    </TableCell>
                                    <TableCell className="px-3 py-2 text-xs">
                                      {row.trade_restriction_required ? (
                                        <ToneBadge tone="rose">
                                          {row.restriction_start_time && row.restriction_end_time ? 'Active window' : 'Required'}
                                        </ToneBadge>
                                      ) : (
                                        <ToneBadge tone="slate">None</ToneBadge>
                                      )}
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
                              {['Date', 'CCY', 'Event', 'Actual', 'Forecast', 'Previous', 'Impact', 'Source'].map((h) => (
                                <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                                  {h}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {loading.dashboard ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={8} className="h-20 text-center text-sm text-slate-600">
                                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                                </TableCell>
                              </TableRow>
                            ) : (dashboard?.recent ?? []).length === 0 ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={8} className="h-20 text-center text-sm text-slate-600">
                                  No released high-impact events in this window.
                                </TableCell>
                              </TableRow>
                            ) : (
                              (dashboard?.recent ?? [])
                                .filter((row) => !selectedCurrency || String(row.currency ?? '').toUpperCase() === selectedCurrency)
                                .map((row) => (
                                  <TableRow key={row.id} className="hover:bg-slate-50">
                                    <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.event_date}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.currency}</TableCell>
                                    <TableCell className="px-3 py-2 text-xs text-slate-700">{row.event_name}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs">{fmtValue(row.actual_value)}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs text-slate-600">{fmtValue(row.forecast_value)}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs text-slate-600">{fmtValue(row.revised_previous_value ?? row.previous_value)}</TableCell>
                                    <TableCell className="px-3 py-2">
                                      <ToneBadge tone={toneForImpact(row.impact_level)}>{row.impact_level}</ToneBadge>
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                      {row.source_url ? (
                                        <a className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline" href={row.source_url} target="_blank" rel="noreferrer">
                                          {row.actual_value ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />} Investing
                                        </a>
                                      ) : (
                                        <span className="text-xs text-slate-500">—</span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))
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
      </div>
    </div>
  );
}

