'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BarChart3, Loader2, Menu, RefreshCw, Scale, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TraderSidebar } from '@/components/trader-sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type Tone = 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'slate';
type Preset = 'balanced' | 'rates_led' | 'data_led';

type BiasRow = {
  currency: string;
  score: number;
  confidence: number;
  components: {
    inflation: number;
    employment: number;
    growth: number;
    policy: number;
    carry: number;
    riskPenalty: number;
  };
  evidence: {
    horizonDays: number;
    eventCounts: { inflation: number; employment: number; growth: number; policy: number };
    topDrivers: Array<{
      id: string;
      currency: string;
      category: string;
      type: string;
      eventDate: string;
      eventName: string;
      impactLevel: string;
      surpriseValue: number;
      normalizedImpact: number;
      contribution: number;
      actualValue: string | null;
      forecastValue: string | null;
      previousValue: string | null;
      sourceUrl: string | null;
    }>;
    upcomingRiskEvents: Array<{
      id: string;
      currency: string;
      eventDate: string;
      eventTime: string | null;
      utcEventTime: string | null;
      eventName: string;
      impactLevel: string;
      status: string;
      tradeRestrictionRequired: boolean;
      restrictionStartTime: string | null;
      restrictionEndTime: string | null;
      sourceUrl: string | null;
    }>;
  };
  rates: null | {
    centralBank: string | null;
    releaseDate: string;
    releaseTime: string | null;
    actualRate: number | null;
    previousRate: number | null;
    rateChange: number | null;
    surprise: number | null;
    bias: string | null;
    fetchedAt: string;
  };
};

type Payload = {
  ok: boolean;
  generatedAt: string;
  error?: string;
  horizonDays: number;
  preset: Preset;
  summary?: {
    strongestBullish: { currency: string; score: number } | null;
    strongestBearish: { currency: string; score: number } | null;
    highestConfidence: { currency: string; confidence: number } | null;
  };
  rows: BiasRow[];
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

function toneForScore(score: number): Tone {
  if (score >= 35) return 'emerald';
  if (score >= 15) return 'cyan';
  if (score <= -35) return 'rose';
  if (score <= -15) return 'amber';
  return 'slate';
}

function bgForTone(tone: Tone): string {
  if (tone === 'emerald') return 'border-emerald-200 bg-emerald-100';
  if (tone === 'cyan') return 'border-cyan-200 bg-cyan-100';
  if (tone === 'amber') return 'border-amber-200 bg-amber-100';
  if (tone === 'rose') return 'border-rose-200 bg-rose-100';
  if (tone === 'violet') return 'border-violet-200 bg-violet-100';
  return 'border-slate-200 bg-slate-100';
}

function fmtNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function fmtIso(value: string | null | undefined): string {
  const ts = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

const majorCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'] as const;
const horizonButtons = [90, 180, 365] as const;
const presetButtons: Array<{ preset: Preset; label: string }> = [
  { preset: 'balanced', label: 'Balanced' },
  { preset: 'rates_led', label: 'Rates-led' },
  { preset: 'data_led', label: 'Data-led' },
];

export default function FundamentalBiasScoringPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [horizonDays, setHorizonDays] = useState<(typeof horizonButtons)[number]>(180);
  const [preset, setPreset] = useState<Preset>('balanced');
  const [activeTab, setActiveTab] = useState<'drivers' | 'risk'>('drivers');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/fundamentals/bias-scoring?horizonDays=${encodeURIComponent(String(horizonDays))}&preset=${encodeURIComponent(preset)}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await readJson<Payload>(res);
      setPayload(data);
      if (!data.ok) setError(data.error ?? 'Failed to load bias scoring.');
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : 'Failed to load bias scoring.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [horizonDays, preset]);

  const byCurrency = useMemo(() => {
    const map = new Map<string, BiasRow>();
    for (const row of payload?.rows ?? []) {
      map.set(row.currency, row);
    }
    return map;
  }, [payload?.rows]);

  const selected = byCurrency.get(selectedCurrency) ?? null;

  const strongestBullish = payload?.summary?.strongestBullish ?? null;
  const strongestBearish = payload?.summary?.strongestBearish ?? null;
  const highestConfidence = payload?.summary?.highestConfidence ?? null;

  const componentChartData = useMemo(() => {
    if (!selected) return [];
    const items = [
      { key: 'inflation', label: 'Inflation', value: selected.components.inflation },
      { key: 'employment', label: 'Employment', value: selected.components.employment },
      { key: 'growth', label: 'Growth', value: selected.components.growth },
      { key: 'policy', label: 'Policy', value: selected.components.policy },
      { key: 'carry', label: 'Carry', value: selected.components.carry },
      { key: 'risk', label: 'Risk', value: selected.components.riskPenalty },
    ];
    return items.map((x) => ({
      ...x,
      tone: toneForScore(x.value),
      fill:
        x.value > 0 ? '#16a34a'
        : x.value < 0 ? '#e11d48'
          : '#64748b',
    }));
  }, [selected]);

  return (
    <div className="macro-light flex h-screen overflow-hidden bg-white text-slate-900 font-sans">
      <TraderSidebar bridgeOnline={false} mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />

      <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
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
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">Fundamental Bias Scoring</h1>
              <p className="text-xs font-mono uppercase tracking-wider text-indigo-700">Cross-currency bias derived from stored macro surprises, policy and carry</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50">
          <main className="space-y-5 p-4 md:p-6 lg:p-8">
            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
            ) : null}

            <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Card className="border-slate-200 bg-emerald-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <TrendingUp className="h-4 w-4 text-emerald-700" /> Strongest Bullish
                  </CardTitle>
                  <div className="text-xs text-slate-600">{strongestBullish ? `${strongestBullish.currency} (${fmtNumber(strongestBullish.score)})` : '—'}</div>
                </CardHeader>
              </Card>

              <Card className="border-slate-200 bg-rose-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <TrendingDown className="h-4 w-4 text-rose-700" /> Strongest Bearish
                  </CardTitle>
                  <div className="text-xs text-slate-600">{strongestBearish ? `${strongestBearish.currency} (${fmtNumber(strongestBearish.score)})` : '—'}</div>
                </CardHeader>
              </Card>

              <Card className="border-slate-200 bg-cyan-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <ShieldAlert className="h-4 w-4 text-cyan-700" /> Highest Confidence
                  </CardTitle>
                  <div className="text-xs text-slate-600">{highestConfidence ? `${highestConfidence.currency} (${highestConfidence.confidence}%)` : '—'}</div>
                </CardHeader>
              </Card>

              <Card className="border-slate-200 bg-slate-50 shadow-sm shadow-slate-900/5">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <Scale className="h-4 w-4 text-slate-700" /> Settings
                  </CardTitle>
                  <div className="text-xs text-slate-600">
                    {horizonDays}D · {preset.replace('_', '-')}
                    {payload?.generatedAt ? ` · ${fmtIso(payload.generatedAt)}` : ''}
                  </div>
                </CardHeader>
              </Card>
            </section>

            <section className="grid grid-cols-1 gap-4">
              <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <CardHeader className="border-b border-slate-200">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Controls</div>
                      <div className="mt-1 text-xs text-slate-500">Horizon changes the lookback window for macro surprises; preset changes weights.</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {horizonButtons.map((d) => (
                        <Button key={d} type="button" size="sm" variant={horizonDays === d ? 'default' : 'outline'} onClick={() => setHorizonDays(d)}>
                          {d}D
                        </Button>
                      ))}
                      <div className="h-8 w-px bg-slate-200" />
                      {presetButtons.map((p) => (
                        <Button key={p.preset} type="button" size="sm" variant={preset === p.preset ? 'default' : 'outline'} onClick={() => setPreset(p.preset)}>
                          {p.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
                    {majorCurrencies.map((cur) => {
                      const row = byCurrency.get(cur);
                      const score = row?.score ?? 0;
                      const conf = row?.confidence ?? 0;
                      const tone = toneForScore(score);
                      const active = selectedCurrency === cur;
                      return (
                        <button
                          key={cur}
                          type="button"
                          onClick={() => setSelectedCurrency(cur)}
                          className={cn(
                            'rounded-xl border px-3 py-3 text-left shadow-sm transition',
                            active ? 'border-indigo-300 bg-indigo-50 shadow-indigo-900/10' : 'border-slate-200 bg-white hover:bg-slate-50',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-mono text-xs font-semibold text-slate-900">{cur}</div>
                            <ToneBadge tone={tone}>{fmtNumber(score)}</ToneBadge>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <div className={cn('rounded-md border px-2 py-1 text-[11px] font-semibold', bgForTone(tone))}>Bias</div>
                            <ToneBadge tone="slate">{conf}%</ToneBadge>
                          </div>
                          <div className="mt-2 text-[11px] text-slate-600">Evidence</div>
                          <div className="font-mono text-xs text-slate-900">
                            {row ? row.evidence.eventCounts.inflation + row.evidence.eventCounts.employment + row.evidence.eventCounts.growth + row.evidence.eventCounts.policy : 0} events
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
                      <div className="text-sm font-semibold text-slate-950">Component Breakdown</div>
                      <div className="mt-1 text-xs text-slate-500">{selected ? `${selected.currency} score ${fmtNumber(selected.score)} · confidence ${selected.confidence}%` : '—'}</div>
                    </div>
                    <div className="inline-flex items-center gap-2">
                      <ToneBadge tone="emerald">+ bullish</ToneBadge>
                      <ToneBadge tone="rose">− bearish</ToneBadge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  {!selected ? (
                    <div className="flex h-[280px] items-center justify-center text-sm text-slate-600">No data for this currency yet.</div>
                  ) : (
                    <div className="h-[280px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={componentChartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                          <YAxis tick={{ fontSize: 10 }} width={40} domain={[-40, 40]} />
                          <Tooltip formatter={(v: any) => fmtNumber(Number(v), 1)} />
                          <Bar dataKey="value" name="Points" radius={[6, 6, 6, 6]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {selected?.rates ? (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <ToneBadge tone="violet">{selected.rates.centralBank ?? 'Central Bank'}</ToneBadge>
                        <ToneBadge tone="slate">Rate {selected.rates.actualRate == null ? '—' : `${fmtNumber(selected.rates.actualRate, 2)}%`}</ToneBadge>
                        <ToneBadge tone="slate">Δ {selected.rates.rateChange == null ? '—' : `${fmtNumber(selected.rates.rateChange, 2)}%`}</ToneBadge>
                        <ToneBadge tone="slate">{selected.rates.bias ?? '—'}</ToneBadge>
                        <span className="text-xs text-slate-600">Last decision {selected.rates.releaseDate}</span>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <CardHeader className="border-b border-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Evidence</div>
                      <div className="mt-1 text-xs text-slate-500">Top drivers and upcoming risks for the selected currency.</div>
                    </div>
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-auto">
                      <TabsList>
                        <TabsTrigger value="drivers">Drivers</TabsTrigger>
                        <TabsTrigger value="risk">Risk</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
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
                            ) : !selected || (selected.evidence.topDrivers ?? []).length === 0 ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={6} className="h-20 text-center text-sm text-slate-600">
                                  No driver events yet for {selectedCurrency}.
                                </TableCell>
                              </TableRow>
                            ) : (
                              selected.evidence.topDrivers.map((row) => {
                                const tone = toneForScore(row.contribution * 20);
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
                                    <TableCell className="px-3 py-2 font-mono text-xs text-slate-700">{fmtNumber(row.surpriseValue, 2)}</TableCell>
                                    <TableCell className="px-3 py-2">
                                      <ToneBadge tone={tone}>{fmtNumber(row.contribution * 10, 2)}</ToneBadge>
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
                              {['Date', 'Time', 'Event', 'Impact', 'Restriction', 'Source'].map((h) => (
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
                            ) : !selected || (selected.evidence.upcomingRiskEvents ?? []).length === 0 ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={6} className="h-20 text-center text-sm text-slate-600">
                                  No high-impact risks in the next 48h for {selectedCurrency}.
                                </TableCell>
                              </TableRow>
                            ) : (
                              selected.evidence.upcomingRiskEvents.map((row) => (
                                <TableRow key={row.id} className="hover:bg-slate-50">
                                  <TableCell className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{row.eventDate}</TableCell>
                                  <TableCell className="px-3 py-2 font-mono text-xs text-slate-700">{row.eventTime ?? '—'}</TableCell>
                                  <TableCell className="px-3 py-2 text-xs text-slate-700">{row.eventName}</TableCell>
                                  <TableCell className="px-3 py-2">
                                    <ToneBadge tone={row.impactLevel === 'Critical' ? 'rose' : 'amber'}>{row.impactLevel}</ToneBadge>
                                  </TableCell>
                                  <TableCell className="px-3 py-2">
                                    {row.tradeRestrictionRequired ? (
                                      <ToneBadge tone="rose">
                                        {row.restrictionStartTime && row.restrictionEndTime ? 'Window' : 'Required'}
                                      </ToneBadge>
                                    ) : (
                                      <ToneBadge tone="slate">None</ToneBadge>
                                    )}
                                  </TableCell>
                                  <TableCell className="px-3 py-2">
                                    {row.sourceUrl ? (
                                      <a className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline" href={row.sourceUrl} target="_blank" rel="noreferrer">
                                        <BarChart3 className="h-3.5 w-3.5" /> Investing
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

