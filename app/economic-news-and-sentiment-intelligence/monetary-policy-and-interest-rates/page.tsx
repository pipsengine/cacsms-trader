'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, Database, Eye, Landmark, Loader2, Menu, RefreshCw, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { TraderSidebar } from '@/components/trader-sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type RateCurrentRow = {
  currency: string;
  centralBank: string | null;
  releaseDate: string | null;
  releaseTime: string | null;
  actualRate: number | string | null;
  forecastRate: number | string | null;
  previousRate: number | string | null;
  rateChange: number | string | null;
  surprise: number | string | null;
  bias: string | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
};

type CurrentRatesPayload = { ok: boolean; generatedAt: string; rates: RateCurrentRow[]; error?: string };

type RateHistoryRow = {
  id: string;
  event_id: number;
  currency: string;
  country: string | null;
  central_bank: string | null;
  event_name: string | null;
  release_date: string;
  release_time: string | null;
  actual_rate: number | string | null;
  forecast_rate: number | string | null;
  previous_rate: number | string | null;
  rate_change: number | string | null;
  surprise: number | string | null;
  bias: string | null;
  source_url: string;
  fetched_at: string;
};

type HistoryPayload = { ok: boolean; generatedAt: string; total: number; limit: number; offset: number; records: RateHistoryRow[]; error?: string };

type DifferentialRow = { base: string; quote: string; baseRate: number | null; quoteRate: number | null; differential: number | null };
type DifferentialsPayload = { ok: boolean; generatedAt: string; matrix: DifferentialRow[]; error?: string };

type BiasCurrencyRow = {
  currency: string;
  hikes: number;
  cuts: number;
  holds: number;
  netChange: number | null;
  avgSurprise: number | null;
  score: number;
  classification: 'Hawkish' | 'Neutral' | 'Dovish';
};
type BiasPayload = { ok: boolean; generatedAt: string; currencies: BiasCurrencyRow[]; mostHawkishCurrency: string | null; mostDovishCurrency: string | null; aiSummary: string; error?: string };

type SyncLogRow = {
  id: string;
  event_id: number | null;
  currency: string | null;
  sync_started_at: string;
  sync_completed_at: string | null;
  status: string;
  rows_fetched: number;
  rows_inserted: number;
  rows_updated: number;
  error_message: string | null;
};
type SyncLogsPayload = { ok: boolean; generatedAt: string; logs: SyncLogRow[]; error?: string };

type Tone = 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'slate';

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

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function fmtRate(value: number | string | null | undefined): string {
  const n = num(value);
  if (n == null) return '—';
  return `${n.toFixed(2)}%`;
}

function fmtDiff(value: number | null | undefined): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function classifyStance(actual: number | null, previous: number | null): 'Rate Hike' | 'Rate Hold' | 'Rate Cut' | '—' {
  if (actual == null || previous == null) return '—';
  if (actual > previous) return 'Rate Hike';
  if (actual < previous) return 'Rate Cut';
  return 'Rate Hold';
}

async function readJson<T>(response: Response): Promise<T> {
  const status = response.status;
  const text = await response.text().catch(() => '');
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`Empty response body (HTTP ${status}).`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const preview = trimmed.slice(0, 240);
    throw new Error(`Non-JSON response (HTTP ${status}): ${preview}`);
  }
}

export default function MonetaryPolicyInterestRatesPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'logs'>('dashboard');
  const [loading, setLoading] = useState({ current: false, history: false, bias: false, diffs: false, logs: false, sync: false });
  const [error, setError] = useState('');

  const [current, setCurrent] = useState<CurrentRatesPayload | null>(null);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [bias, setBias] = useState<BiasPayload | null>(null);
  const [diffs, setDiffs] = useState<DifferentialsPayload | null>(null);
  const [logs, setLogs] = useState<SyncLogsPayload | null>(null);

  const [historyCurrency, setHistoryCurrency] = useState('All');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');

  const loadCurrent = async () => {
    setLoading((p) => ({ ...p, current: true }));
    try {
      const res = await fetch('/api/rates/current', { cache: 'no-store' });
      const payload = await readJson<CurrentRatesPayload>(res);
      setCurrent(payload);
      if (!payload.ok) throw new Error(payload.error ?? `Failed to load current rates (HTTP ${res.status}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load current rates.');
    } finally {
      setLoading((p) => ({ ...p, current: false }));
    }
  };

  const loadBias = async () => {
    setLoading((p) => ({ ...p, bias: true }));
    try {
      const res = await fetch('/api/rates/bias', { cache: 'no-store' });
      const payload = await readJson<BiasPayload>(res);
      setBias(payload);
      if (!payload.ok) throw new Error(payload.error ?? `Failed to load bias (HTTP ${res.status}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bias.');
    } finally {
      setLoading((p) => ({ ...p, bias: false }));
    }
  };

  const loadDiffs = async () => {
    setLoading((p) => ({ ...p, diffs: true }));
    try {
      const res = await fetch('/api/rates/differentials', { cache: 'no-store' });
      const payload = await readJson<DifferentialsPayload>(res);
      setDiffs(payload);
      if (!payload.ok) throw new Error(payload.error ?? `Failed to load differentials (HTTP ${res.status}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load differentials.');
    } finally {
      setLoading((p) => ({ ...p, diffs: false }));
    }
  };

  const loadHistory = async () => {
    setLoading((p) => ({ ...p, history: true }));
    try {
      const params = new URLSearchParams();
      if (historyCurrency !== 'All') params.set('currency', historyCurrency);
      if (historyFrom) params.set('from', historyFrom);
      if (historyTo) params.set('to', historyTo);
      params.set('limit', '800');
      const res = await fetch(`/api/rates/history?${params.toString()}`, { cache: 'no-store' });
      const payload = await readJson<HistoryPayload>(res);
      setHistory(payload);
      if (!payload.ok) throw new Error(payload.error ?? `Failed to load rate history (HTTP ${res.status}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rate history.');
    } finally {
      setLoading((p) => ({ ...p, history: false }));
    }
  };

  const loadLogs = async () => {
    setLoading((p) => ({ ...p, logs: true }));
    try {
      const res = await fetch('/api/rates/sync-logs', { cache: 'no-store' });
      const payload = await readJson<SyncLogsPayload>(res);
      setLogs(payload);
      if (!payload.ok) throw new Error(payload.error ?? `Failed to load sync logs (HTTP ${res.status}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sync logs.');
    } finally {
      setLoading((p) => ({ ...p, logs: false }));
    }
  };

  const runSync = async () => {
    setLoading((p) => ({ ...p, sync: true }));
    setError('');
    try {
      const res = await fetch('/api/rates/sync', { method: 'POST', cache: 'no-store' });
      const payload = await readJson<any>(res);
      if (payload?.ok !== true) throw new Error(payload?.error ?? `Sync failed (HTTP ${res.status}).`);
      await Promise.all([loadCurrent(), loadBias(), loadDiffs(), loadHistory(), loadLogs()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setLoading((p) => ({ ...p, sync: false }));
    }
  };

  useEffect(() => {
    setError('');
    void Promise.all([loadCurrent(), loadBias(), loadDiffs(), loadHistory(), loadLogs()]);
  }, []);

  const historyRows = history?.records ?? [];
  const biasRows = bias?.currencies ?? [];
  const currentRows = current?.rates ?? [];

  const stanceCards = useMemo(() => {
    const stanceCount = { 'Rate Hike': 0, 'Rate Hold': 0, 'Rate Cut': 0 };
    for (const row of currentRows) {
      const stance = classifyStance(num(row.actualRate), num(row.previousRate));
      if (stance === 'Rate Hike') stanceCount['Rate Hike'] += 1;
      if (stance === 'Rate Hold') stanceCount['Rate Hold'] += 1;
      if (stance === 'Rate Cut') stanceCount['Rate Cut'] += 1;
    }
    return stanceCount;
  }, [currentRows]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <TraderSidebar bridgeOnline={false} mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 lg:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">Monetary Policy & Interest Rate History</h1>
              <p className="max-w-5xl text-xs font-mono uppercase tracking-wider text-indigo-700">
                Central-bank rate decisions captured from Investing.com event pages and stored in PostgreSQL.
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 lg:flex">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void runSync()} disabled={loading.sync}>
              {loading.sync ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync Last 3 Years Rate History
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <main className="space-y-5 p-4 md:p-6 lg:p-8">
              {error ? (
                <Card className="border-rose-200 bg-rose-50">
                  <CardContent className="flex items-start gap-3 p-4 text-rose-800">
                    <ShieldAlert className="mt-0.5 h-4 w-4" />
                    <div className="text-sm">{error}</div>
                  </CardContent>
                </Card>
              ) : null}

              <section className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                <Card className="border-slate-200 bg-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <Database className="h-4 w-4 text-indigo-700" /> Current Rates
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-xs text-slate-600">{currentRows.length} currencies</CardContent>
                </Card>
                <Card className="border-slate-200 bg-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <TrendingUp className="h-4 w-4 text-emerald-700" /> Most Hawkish
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-lg font-semibold text-slate-950">{bias?.mostHawkishCurrency ?? '—'}</div>
                    <div className="text-xs text-slate-600">3Y net + surprise score</div>
                  </CardContent>
                </Card>
                <Card className="border-slate-200 bg-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <TrendingDown className="h-4 w-4 text-rose-700" /> Most Dovish
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-lg font-semibold text-slate-950">{bias?.mostDovishCurrency ?? '—'}</div>
                    <div className="text-xs text-slate-600">3Y net + surprise score</div>
                  </CardContent>
                </Card>
                <Card className="border-slate-200 bg-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <CalendarClock className="h-4 w-4 text-cyan-700" /> Last Refresh
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-xs text-slate-700">{current?.generatedAt ? new Date(current.generatedAt).toLocaleString() : '—'}</CardContent>
                </Card>
              </section>

              <Card className="border-slate-200 bg-white">
                <CardHeader className="border-b border-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <Landmark className="h-4 w-4 text-indigo-700" /> Policy Rates Dashboard
                    </CardTitle>
                    <div className="flex items-center gap-2 lg:hidden">
                      <Button variant="outline" size="sm" className="gap-2" onClick={() => void runSync()} disabled={loading.sync}>
                        {loading.sync ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync Last 3 Years Rate History
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
                    <div className="border-b border-slate-200 p-4">
                      <TabsList className="h-auto flex-wrap justify-start bg-slate-100">
                        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                        <TabsTrigger value="history">Rate History</TabsTrigger>
                        <TabsTrigger value="logs">Sync Logs</TabsTrigger>
                      </TabsList>
                    </div>

                    <TabsContent value="dashboard" className="m-0 space-y-4 p-4">
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                          <CardHeader className="border-b border-slate-200">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-950">Current Policy Rates</div>
                                <div className="mt-1 text-xs text-slate-500">Latest captured rate decision for each major currency.</div>
                              </div>
                              <div className="text-xs font-mono text-slate-600">{loading.current ? 'Loading…' : `${currentRows.length} rows`}</div>
                            </div>
                          </CardHeader>
                          <CardContent className="p-0">
                            <div className="w-full overflow-x-auto">
                              <Table>
                                <TableHeader className="bg-slate-50">
                                  <TableRow className="hover:bg-transparent">
                                    {['Currency', 'Central Bank', 'Actual', 'Forecast', 'Previous', 'Change', 'Surprise', 'Bias', 'Stance', 'Source'].map((h) => (
                                      <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                                        {h}
                                      </TableHead>
                                    ))}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {loading.current ? (
                                    <TableRow className="hover:bg-transparent">
                                      <TableCell colSpan={10} className="h-24 text-center text-sm text-slate-600">
                                        Loading current rates…
                                      </TableCell>
                                    </TableRow>
                                  ) : currentRows.length === 0 ? (
                                    <TableRow className="hover:bg-transparent">
                                      <TableCell colSpan={10} className="h-24 text-center text-sm text-slate-600">
                                        No rate history rows collected yet. Run “Sync Last 3 Years Rate History”.
                                      </TableCell>
                                    </TableRow>
                                  ) : (
                                    currentRows.map((row) => {
                                      const stance = classifyStance(num(row.actualRate), num(row.previousRate));
                                      return (
                                        <TableRow key={row.currency} className="hover:bg-slate-50">
                                          <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.currency}</TableCell>
                                          <TableCell className="px-3 py-2 text-xs text-slate-700">{row.centralBank ?? '—'}</TableCell>
                                          <TableCell className="px-3 py-2 font-mono text-xs">{fmtRate(row.actualRate)}</TableCell>
                                          <TableCell className="px-3 py-2 font-mono text-xs text-slate-600">{fmtRate(row.forecastRate)}</TableCell>
                                          <TableCell className="px-3 py-2 font-mono text-xs text-slate-600">{fmtRate(row.previousRate)}</TableCell>
                                          <TableCell className="px-3 py-2 font-mono text-xs">{fmtDiff(num(row.rateChange))}</TableCell>
                                          <TableCell className="px-3 py-2 font-mono text-xs">{fmtDiff(num(row.surprise))}</TableCell>
                                          <TableCell className="px-3 py-2 text-xs">{row.bias ?? '—'}</TableCell>
                                          <TableCell className="px-3 py-2">
                                            {stance === 'Rate Hike' ? <ToneBadge tone="emerald">{stance}</ToneBadge> : null}
                                            {stance === 'Rate Hold' ? <ToneBadge tone="slate">{stance}</ToneBadge> : null}
                                            {stance === 'Rate Cut' ? <ToneBadge tone="rose">{stance}</ToneBadge> : null}
                                            {stance === '—' ? <ToneBadge tone="slate">—</ToneBadge> : null}
                                          </TableCell>
                                          <TableCell className="px-3 py-2">
                                            {row.sourceUrl ? (
                                              <a className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline" href={row.sourceUrl} target="_blank" rel="noreferrer">
                                                <Eye className="h-3.5 w-3.5" /> Investing
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
                          </CardContent>
                        </Card>

                        <div className="space-y-4">
                          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                            <CardHeader className="border-b border-slate-200">
                              <div className="text-sm font-semibold text-slate-950">Rate Differential Matrix</div>
                              <div className="mt-1 text-xs text-slate-500">Latest policy-rate differentials for core macro pairs.</div>
                            </CardHeader>
                            <CardContent className="p-0">
                              <div className="w-full overflow-x-auto">
                                <Table>
                                  <TableHeader className="bg-slate-50">
                                    <TableRow className="hover:bg-transparent">
                                      {['Pair', 'Base', 'Quote', 'Differential'].map((h) => (
                                        <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                                          {h}
                                        </TableHead>
                                      ))}
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {loading.diffs ? (
                                      <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={4} className="h-20 text-center text-sm text-slate-600">
                                          Loading differentials…
                                        </TableCell>
                                      </TableRow>
                                    ) : (diffs?.matrix ?? []).length === 0 ? (
                                      <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={4} className="h-20 text-center text-sm text-slate-600">
                                          No differentials yet.
                                        </TableCell>
                                      </TableRow>
                                    ) : (
                                      (diffs?.matrix ?? []).map((row) => (
                                        <TableRow key={`${row.base}-${row.quote}`} className="hover:bg-slate-50">
                                          <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.base}/{row.quote}</TableCell>
                                          <TableCell className="px-3 py-2 font-mono text-xs text-slate-600">{row.baseRate == null ? '—' : `${row.baseRate.toFixed(2)}%`}</TableCell>
                                          <TableCell className="px-3 py-2 font-mono text-xs text-slate-600">{row.quoteRate == null ? '—' : `${row.quoteRate.toFixed(2)}%`}</TableCell>
                                          <TableCell className="px-3 py-2 font-mono text-xs">{fmtDiff(row.differential)}</TableCell>
                                        </TableRow>
                                      ))
                                    )}
                                  </TableBody>
                                </Table>
                              </div>
                            </CardContent>
                          </Card>

                          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                            <CardHeader className="border-b border-slate-200">
                              <div className="text-sm font-semibold text-slate-950">Central Bank Bias Cards</div>
                              <div className="mt-1 text-xs text-slate-500">Aggregated 3-year decision and surprise scoring.</div>
                            </CardHeader>
                            <CardContent className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <div className="text-xs font-semibold text-slate-600">Hawkish</div>
                                <div className="mt-1 text-lg font-semibold text-slate-950">{biasRows.filter((r) => r.classification === 'Hawkish').length}</div>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <div className="text-xs font-semibold text-slate-600">Neutral</div>
                                <div className="mt-1 text-lg font-semibold text-slate-950">{biasRows.filter((r) => r.classification === 'Neutral').length}</div>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <div className="text-xs font-semibold text-slate-600">Dovish</div>
                                <div className="mt-1 text-lg font-semibold text-slate-950">{biasRows.filter((r) => r.classification === 'Dovish').length}</div>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <div className="text-xs font-semibold text-slate-600">Rate Hikes</div>
                                <div className="mt-1 text-lg font-semibold text-slate-950">{stanceCards['Rate Hike']}</div>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <div className="text-xs font-semibold text-slate-600">Rate Holds</div>
                                <div className="mt-1 text-lg font-semibold text-slate-950">{stanceCards['Rate Hold']}</div>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <div className="text-xs font-semibold text-slate-600">Rate Cuts</div>
                                <div className="mt-1 text-lg font-semibold text-slate-950">{stanceCards['Rate Cut']}</div>
                              </div>
                            </CardContent>
                          </Card>

                          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                            <CardHeader className="border-b border-slate-200">
                              <div className="text-sm font-semibold text-slate-950">AI Monetary Policy Summary</div>
                              <div className="mt-1 text-xs text-slate-500">Generated from stored rates and differentials.</div>
                            </CardHeader>
                            <CardContent className="p-4 text-sm text-slate-800">
                              {loading.bias ? 'Loading summary…' : bias?.aiSummary ?? 'No summary yet.'}
                            </CardContent>
                          </Card>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="history" className="m-0 space-y-4 p-4">
                      <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                        <CardHeader className="border-b border-slate-200">
                          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-slate-950">Rate History Table</div>
                              <div className="mt-1 text-xs text-slate-500">Historical rate decisions stored in PostgreSQL.</div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700" value={historyCurrency} onChange={(e) => setHistoryCurrency(e.target.value)}>
                                {['All', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'].map((cur) => (
                                  <option key={cur} value={cur}>
                                    {cur}
                                  </option>
                                ))}
                              </select>
                              <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700" type="date" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} />
                              <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700" type="date" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} />
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => void loadHistory()} disabled={loading.history}>
                                {loading.history ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="w-full overflow-x-auto">
                            <Table>
                              <TableHeader className="bg-slate-50">
                                <TableRow className="hover:bg-transparent">
                                  {['Date', 'Currency', 'Central Bank', 'Actual', 'Forecast', 'Previous', 'Change', 'Surprise', 'Bias', 'Source'].map((h) => (
                                    <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                                      {h}
                                    </TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {loading.history ? (
                                  <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={10} className="h-24 text-center text-sm text-slate-600">
                                      Loading rate history…
                                    </TableCell>
                                  </TableRow>
                                ) : historyRows.length === 0 ? (
                                  <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={10} className="h-24 text-center text-sm text-slate-600">
                                      No historical rows yet. Run “Sync Last 3 Years Rate History”.
                                    </TableCell>
                                  </TableRow>
                                ) : (
                                  historyRows.map((row) => (
                                    <TableRow key={row.id} className="hover:bg-slate-50">
                                      <TableCell className="px-3 py-2 font-mono text-xs">{row.release_date}</TableCell>
                                      <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.currency}</TableCell>
                                      <TableCell className="px-3 py-2 text-xs text-slate-700">{row.central_bank ?? '—'}</TableCell>
                                      <TableCell className="px-3 py-2 font-mono text-xs">{fmtRate(row.actual_rate)}</TableCell>
                                      <TableCell className="px-3 py-2 font-mono text-xs text-slate-600">{fmtRate(row.forecast_rate)}</TableCell>
                                      <TableCell className="px-3 py-2 font-mono text-xs text-slate-600">{fmtRate(row.previous_rate)}</TableCell>
                                      <TableCell className="px-3 py-2 font-mono text-xs">{fmtDiff(num(row.rate_change))}</TableCell>
                                      <TableCell className="px-3 py-2 font-mono text-xs">{fmtDiff(num(row.surprise))}</TableCell>
                                      <TableCell className="px-3 py-2 text-xs">{row.bias ?? '—'}</TableCell>
                                      <TableCell className="px-3 py-2">
                                        <a className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline" href={row.source_url} target="_blank" rel="noreferrer">
                                          <Eye className="h-3.5 w-3.5" /> Investing
                                        </a>
                                      </TableCell>
                                    </TableRow>
                                  ))
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="logs" className="m-0 space-y-4 p-4">
                      <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                        <CardHeader className="border-b border-slate-200">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-950">Sync Logs</div>
                              <div className="mt-1 text-xs text-slate-500">Status and error tracking for rate ingestion jobs.</div>
                            </div>
                            <Button variant="outline" size="sm" className="gap-2" onClick={() => void loadLogs()} disabled={loading.logs}>
                              {loading.logs ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="w-full overflow-x-auto">
                            <Table>
                              <TableHeader className="bg-slate-50">
                                <TableRow className="hover:bg-transparent">
                                  {['Started', 'Event ID', 'Currency', 'Status', 'Fetched', 'Inserted', 'Updated', 'Error'].map((h) => (
                                    <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                                      {h}
                                    </TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {loading.logs ? (
                                  <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={8} className="h-24 text-center text-sm text-slate-600">
                                      Loading logs…
                                    </TableCell>
                                  </TableRow>
                                ) : (logs?.logs ?? []).length === 0 ? (
                                  <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={8} className="h-24 text-center text-sm text-slate-600">
                                      No logs yet.
                                    </TableCell>
                                  </TableRow>
                                ) : (
                                  (logs?.logs ?? []).map((row) => (
                                    <TableRow key={row.id} className="hover:bg-slate-50">
                                      <TableCell className="px-3 py-2 font-mono text-xs">{new Date(row.sync_started_at).toLocaleString()}</TableCell>
                                      <TableCell className="px-3 py-2 font-mono text-xs">{row.event_id ?? '—'}</TableCell>
                                      <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.currency ?? '—'}</TableCell>
                                      <TableCell className="px-3 py-2 text-xs">{row.status}</TableCell>
                                      <TableCell className="px-3 py-2 font-mono text-xs">{row.rows_fetched}</TableCell>
                                      <TableCell className="px-3 py-2 font-mono text-xs">{row.rows_inserted}</TableCell>
                                      <TableCell className="px-3 py-2 font-mono text-xs">{row.rows_updated}</TableCell>
                                      <TableCell className="px-3 py-2 text-xs text-slate-600">{row.error_message ?? '—'}</TableCell>
                                    </TableRow>
                                  ))
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </main>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
