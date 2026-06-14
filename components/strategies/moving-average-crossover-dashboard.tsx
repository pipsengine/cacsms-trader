'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRightLeft,
  LineChart,
  Menu,
  Play,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { DashboardPageFrame, DashboardPageScroll, DashboardPageShell } from '@/components/dashboard-page-frame';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  toneBadge,
  toneBody,
  toneCard,
  toneCardHeader,
  toneInsetSurface,
  toneMetric,
  toneMuted,
  toneTitle,
} from '@/lib/dashboard-card-tones';
import { SYSTEM_FOCUS_SYMBOLS } from '@/lib/focus-symbols';
import { DEFAULT_MA_CROSSOVER_CONFIG } from '@/lib/strategies/moving-average-crossover';
import type { MovingAverageCrossoverResult } from '@/lib/strategies/types';
import { cn } from '@/lib/utils';

const TIMEFRAMES = ['M15', 'H1', 'H4', 'D1'] as const;

function decisionTone(decision: string): 'emerald' | 'rose' | 'amber' {
  if (decision === 'buy') return 'emerald';
  if (decision === 'sell') return 'rose';
  return 'amber';
}

export function MovingAverageCrossoverDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState(DEFAULT_MA_CROSSOVER_CONFIG.symbol);
  const [timeframe, setTimeframe] = useState(DEFAULT_MA_CROSSOVER_CONFIG.timeframe);
  const [fastPeriod, setFastPeriod] = useState(String(DEFAULT_MA_CROSSOVER_CONFIG.fastPeriod));
  const [slowPeriod, setSlowPeriod] = useState(String(DEFAULT_MA_CROSSOVER_CONFIG.slowPeriod));
  const [maType, setMaType] = useState<'sma' | 'ema'>(DEFAULT_MA_CROSSOVER_CONFIG.maType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MovingAverageCrossoverResult | null>(null);
  const [captureMeta, setCaptureMeta] = useState<{ captureId: string | null; capturedAt: string | null } | null>(null);

  const evaluate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/strategies/moving-average-crossover/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          fastPeriod: Number(fastPeriod),
          slowPeriod: Number(slowPeriod),
          maType,
        }),
      });
      const payload = await response.json();
      if (!payload.ok) {
        setResult(null);
        setError(payload.error ?? 'Evaluation failed.');
        setCaptureMeta({ captureId: payload.captureId ?? null, capturedAt: payload.capturedAt ?? null });
        return;
      }
      setResult(payload.result);
      setCaptureMeta({ captureId: payload.captureId ?? null, capturedAt: payload.capturedAt ?? null });
    } catch (evaluateError) {
      setError(evaluateError instanceof Error ? evaluateError.message : 'Evaluation failed.');
    } finally {
      setLoading(false);
    }
  }, [fastPeriod, maType, slowPeriod, symbol, timeframe]);

  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  const recentCrosses = useMemo(
    () => (result?.series ?? []).filter((point) => point.signal !== 'none').slice(-6).reverse(),
    [result],
  );

  return (
    <DashboardPageFrame
      bridgeOnline
      mobileOpen={mobileSidebarOpen}
      onMobileOpenChange={setMobileSidebarOpen}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-50"
    >
      <DashboardPageShell className="bg-slate-50">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-md border border-slate-200 p-2 lg:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </button>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Trend Following</p>
              <h1 className="text-lg font-semibold text-slate-900">Moving Average Crossover</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/institutional-strategy-intelligence"
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Strategy overview
            </Link>
            <Button size="sm" onClick={() => void evaluate()} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Evaluate
            </Button>
          </div>
        </header>

        <DashboardPageScroll className="space-y-4 p-4 lg:p-6">
          <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Card className={cn('border shadow-sm', toneCard('violet'))}>
              <CardHeader className={cn('pb-3', toneCardHeader('violet'))}>
                <CardTitle className={cn('flex items-center gap-2 text-base', toneTitle('violet'))}>
                  <LineChart className="h-4 w-4" />
                  Strategy parameters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Symbol">
                  <select
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={symbol}
                    onChange={(event) => setSymbol(event.target.value)}
                  >
                    {SYSTEM_FOCUS_SYMBOLS.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Timeframe">
                  <select
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={timeframe}
                    onChange={(event) => setTimeframe(event.target.value as typeof timeframe)}
                  >
                    {TIMEFRAMES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Fast period">
                    <input
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                      value={fastPeriod}
                      onChange={(event) => setFastPeriod(event.target.value)}
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label="Slow period">
                    <input
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                      value={slowPeriod}
                      onChange={(event) => setSlowPeriod(event.target.value)}
                      inputMode="numeric"
                    />
                  </Field>
                </div>
                <Field label="Moving average type">
                  <select
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={maType}
                    onChange={(event) => setMaType(event.target.value as 'sma' | 'ema')}
                  >
                    <option value="ema">EMA</option>
                    <option value="sma">SMA</option>
                  </select>
                </Field>
                <Button className="w-full" onClick={() => void evaluate()} disabled={loading}>
                  <Play className="mr-2 h-4 w-4" />
                  Run crossover scan
                </Button>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Card className={cn('border shadow-sm', toneCard(decisionTone(result?.decision ?? 'wait')))}>
                  <CardContent className="pt-6">
                    <p className={cn('text-xs uppercase tracking-wide', toneMuted(decisionTone(result?.decision ?? 'wait')))}>Signal</p>
                    <p className={cn('mt-2 text-2xl font-semibold uppercase', toneMetric(decisionTone(result?.decision ?? 'wait')))}>
                      {result?.decision ?? 'wait'}
                    </p>
                  </CardContent>
                </Card>
                <Card className={cn('border shadow-sm', toneCard('cyan'))}>
                  <CardContent className="pt-6">
                    <p className={cn('text-xs uppercase tracking-wide', toneMuted('cyan'))}>Confidence</p>
                    <p className={cn('mt-2 text-2xl font-semibold', toneMetric('cyan'))}>{result?.confidence ?? 0}%</p>
                  </CardContent>
                </Card>
                <Card className={cn('border shadow-sm', toneCard(result?.trendBias === 'bullish' ? 'emerald' : result?.trendBias === 'bearish' ? 'rose' : 'amber'))}>
                  <CardContent className="pt-6">
                    <p className={cn('text-xs uppercase tracking-wide', toneMuted('slate'))}>Trend bias</p>
                    <p className="mt-2 flex items-center gap-2 text-2xl font-semibold capitalize">
                      {result?.trendBias === 'bullish' ? <TrendingUp className="h-5 w-5 text-emerald-600" /> : null}
                      {result?.trendBias === 'bearish' ? <TrendingDown className="h-5 w-5 text-rose-600" /> : null}
                      {result?.trendBias ?? 'neutral'}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card className={cn('border shadow-sm', toneCard('slate'))}>
                <CardHeader className={cn('pb-3', toneCardHeader('slate'))}>
                  <CardTitle className={cn('flex items-center gap-2 text-base', toneTitle('slate'))}>
                    <ArrowRightLeft className="h-4 w-4" />
                    Crossover analysis
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {error ? (
                    <div className={cn('rounded-lg border px-4 py-3 text-sm', toneInsetSurface('amber'), toneBody('amber'))}>
                      {error}
                    </div>
                  ) : null}
                  <div className="grid gap-3 md:grid-cols-4">
                    <Metric label="Fast MA" value={result?.fastMa?.toFixed(5) ?? '—'} />
                    <Metric label="Slow MA" value={result?.slowMa?.toFixed(5) ?? '—'} />
                    <Metric label="MA spread" value={result?.maSpread?.toFixed(5) ?? '—'} />
                    <Metric label="Candles used" value={String(result?.candleCount ?? 0)} />
                  </div>
                  <div className="space-y-2">
                    {(result?.reasons ?? ['Run evaluation to generate crossover reasoning.']).map((reason) => (
                      <p key={reason} className={cn('text-sm', toneBody('slate'))}>• {reason}</p>
                    ))}
                  </div>
                  {captureMeta?.capturedAt ? (
                    <p className={cn('text-xs', toneMuted('slate'))}>
                      Latest capture: {new Date(captureMeta.capturedAt).toLocaleString()}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className={cn('border shadow-sm', toneCard('purple'))}>
              <CardHeader className={cn('pb-3', toneCardHeader('purple'))}>
                <CardTitle className={cn('text-base', toneTitle('purple'))}>Recent crossover events</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-56 pr-3">
                  <div className="space-y-2">
                    {recentCrosses.length === 0 ? (
                      <p className={cn('text-sm', toneMuted('purple'))}>No crossover events in the current window.</p>
                    ) : recentCrosses.map((point) => (
                      <div key={`${point.index}-${point.signal}`} className={cn('rounded-lg border px-3 py-2', toneInsetSurface(point.signal === 'bullish_cross' ? 'emerald' : 'rose'))}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium capitalize">{point.signal.replace('_', ' ')}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(point.signal === 'bullish_cross' ? 'emerald' : 'rose'))}>
                            bar {point.index}
                          </span>
                        </div>
                        <p className={cn('mt-1 text-xs', toneMuted('slate'))}>
                          Close {point.close.toFixed(5)} · Fast {point.fastMa?.toFixed(5) ?? '—'} · Slow {point.slowMa?.toFixed(5) ?? '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className={cn('border shadow-sm', toneCard('violet'))}>
              <CardHeader className={cn('pb-3', toneCardHeader('violet'))}>
                <CardTitle className={cn('flex items-center gap-2 text-base', toneTitle('violet'))}>
                  <Activity className="h-4 w-4" />
                  Strategy rules
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Rule title="Entry — Buy" body="Enter long when the fast moving average crosses above the slow moving average." />
                <Rule title="Entry — Sell" body="Enter short when the fast moving average crosses below the slow moving average." />
                <Rule title="Trend filter" body="While fast MA stays above slow MA, bias remains bullish. While below, bias remains bearish." />
                <Rule title="Data source" body="Signals are computed from the latest reconstructed candles captured by the visual intelligence pipeline." />
              </CardContent>
            </Card>
          </div>
        </DashboardPageScroll>
      </DashboardPageShell>
    </DashboardPageFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2', toneInsetSurface('slate'))}>
      <p className={cn('text-[11px] uppercase tracking-wide', toneMuted('slate'))}>{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function Rule({ title, body }: { title: string; body: string }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2', toneInsetSurface('violet'))}>
      <p className="font-medium text-slate-900">{title}</p>
      <p className={cn('mt-1', toneBody('violet'))}>{body}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}
