'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, Loader2, Menu, RefreshCw, ShieldAlert, TrendingDown, TrendingUp, Waves } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TraderSidebar } from '@/components/trader-sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type Tone = 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'slate';

type Payload = {
  ok: boolean;
  generatedAt: string;
  error?: string;
  horizonDays?: number;
  latest?: {
    usdPolicyRate: number | null;
    headlineCpiYoy: number | null;
    coreCpiYoy: number | null;
    realRateProxy: number | null;
    usdMacroScore: number;
    usdMacroRegime: 'bullish_usd' | 'neutral_usd' | 'bearish_usd';
    goldScore: number;
    goldRegime: 'bullish_gold' | 'neutral_gold' | 'bearish_gold';
    upcomingUsdHighImpact: number;
  };
  series?: {
    realRateProxyByMonth: Array<{
      month: string;
      eventDate: string;
      headlineYoy: number | null;
      coreYoy: number | null;
      policyRate: number | null;
      realRateProxy: number | null;
    }>;
  };
  intermarket?: {
    latestRates: Array<{
      currency: string;
      centralBank: string | null;
      releaseDate: string | null;
      releaseTime: string | null;
      actualRate: number | null;
      rateChange: number | null;
      bias: string | null;
      fetchedAt: string | null;
    }>;
    usdSpreads: Array<{ pair: string; base: string; quote: string; differential: number | null }>;
  };
  usd?: {
    topDrivers: Array<{
      id: string;
      eventDate: string;
      eventName: string;
      impactLevel: string;
      surprise: number;
      normalized: number;
      contribution: number;
      category: string;
      kind: string;
      sourceUrl: string | null;
    }>;
    upcomingHighImpact: Array<{
      id: string;
      eventDate: string;
      eventTime: string | null;
      utcEventTime: string | null;
      eventName: string;
      impactLevel: string;
      status: string;
      sourceUrl: string | null;
    }>;
  };
  model?: { notes?: string[] };
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

function toneForGold(score: number): Tone {
  if (score >= 35) return 'emerald';
  if (score >= 15) return 'cyan';
  if (score <= -35) return 'rose';
  if (score <= -15) return 'amber';
  return 'slate';
}

function toneForUsd(score: number): Tone {
  if (score >= 25) return 'emerald';
  if (score <= -25) return 'rose';
  return 'slate';
}

function fmt(value: number | null | undefined, digits = 2, suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)}${suffix}`;
}

export default function GoldAndIntermarketAnalysisPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'drivers' | 'risk' | 'rates'>('overview');
  const [horizonDays, setHorizonDays] = useState(365);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/intermarket/gold?horizonDays=${encodeURIComponent(String(horizonDays))}`, { cache: 'no-store' });
      const data = await readJson<Payload>(res);
      setPayload(data);
      if (!data.ok) setError(data.error ?? 'Failed to load Gold & Intermarket Analysis.');
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : 'Failed to load Gold & Intermarket Analysis.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [horizonDays]);

  const latest = payload?.latest ?? null;

  const chartData = useMemo(() => {
    const items = payload?.series?.realRateProxyByMonth ?? [];
    return items
      .map((p) => ({
        month: p.month,
        real: p.realRateProxy,
        policy: p.policyRate,
        cpi: p.headlineYoy ?? p.coreYoy,
      }))
      .filter((p) => p.real != null || p.policy != null || p.cpi != null);
  }, [payload?.series?.realRateProxyByMonth]);

  const goldTone = toneForGold(latest?.goldScore ?? 0);
  const usdTone = toneForUsd(latest?.usdMacroScore ?? 0);

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
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">Gold &amp; Intermarket Analysis</h1>
              <p className="text-xs font-mono uppercase tracking-wider text-amber-700">Macro intermarket drivers using stored rates, CPI and economic surprises</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2">
              <Button size="sm" variant={horizonDays === 180 ? 'default' : 'outline'} onClick={() => setHorizonDays(180)}>
                180D
              </Button>
              <Button size="sm" variant={horizonDays === 365 ? 'default' : 'outline'} onClick={() => setHorizonDays(365)}>
                365D
              </Button>
              <Button size="sm" variant={horizonDays === 730 ? 'default' : 'outline'} onClick={() => setHorizonDays(730)}>
                730D
              </Button>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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
              <Card className={cn('shadow-sm shadow-slate-900/5', goldTone === 'emerald' ? 'border-emerald-200 bg-emerald-50' : goldTone === 'rose' ? 'border-rose-200 bg-rose-50' : goldTone === 'cyan' ? 'border-cyan-200 bg-cyan-50' : goldTone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50')}>
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <Waves className={cn('h-4 w-4', goldTone === 'emerald' ? 'text-emerald-700' : goldTone === 'rose' ? 'text-rose-700' : goldTone === 'cyan' ? 'text-cyan-700' : goldTone === 'amber' ? 'text-amber-700' : 'text-slate-700')} />
                    Gold Bias
                  </CardTitle>
                  <div className="flex items-center gap-2 text-xs text-slate-700">
                    <ToneBadge tone={goldTone}>{fmt(latest?.goldScore ?? null, 0)}</ToneBadge>
                    <span className="uppercase tracking-wide">{latest?.goldRegime?.replace('_', ' ') ?? '—'}</span>
                  </div>
                </CardHeader>
              </Card>

              <Card className="border-slate-200 bg-violet-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <ShieldAlert className="h-4 w-4 text-violet-700" /> Real Rate Proxy
                  </CardTitle>
                  <div className="text-xs text-slate-700">USD policy − CPI YoY</div>
                  <div className="mt-1 font-mono text-sm font-semibold text-slate-950">{fmt(latest?.realRateProxy ?? null, 2, '%')}</div>
                </CardHeader>
              </Card>

              <Card className={cn('shadow-sm shadow-slate-900/5', usdTone === 'emerald' ? 'border-emerald-200 bg-emerald-50' : usdTone === 'rose' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50')}>
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    {latest?.usdMacroScore != null && latest.usdMacroScore < 0 ? <TrendingDown className="h-4 w-4 text-rose-700" /> : <TrendingUp className="h-4 w-4 text-emerald-700" />}
                    USD Macro Score
                  </CardTitle>
                  <div className="flex items-center gap-2 text-xs text-slate-700">
                    <ToneBadge tone={usdTone}>{fmt(latest?.usdMacroScore ?? null, 0)}</ToneBadge>
                    <span className="uppercase tracking-wide">{latest?.usdMacroRegime?.replace('_', ' ') ?? '—'}</span>
                  </div>
                </CardHeader>
              </Card>

              <Card className="border-slate-200 bg-amber-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <CalendarClock className="h-4 w-4 text-amber-700" /> USD Event Risk
                  </CardTitle>
                  <div className="text-xs text-slate-700">Next 7 days (high/critical)</div>
                  <div className="mt-1 font-mono text-sm font-semibold text-slate-950">{latest?.upcomingUsdHighImpact ?? 0}</div>
                </CardHeader>
              </Card>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <CardHeader className="border-b border-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Real Rate Proxy (History)</div>
                      <div className="mt-1 text-xs text-slate-500">Computed using stored CPI YoY and USD policy rate history.</div>
                    </div>
                    <ToneBadge tone="slate">{horizonDays}D</ToneBadge>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  {loading ? (
                    <div className="flex h-[260px] items-center justify-center text-sm text-slate-600">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                    </div>
                  ) : chartData.length === 0 ? (
                    <div className="flex h-[260px] items-center justify-center text-sm text-slate-600">No CPI/rate history found yet.</div>
                  ) : (
                    <div className="h-[260px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                          <XAxis dataKey="month" tick={{ fontSize: 10 }} minTickGap={18} />
                          <YAxis tick={{ fontSize: 10 }} width={44} />
                          <Tooltip formatter={(v: any, name: any) => [fmt(typeof v === 'number' ? v : null, 2, '%'), String(name)]} />
                          <Line type="monotone" dataKey="real" stroke="#7c3aed" strokeWidth={2} dot={false} name="Real proxy" />
                          <Line type="monotone" dataKey="policy" stroke="#0ea5e9" strokeWidth={2} dot={false} name="Policy rate" />
                          <Line type="monotone" dataKey="cpi" stroke="#64748b" strokeWidth={1.5} dot={false} name="CPI YoY" />
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
                      <div className="text-sm font-semibold text-slate-950">Intermarket Dashboard</div>
                      <div className="mt-1 text-xs text-slate-500">Drivers, risk, and rate differentials impacting gold regime.</div>
                    </div>
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-auto">
                      <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="drivers">Drivers</TabsTrigger>
                        <TabsTrigger value="risk">Risk</TabsTrigger>
                        <TabsTrigger value="rates">Rates</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                    <TabsContent value="overview" className="m-0 p-4 space-y-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        This view uses internal Economic Calendar and Rates tables only. It does not require any external price feed to compute the macro bias regime.
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold text-slate-600">USD policy rate</div>
                          <div className="mt-1 font-mono text-lg font-semibold text-slate-950">{fmt(latest?.usdPolicyRate ?? null, 2, '%')}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold text-slate-600">US CPI YoY</div>
                          <div className="mt-1 font-mono text-lg font-semibold text-slate-950">{fmt(latest?.headlineCpiYoy ?? null, 2, '%')}</div>
                          <div className="mt-1 text-xs text-slate-600">Core {fmt(latest?.coreCpiYoy ?? null, 2, '%')}</div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {(payload?.model?.notes ?? []).map((t) => (
                          <div key={t} className="text-xs text-slate-600">
                            {t}
                          </div>
                        ))}
                      </div>
                    </TabsContent>

                    <TabsContent value="drivers" className="m-0">
                      <div className="w-full overflow-x-auto">
                        <Table>
                          <TableHeader className="bg-slate-50">
                            <TableRow className="hover:bg-transparent">
                              {['Date', 'Category', 'Event', 'Impact', 'Surprise', 'Contribution'].map((h) => (
                                <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                                  {h}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {loading ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={6} className="h-20 text-center text-sm text-slate-600">
                                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                                </TableCell>
                              </TableRow>
                            ) : (payload?.usd?.topDrivers ?? []).length === 0 ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={6} className="h-20 text-center text-sm text-slate-600">
                                  No USD surprise history found yet.
                                </TableCell>
                              </TableRow>
                            ) : (
                              (payload?.usd?.topDrivers ?? []).map((row) => {
                                const contrib = Number(row.contribution ?? 0);
                                const tone: Tone = contrib > 0 ? 'emerald' : contrib < 0 ? 'rose' : 'slate';
                                return (
                                  <TableRow key={row.id} className="hover:bg-slate-50">
                                    <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.eventDate}</TableCell>
                                    <TableCell className="px-3 py-2">
                                      <ToneBadge tone="violet">{String(row.category).toUpperCase()}</ToneBadge>
                                    </TableCell>
                                    <TableCell className="px-3 py-2 text-xs text-slate-700">
                                      <div className="flex items-center gap-2">
                                        <span className="truncate">{row.eventName}</span>
                                        {row.sourceUrl ? (
                                          <a className="text-xs font-semibold text-indigo-700 hover:underline" href={row.sourceUrl} target="_blank" rel="noreferrer">
                                            Link
                                          </a>
                                        ) : null}
                                      </div>
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                      <ToneBadge tone={row.impactLevel === 'Critical' ? 'rose' : row.impactLevel === 'High' ? 'amber' : 'slate'}>{row.impactLevel}</ToneBadge>
                                    </TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs text-slate-700">{fmt(row.surprise ?? null, 2)}</TableCell>
                                    <TableCell className="px-3 py-2">
                                      <ToneBadge tone={tone}>{fmt(contrib * 10, 2)}</ToneBadge>
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </TabsContent>

                    <TabsContent value="risk" className="m-0">
                      <div className="w-full overflow-x-auto">
                        <Table>
                          <TableHeader className="bg-slate-50">
                            <TableRow className="hover:bg-transparent">
                              {['Date', 'Time', 'Event', 'Impact', 'Status', 'Source'].map((h) => (
                                <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                                  {h}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {loading ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={6} className="h-20 text-center text-sm text-slate-600">
                                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                                </TableCell>
                              </TableRow>
                            ) : (payload?.usd?.upcomingHighImpact ?? []).length === 0 ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={6} className="h-20 text-center text-sm text-slate-600">
                                  No upcoming high/critical USD events in the next 7 days.
                                </TableCell>
                              </TableRow>
                            ) : (
                              (payload?.usd?.upcomingHighImpact ?? []).map((row) => (
                                <TableRow key={row.id} className="hover:bg-slate-50">
                                  <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.eventDate}</TableCell>
                                  <TableCell className="px-3 py-2 font-mono text-xs text-slate-700">{row.eventTime ?? '—'}</TableCell>
                                  <TableCell className="px-3 py-2 text-xs text-slate-700">{row.eventName}</TableCell>
                                  <TableCell className="px-3 py-2">
                                    <ToneBadge tone={row.impactLevel === 'Critical' ? 'rose' : 'amber'}>{row.impactLevel}</ToneBadge>
                                  </TableCell>
                                  <TableCell className="px-3 py-2">
                                    <ToneBadge tone="cyan">{row.status}</ToneBadge>
                                  </TableCell>
                                  <TableCell className="px-3 py-2">
                                    {row.sourceUrl ? (
                                      <a className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline" href={row.sourceUrl} target="_blank" rel="noreferrer">
                                        Link
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

                    <TabsContent value="rates" className="m-0">
                      <div className="w-full overflow-x-auto">
                        <Table>
                          <TableHeader className="bg-slate-50">
                            <TableRow className="hover:bg-transparent">
                              {['Pair', 'Differential', 'Note'].map((h) => (
                                <TableHead key={h} className="whitespace-nowrap px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                                  {h}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(payload?.intermarket?.usdSpreads ?? []).length === 0 ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={3} className="h-20 text-center text-sm text-slate-600">
                                  No rate history yet to compute spreads.
                                </TableCell>
                              </TableRow>
                            ) : (
                              (payload?.intermarket?.usdSpreads ?? []).map((row) => {
                                const d = row.differential;
                                const tone: Tone = d == null ? 'slate' : d > 0 ? 'emerald' : d < 0 ? 'rose' : 'slate';
                                return (
                                  <TableRow key={row.pair} className="hover:bg-slate-50">
                                    <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.pair}</TableCell>
                                    <TableCell className="px-3 py-2">
                                      <ToneBadge tone={tone}>{fmt(d ?? null, 2, '%')}</ToneBadge>
                                    </TableCell>
                                    <TableCell className="px-3 py-2 text-xs text-slate-700">USD rate − quote rate</TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="p-4">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                          Positive differentials tend to support USD and higher real-rate regimes, which often pressures gold. This page applies that logic as a macro regime indicator.
                        </div>
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

