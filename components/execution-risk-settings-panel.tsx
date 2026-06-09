'use client';

import { useCallback, useEffect, useState } from 'react';
import { Minus, Plus, RefreshCw, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type RiskSettings = {
  dailyTradeLimitEnabled: boolean;
  maxTradesPerDay: number;
  tradesPerSymbolPerDay: number;
  symbolBasedTradeLimit: boolean;
  activeSymbolCount: number;
  activeSymbols: string[];
  maxOpenPositions: number;
  openPositions: number;
  remainingOpenPositions: number;
  tradesOpenedToday: number;
  remainingTradesToday: number | null;
  openExposureDrawdownFraction: number;
  dailyDrawdownBudgetUsd: number;
  openExposureBudgetUsd: number;
  riskPerPositionUsd: number;
};

export function ExecutionRiskSettingsPanel(props: {
  apiPath?: string;
  className?: string;
}) {
  const apiPath = props.apiPath ?? '/api/autonomous-pipeline/risk-settings';
  const [settings, setSettings] = useState<RiskSettings | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftPerSymbol, setDraftPerSymbol] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiPath, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(String(payload.error ?? 'Unable to load risk settings.'));
      }
      const next = payload.settings as RiskSettings;
      setSettings(next);
      setDraftEnabled(next.dailyTradeLimitEnabled);
      setDraftPerSymbol(next.tradesPerSymbolPerDay);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load risk settings.');
    } finally {
      setLoading(false);
    }
  }, [apiPath]);

  useEffect(() => {
    void loadSettings();
    const interval = window.setInterval(() => void loadSettings(), 15000);
    return () => window.clearInterval(interval);
  }, [loadSettings]);

  const saveSettings = async (override?: {
    dailyTradeLimitEnabled?: boolean;
    tradesPerSymbolPerDay?: number;
  }) => {
    const nextEnabled = override?.dailyTradeLimitEnabled ?? draftEnabled;
    const nextPerSymbol = override?.tradesPerSymbolPerDay ?? draftPerSymbol;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dailyTradeLimitEnabled: nextEnabled,
          tradesPerSymbolPerDay: nextPerSymbol,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(String(payload.error ?? 'Unable to save risk settings.'));
      }
      const next = payload.settings as RiskSettings;
      setSettings(next);
      setDraftEnabled(next.dailyTradeLimitEnabled);
      setDraftPerSymbol(next.tradesPerSymbolPerDay);
      setMessage(
        next.dailyTradeLimitEnabled
          ? `Limits active — ${next.tradesPerSymbolPerDay} trade(s) per symbol × ${next.activeSymbolCount} symbols = ${next.maxTradesPerDay} daily trades.`
          : 'Daily trade limit disabled — autonomous execution is open for demo validation.',
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save risk settings.');
    } finally {
      setSaving(false);
    }
  };

  const dirty = settings
    ? draftEnabled !== settings.dailyTradeLimitEnabled || draftPerSymbol !== settings.tradesPerSymbolPerDay
    : false;

  return (
    <Card className={cn('border-slate-200 bg-white shadow-sm', props.className)}>
      <CardHeader className="border-b border-slate-100 py-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Risk limits — open positions vs daily trades
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => void loadSettings()} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4">
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

        <div className="rounded-md border border-blue-200 bg-blue-50/70 p-3">
          <p className="text-sm font-medium text-blue-900">Open position capacity (drawdown-based)</p>
          <p className="mt-1 text-xs text-blue-800">
            Uses {Math.round((settings?.openExposureDrawdownFraction ?? 0.5) * 100)}% of the daily drawdown budget
            (${settings?.openExposureBudgetUsd?.toFixed(0) ?? '—'} of ${settings?.dailyDrawdownBudgetUsd?.toFixed(0) ?? '—'})
            divided by risk per position (${settings?.riskPerPositionUsd?.toFixed(2) ?? '—'}).
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-blue-100 bg-white px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Open now</p>
              <p className="mt-1 font-mono text-xl text-slate-950">{settings?.openPositions ?? '—'}</p>
            </div>
            <div className="rounded-md border border-blue-100 bg-white px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Max open</p>
              <p className="mt-1 font-mono text-xl text-slate-950">{settings?.maxOpenPositions ?? '—'}</p>
            </div>
            <div className="rounded-md border border-blue-100 bg-white px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Slots left</p>
              <p className="mt-1 font-mono text-xl text-slate-950">{settings?.remainingOpenPositions ?? '—'}</p>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-sm font-medium text-amber-900">Daily trades (symbol-based)</p>
          <p className="mt-1 text-xs text-amber-800">
            Total daily trades = trades per symbol × active symbols
            ({settings?.activeSymbolCount ?? '—'}
            {settings?.activeSymbols?.length ? `: ${settings.activeSymbols.slice(0, 4).join(', ')}${settings.activeSymbols.length > 4 ? '…' : ''}` : ''}).
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-amber-100 bg-white px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Trades today</p>
              <p className="mt-1 font-mono text-xl text-slate-950">{settings?.tradesOpenedToday ?? '—'}</p>
            </div>
            <div className="rounded-md border border-amber-100 bg-white px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Max today</p>
              <p className="mt-1 font-mono text-xl text-slate-950">{settings?.maxTradesPerDay ?? '—'}</p>
            </div>
            <div className="rounded-md border border-amber-100 bg-white px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Remaining</p>
              <p className="mt-1 font-mono text-xl text-slate-950">
                {settings?.remainingTradesToday == null ? 'Open' : settings.remainingTradesToday}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-3">
          <div>
            <p className="text-sm font-medium text-slate-900">Enable daily trade limit</p>
            <p className="text-xs text-slate-500">Open position capacity stays drawdown-based even when this is disabled.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draftEnabled}
            onClick={() => setDraftEnabled((current) => !current)}
            className={cn(
              'relative h-7 w-12 rounded-full transition-colors',
              draftEnabled ? 'bg-amber-500' : 'bg-emerald-500',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform',
                draftEnabled ? 'left-5' : 'left-0.5',
              )}
            />
          </button>
        </div>

        <div className={cn('space-y-2', !draftEnabled && 'opacity-50')}>
          <p className="text-sm font-medium text-slate-900">Trades per symbol per day</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!draftEnabled || draftPerSymbol <= 1}
              onClick={() => setDraftPerSymbol((current) => Math.max(1, current - 1))}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <input
              type="number"
              min={1}
              max={20}
              disabled={!draftEnabled}
              value={draftPerSymbol}
              onChange={(event) => setDraftPerSymbol(Math.min(20, Math.max(1, Number(event.target.value) || 1)))}
              className="h-10 w-24 rounded-md border border-slate-200 bg-white px-3 text-center font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!draftEnabled || draftPerSymbol >= 20}
              onClick={() => setDraftPerSymbol((current) => Math.min(20, current + 1))}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <p className="text-xs text-slate-500">
              Computed daily cap: {draftPerSymbol} × {settings?.activeSymbolCount ?? '—'} ={' '}
              {draftPerSymbol * (settings?.activeSymbolCount ?? 0)} trades
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void saveSettings()} disabled={saving || (!dirty && !loading)}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              setDraftEnabled(false);
              void saveSettings({ dailyTradeLimitEnabled: false });
            }}
          >
            Disable daily trade limit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
