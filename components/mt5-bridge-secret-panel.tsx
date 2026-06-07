'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type BridgeSecretState = {
  secret: string;
  masked: string;
  source: 'database' | 'environment' | 'unset';
  configured: boolean;
  updatedAt: string | null;
  bridgeUrl: string;
};

type ToastTone = 'success' | 'error' | 'info';

export function Mt5BridgeSecretPanel(props: { compact?: boolean }) {
  const [status, setStatus] = useState<BridgeSecretState | null>(null);
  const [draftSecret, setDraftSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'generate' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);

  const showToast = (tone: ToastTone, message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 5000);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/mt5/bridge-secret', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error ?? `Failed with HTTP ${response.status}`);
      }
      setStatus({
        secret: payload.secret ?? '',
        masked: payload.masked ?? '—',
        source: payload.source ?? 'unset',
        configured: Boolean(payload.configured),
        updatedAt: payload.updatedAt ?? null,
        bridgeUrl: payload.bridgeUrl ?? 'http://127.0.0.1:8787',
      });
      setDraftSecret((current) => current || payload.secret || '');
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to load bridge secret.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onGenerate = async () => {
    setBusy('generate');
    try {
      const response = await fetch('/api/mt5/bridge-secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate' }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error ?? `Generate failed with HTTP ${response.status}`);
      }
      setDraftSecret(payload.secret ?? '');
      showToast('success', payload.message ?? 'Bridge secret generated.');
    } catch (generateError) {
      showToast('error', generateError instanceof Error ? generateError.message : 'Failed to generate bridge secret.');
    } finally {
      setBusy(null);
    }
  };

  const onApply = async () => {
    setBusy('apply');
    try {
      const response = await fetch('/api/mt5/bridge-secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', secret: draftSecret }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error ?? `Apply failed with HTTP ${response.status}`);
      }
      setStatus((current) => ({
        secret: payload.secret ?? draftSecret,
        masked: payload.masked ?? current?.masked ?? '—',
        source: payload.source ?? 'database',
        configured: Boolean(payload.configured),
        updatedAt: payload.updatedAt ?? current?.updatedAt ?? null,
        bridgeUrl: current?.bridgeUrl ?? 'http://127.0.0.1:8787',
      }));
      setDraftSecret(payload.secret ?? draftSecret);
      showToast('success', payload.message ?? 'Bridge secret applied.');
    } catch (applyError) {
      showToast('error', applyError instanceof Error ? applyError.message : 'Failed to apply bridge secret.');
    } finally {
      setBusy(null);
    }
  };

  const onCopy = async () => {
    const value = draftSecret || status?.secret || '';
    if (!value) {
      showToast('error', 'No bridge secret to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showToast('success', 'Bridge secret copied. Paste it into the EA BridgeSecret input in MT5.');
    } catch {
      showToast('error', 'Clipboard copy failed.');
    }
  };

  return (
    <Card className={cn('bg-white border-slate-200 shadow-sm shadow-slate-900/5', props.compact && 'border-blue-200')}>
      <CardHeader className={cn('border-b border-slate-200', props.compact ? 'py-3' : 'py-4')}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-blue-700" />
            MT5 Bridge Secret
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => void onGenerate()} disabled={busy !== null}>
              Generate
            </Button>
            <Button size="sm" onClick={() => void onApply()} disabled={busy !== null || draftSecret.trim().length < 8}>
              <ShieldCheck className="h-4 w-4" />
              Apply
            </Button>
            <Button variant="outline" size="sm" onClick={() => void onCopy()} disabled={!draftSecret && !status?.secret}>
              <Copy className="h-4 w-4" />
              Copy
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn('space-y-3', props.compact ? 'p-3' : 'p-4')}>
        {error ? <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}
        <p className="text-xs leading-5 text-slate-600">
          This secret is sent by the EA as <span className="font-mono">BridgeSecret</span> and validated by the MT5 bridge as{' '}
          <span className="font-mono">X-Cacsms-Secret</span>. Generate it here, apply it to the portal/bridge, then paste the same value into MT5.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Active secret</div>
            <div className="mt-1 font-mono text-sm text-slate-900">{status?.masked ?? '—'}</div>
            <div className="mt-1 text-xs text-slate-500">Source: {status?.source ?? 'unset'}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 md:col-span-2">
            <label className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Draft / EA value</label>
            <input
              className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 font-mono text-xs text-slate-800 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              value={draftSecret}
              onChange={(event) => setDraftSecret(event.target.value)}
              placeholder="mt5_..."
            />
          </div>
        </div>
        <div className="text-xs text-slate-500">
          Bridge URL: <span className="font-mono text-slate-700">{status?.bridgeUrl ?? 'http://127.0.0.1:8787'}</span>
          {status?.updatedAt ? <> · Updated {new Date(status.updatedAt).toLocaleString()}</> : null}
        </div>
        {toast ? (
          <div
            className={cn(
              'rounded-md border p-3 text-sm',
              toast.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
              toast.tone === 'error' && 'border-rose-200 bg-rose-50 text-rose-800',
              toast.tone === 'info' && 'border-blue-200 bg-blue-50 text-blue-800',
            )}
          >
            {toast.message}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
