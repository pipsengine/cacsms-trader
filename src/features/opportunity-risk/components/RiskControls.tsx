import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge, Card, Tabs } from '../../../components/UI';
import { saveRiskConfigNow } from '../services/riskStore';
import type { AccountSummary, RiskConfig, RiskStateResponse } from '../types';
import { human, pct } from './format';

type Field = { key: string; label: string; unit?: string; step?: number; kind?: 'number' | 'enum' | 'bool'; options?: string[] };

const GROUPS: Record<string, Field[]> = {
  Portfolio: [
    { key: 'riskPerTradePct', label: 'Risk per trade', unit: '%', step: 0.05 },
    { key: 'maxPortfolioRiskPct', label: 'Portfolio risk (open + pending + new)', unit: '%', step: 0.1 },
    { key: 'maxCurrencyRiskPct', label: 'Net exposure per currency / XAU', unit: '%', step: 0.1 },
    { key: 'maxClusterRiskPct', label: 'Correlated cluster risk', unit: '%', step: 0.1 },
    { key: 'correlationThreshold', label: 'Correlation threshold (ρ)', step: 0.05 },
    { key: 'maxConcurrentPositions', label: 'Maximum positions per account', step: 1 },
    { key: 'allowSameSymbol', label: 'Allow a second trade on the same symbol', kind: 'bool' },
    { key: 'riskBasis', label: 'Risk basis', kind: 'enum', options: ['MIN_BALANCE_EQUITY', 'EQUITY', 'BALANCE'] },
    { key: 'minRiskFraction', label: 'Minimum size as fraction of target risk', step: 0.05 },
  ],
  Safety: [
    { key: 'maxDailyLossPct', label: 'Daily loss (realized + floating + open risk)', unit: '%', step: 0.1 },
    { key: 'maxDrawdownPct', label: 'Drawdown from peak equity', unit: '%', step: 0.5 },
    { key: 'minMarginLevelPct', label: 'Minimum margin level after trade', unit: '%', step: 10 },
    { key: 'maxMarginUsePct', label: 'Maximum margin in use after trade', unit: '%', step: 1 },
    { key: 'marginFormulaBuffer', label: 'Formula margin buffer (non-attached accounts)', unit: '×', step: 0.1 },
    { key: 'propSafetyPct', label: 'Prop-rule safety reserve', unit: '%', step: 1 },
  ],
  Setup: [
    { key: 'minConfidence', label: 'Minimum Stage 7 confidence', step: 1 },
    { key: 'minSetupScore', label: 'Minimum setup score', step: 1 },
    { key: 'minRR', label: 'Minimum reward : risk', unit: 'R', step: 0.1 },
    { key: 'minStopAtr', label: 'Minimum stop distance', unit: 'ATR', step: 0.05 },
    { key: 'maxStopAtr', label: 'Maximum stop distance', unit: 'ATR', step: 0.5 },
    { key: 'maxSpreadAtr', label: 'Maximum spread', unit: 'ATR', step: 0.01 },
    { key: 'maxSpreadStopPct', label: 'Maximum spread as % of stop', unit: '%', step: 1 },
    { key: 'slippageAtr', label: 'Slippage allowance', unit: 'ATR', step: 0.01 },
    { key: 'maxDriftAtr', label: 'Maximum drift from confirmation', unit: 'ATR', step: 0.1 },
    { key: 'slBufferAtr', label: 'Stop buffer beyond invalidation', unit: 'ATR', step: 0.05 },
    { key: 'tpBufferAtr', label: 'Target buffer inside boundary', unit: 'ATR', step: 0.05 },
  ],
  Timing: [
    { key: 'setupTtlMin', label: 'Setup lifetime after Stage 7 confirmation', unit: 'min', step: 15 },
    { key: 'h1MaxAgeMin', label: 'Maximum age of last closed H1', unit: 'min', step: 10 },
    { key: 'maxTickAgeSec', label: 'Maximum quote age', unit: 's', step: 5 },
    { key: 'fxMaxAgeSec', label: 'Maximum FX-rate age', unit: 's', step: 30 },
    { key: 'accountMaxAgeSec', label: 'Maximum account snapshot age', unit: 's', step: 10 },
    { key: 'authTtlSec', label: 'Authorization validity', unit: 's', step: 30 },
    { key: 'maxEntryDeviationAtr', label: 'Maximum entry deviation', unit: 'ATR', step: 0.01 },
    { key: 'newsWindowMin', label: 'News blackout window (prop rules)', unit: 'min', step: 5 },
    { key: 'weekendCutoffHours', label: 'Weekend cut-off before close', unit: 'h', step: 0.5 },
    { key: 'overnightCutoffUtcHour', label: 'Overnight cut-off (UTC hour)', step: 1 },
  ],
};

type Util = { used: number | null; limit: number; label: string; inverse?: boolean };

function utilFor(key: string, a: AccountSummary | undefined): Util | null {
  if (!a) return null;
  const u = a.utilization;
  if (key === 'maxPortfolioRiskPct') return { ...u.portfolio, label: `${pct(u.portfolio.used)} committed` };
  if (key === 'maxDailyLossPct') return { ...u.dailyLoss, label: `${pct(u.dailyLoss.used)} lost today` };
  if (key === 'maxDrawdownPct') return { ...u.drawdown, label: `${pct(u.drawdown.used)} from peak` };
  if (key === 'maxConcurrentPositions') return { ...u.positions, label: `${u.positions.used ?? 0} of ${u.positions.limit}` };
  if (key === 'minMarginLevelPct')
    return { ...u.marginLevel, inverse: true, label: u.marginLevel.used == null ? 'no margin in use' : `level ${u.marginLevel.used.toFixed(0)}%` };
  if (key === 'maxCurrencyRiskPct') {
    const top = a.currencies[0];
    return { used: top ? Math.abs(top.netPct) : 0, limit: top?.limit ?? 0, label: top ? `${top.currency} ${top.netPct > 0 ? '+' : ''}${pct(top.netPct)}` : 'no exposure' };
  }
  return null;
}

function UtilBar({ u }: { u: Util }) {
  const frac = u.used == null || !u.limit ? 0 : u.inverse ? Math.min(1, u.limit / Math.max(u.used, 1e-9)) : Math.min(1, u.used / u.limit);
  const tone = frac >= 1 ? 'red' : frac >= 0.75 ? 'amber' : 'green';
  return (
    <span className="or-util" title={u.label}>
      <i className={tone} style={{ width: `${Math.max(2, frac * 100)}%` }} />
      <small>{u.label}</small>
    </span>
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function RiskControls({ state, account }: { state: RiskStateResponse | null; account?: AccountSummary }) {
  const [group, setGroup] = useState('Portfolio');
  const [draft, setDraft] = useState<RiskConfig>({});
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const cfg = state?.config ?? {};
  const critical = useMemo(() => new Set(state?.criticalKeys ?? []), [state?.criticalKeys]);
  const dirty = Object.keys(draft).filter((k) => !same(draft[k], cfg[k]));
  const dirtyCritical = dirty.filter((k) => critical.has(k));

  const value = (k: string) => (k in draft ? draft[k] : cfg[k]);

  const save = async () => {
    if (!dirty.length) return;
    if (dirtyCritical.length && !reason.trim()) {
      setMsg({ tone: 'err', text: `A reason is required for critical changes (${dirtyCritical.join(', ')}).` });
      return;
    }
    setSaving(true);
    try {
      const changes = Object.fromEntries(dirty.map((k) => [k, draft[k]]));
      const r = await saveRiskConfigNow(changes, reason.trim());
      setDraft({});
      setReason('');
      setMsg({
        tone: 'ok',
        text: r.changed.length
          ? `Saved ${r.changed.join(', ')}${r.critical ? ' (critical)' : ''} · config ${r.hash} · re-evaluated. Existing authorizations keep their original terms.`
          : 'No change.',
      });
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const reset = (k: string) => setDraft((d) => ({ ...d, [k]: state?.defaults?.[k] as RiskConfig[string] }));

  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>Risk Controls</h3>
          <p>Configurable limits · stored in dbo.app_settings (risk.config) · every change audited · critical changes never alter issued authorizations</p>
        </div>
        <Badge tone="blue">config {state?.configHash ?? '—'}</Badge>
      </div>
      {state?.configErrors?.length ? (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>Stored configuration invalid — defaults in force: {state.configErrors.join('; ')}</span>
        </div>
      ) : null}
      <Tabs items={Object.keys(GROUPS)} active={group} onChange={setGroup} idPrefix="or-cfg" label="Risk control group" />
      <div className="or-controls">
        {GROUPS[group].map((f) => {
          const v = value(f.key);
          const b = state?.bounds?.[f.key];
          const def = state?.defaults?.[f.key];
          const u = utilFor(f.key, account);
          const changed = f.key in draft && !same(draft[f.key], cfg[f.key]);
          return (
            <div key={f.key} className={`or-control${changed ? ' changed' : ''}`}>
              <label htmlFor={`or-${f.key}`}>
                <b>{f.label}</b>
                <small>
                  {critical.has(f.key) ? <span className="or-crit">critical</span> : null}
                  default {typeof def === 'boolean' ? (def ? 'on' : 'off') : String(def ?? '—')}
                  {b ? ` · ${b[0]}–${b[1]}` : ''}
                  {!same(v, def) ? (
                    <button type="button" className="cs-link" onClick={() => reset(f.key)}>
                      reset
                    </button>
                  ) : null}
                </small>
              </label>
              <span className="or-input">
                {f.kind === 'bool' ? (
                  <input id={`or-${f.key}`} type="checkbox" checked={Boolean(v)} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))} />
                ) : f.kind === 'enum' ? (
                  <select id={`or-${f.key}`} value={String(v ?? '')} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}>
                    {f.options?.map((o) => (
                      <option key={o} value={o}>
                        {human(o)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`or-${f.key}`}
                    type="number"
                    step={f.step}
                    min={b?.[0]}
                    max={b?.[1]}
                    value={v == null ? '' : String(v)}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value === '' ? (cfg[f.key] as number) : Number(e.target.value) }))}
                  />
                )}
                {f.unit ? <small>{f.unit}</small> : null}
              </span>
              {u ? <UtilBar u={u} /> : <span />}
            </div>
          );
        })}
      </div>
      <div className="or-save">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dirtyCritical.length ? 'Reason (required for critical changes)' : 'Reason (optional)'} aria-label="Change reason" />
        <button type="button" className="hr-run" disabled={!dirty.length || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : dirty.length ? `Save ${dirty.length} change${dirty.length > 1 ? 's' : ''}` : 'No changes'}
        </button>
        {dirty.length > 0 && (
          <button type="button" className="hr-run" onClick={() => setDraft({})}>
            Discard
          </button>
        )}
      </div>
      {msg && <div className={`hr-banner ${msg.tone === 'err' ? 'err' : ''}`}>{msg.text}</div>}
      <p className="hr-reason">
        Utilization is shown for {account ? `${account.name} (${account.accountClass} · ${account.currency})` : 'the attached account'}. News calendar:{' '}
        {(cfg.newsCalendar as { mode?: string } | undefined)?.mode ?? 'NONE'} — without a verified calendar, prop profiles that prohibit news trading fail closed.
      </p>
      <h4 className="hr-sub">Change audit</h4>
      {state?.audit?.length ? (
        <div className="table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Changed</th>
                <th>Before → after</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {state.audit.slice(0, 10).map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.changedAt).toLocaleString()}</td>
                  <td>{a.actor}</td>
                  <td>
                    {a.changedKeys} {a.critical ? <Badge tone="amber">critical</Badge> : null}
                  </td>
                  <td className="hv-wrap">
                    <small>
                      {Object.keys(a.after)
                        .map((k) => `${k}: ${JSON.stringify(a.before[k])} → ${JSON.stringify(a.after[k])}`)
                        .join(' · ')}{' '}
                      <span className="muted">
                        ({a.beforeHash} → {a.afterHash})
                      </span>
                    </small>
                  </td>
                  <td className="hv-wrap">
                    <small>{a.reason || '—'}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hr-reason">No configuration changes recorded — all limits are at their defaults.</p>
      )}
    </Card>
  );
}
