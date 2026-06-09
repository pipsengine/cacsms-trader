'use client';

import { useCallback, useEffect, useState } from 'react';
import { Minus, Plus, RefreshCw, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type RiskSettings = {
  dailyTradeLimitEnabled: boolean;
  maxTradesPerDay: number;
  tradesOpenedToday: number;
  remainingTradesToday: number | null;
};

export function ExecutionRiskSettingsPanel(props: {
  apiPath?: string;
  className?: string;
}) {
  const apiPath = props.apiPath ?? '/api/autonomous-pipeline/risk-settings';
  const [settings, setSettings] = useState<RiskSettings | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftMax, setDraftMax] = useState(5);
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
      setDraftMax(next.maxTradesPerDay);
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

  const saveSettings = async (override?: { dailyTradeLimitEnabled?: boolean; maxTradesPerDay?: number }) => {
    const nextEnabled = override?.dailyTradeLimitEnabled ?? draftEnabled;
    const nextMax = override?.maxTradesPerDay ?? draftMax;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dailyTradeLimitEnabled: nextEnabled,
          maxTradesPerDay: nextMax,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(String(payload.error ?? 'Unable to save risk settings.'));
      }
      const next = payload.settings as RiskSettings;
      setSettings(next);
      setDraftEnabled(next.dailyTradeLimitEnabled);
      setDraftMax(next.maxTradesPerDay);
      setMessage(
        next.dailyTradeLimitEnabled
          ? `Daily trade limit enabled at ${next.maxTradesPerDay} trades per day.`
          : 'Daily trade limit disabled — autonomous execution is open for demo validation.',
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save risk settings.');
    } finally {
      setSaving(false);
    }
  };

  const dirty = settings
    ? draftEnabled !== settings.dailyTradeLimitEnabled || draftMax !== settings.maxTradesPerDay
    : false;

  return (
    <Card className={cn('border-slate-200 bg-white shadow-sm', props.className)}>
      <CardHeader className="border-b border-slate-100 py-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Daily trade limit
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => void loadSettings()} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Trades today</p>
            <p className="mt-1 font-mono text-xl text-slate-950">{settings?.tradesOpenedToday ?? '—'}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Remaining today</p>
            <p className="mt-1 font-mono text-xl text-slate-950">
              {settings?.remainingTradesToday == null ? 'Open' : settings.remainingTradesToday}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Gate status</p>
            <p className={cn('mt-1 text-sm font-medium', draftEnabled ? 'text-amber-700' : 'text-emerald-700')}>
              {draftEnabled ? 'Limit enforced' : 'Limit disabled'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-3">
          <div>
            <p className="text-sm font-medium text-slate-900">Enable daily trade limit</p>
            <p className="text-xs text-slate-500">Disable this to keep demo autonomous trading open while validating execution.</p>
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
          <p className="text-sm font-medium text-slate-900">Maximum trades per day</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!draftEnabled || draftMax <= 1}
              onClick={() => setDraftMax((current) => Math.max(1, current - 1))}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <input
              type="number"
              min={1}
              max={999}
              disabled={!draftEnabled}
              value={draftMax}
              onChange={(event) => setDraftMax(Math.min(999, Math.max(1, Number(event.target.value) || 1)))}
              className="h-10 w-24 rounded-md border border-slate-200 bg-white px-3 text-center font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!draftEnabled || draftMax >= 999}
              onClick={() => setDraftMax((current) => Math.min(999, current + 1))}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <div className="flex flex-wrap gap-2">
              {[5, 10, 20, 50].map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!draftEnabled}
                  onClick={() => setDraftMax(preset)}
                >
                  {preset}
                </Button>
              ))}
            </div>
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
            Disable limit (open trading)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
