import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, Clock3, Flame, Settings, ShieldCheck, TriangleAlert } from 'lucide-react';
import { refreshEconomicCalendar, requestEconomicRevalidation, saveEconomicPolicy } from './services/economicClient';
import { startEconomicStore, useEconomicStore } from './services/economicStore';
import type { EconEvent, EconPolicy, EconSources, Impact } from './types';
import './economic.css';

type Tab = 'calendar' | 'risk' | 'currency' | 'exposure' | 'reference' | 'history' | 'settings';
type Period = 'today' | 'tomorrow' | 'week' | 'next' | 'custom';

const ZONES = [
  ['Africa/Lagos', 'WAT (GMT+1)'],
  ['UTC', 'UTC'],
  ['Europe/London', 'London'],
  ['America/New_York', 'New York'],
  ['Asia/Tokyo', 'Tokyo'],
] as const;
const CCY = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
const HEAT_CCY = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'NZD'] as const;
const HEAT_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'XAUUSD'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const PLACE: Record<string, string> = { AU: 'Australia', US: 'United States', EU: 'Euro Area', UK: 'United Kingdom', GB: 'United Kingdom', JP: 'Japan', CH: 'Switzerland', CA: 'Canada', NZ: 'New Zealand' };
/** Liquid board drawn in the calendar. The engine still maps the full 29-instrument universe. */
const DESK: Record<string, string[]> = {
  USD: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'XAUUSD'],
  EUR: ['EURUSD', 'EURGBP', 'EURJPY', 'EURCHF', 'EURAUD', 'EURCAD'],
  GBP: ['GBPUSD', 'EURGBP', 'GBPJPY', 'GBPCHF', 'GBPAUD', 'GBPCAD'],
  JPY: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CHFJPY', 'NZDJPY'],
  CHF: ['USDCHF', 'EURCHF', 'GBPCHF', 'CHFJPY'],
  CAD: ['USDCAD', 'EURCAD', 'GBPCAD', 'CADJPY', 'AUDCAD', 'NZDCAD'],
  AUD: ['AUDUSD', 'EURAUD', 'GBPAUD', 'AUDJPY', 'AUDCHF', 'AUDCAD', 'AUDNZD', 'XAUUSD'],
  NZD: ['NZDUSD', 'EURNZD', 'GBPNZD', 'AUDNZD', 'NZDJPY', 'NZDCAD'],
};

function parts(iso: string, zone: string) {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const bag = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { y: Number(bag.year), m: Number(bag.month), d: Number(bag.day), hh: Number(bag.hour), mm: Number(bag.minute), key: `${bag.year}-${bag.month}-${bag.day}` };
}
function clock(iso: string, zone: string) {
  const p = parts(iso, zone);
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}
function dayKey(date: Date, zone: string) {
  return parts(date.toISOString(), zone).key;
}
function addDays(key: string, days: number) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
function inPeriod(iso: string, period: Period, zone: string, custom: string, today: string) {
  const key = parts(iso, zone).key;
  if (period === 'today') return key === today;
  if (period === 'tomorrow') return key === addDays(today, 1);
  if (period === 'custom') return key === custom;
  const start = new Date(`${today}T12:00:00Z`);
  const weekday = start.getUTCDay() || 7;
  const monday = addDays(today, 1 - weekday);
  const nextMonday = addDays(monday, period === 'week' ? 0 : 7);
  const end = addDays(nextMonday, 6);
  return key >= nextMonday && key <= end;
}
function surpriseLabel(e: EconEvent) {
  const s = e.surprise;
  if (!s?.available || s.rawPct == null) return '—';
  const n = s.rawPct;
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}
function surpriseTone(e: EconEvent) {
  const i = e.surprise?.interpretation;
  if (i === 'NEGATIVE_FOR_CURRENCY') return 'ei-neg';
  if (i === 'POSITIVE_FOR_CURRENCY' || (e.surprise?.available && e.surprise.rawPct === 0)) return 'ei-pos';
  return '';
}
function Stars({ impact }: { impact: Impact }) {
  const n = impact === 'HIGH' ? 3 : impact === 'MEDIUM' ? 2 : 1;
  return <span className="ei-stars">{Array.from({ length: 3 }, (_, i) => <i key={i} className={i < n ? 'on' : ''}>★</i>)}</span>;
}
function prettyDate(zone: string, stamp: number) {
  const p = parts(new Date(stamp).toISOString(), zone);
  const wd = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short' }).format(new Date(stamp));
  return `${wd}, ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}
function longWhen(iso: string, zone: string) {
  const p = parts(iso, zone);
  const wd = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long' }).format(new Date(iso));
  const zoneName = ZONES.find((z) => z[0] === zone)?.[1].split(' ')[0] || 'UTC';
  return `${wd}, ${p.d} ${MONTHS[p.m - 1]} ${p.y} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')} ${zoneName}`;
}
function Flag({ code }: { code: string }) {
  const c = code.toUpperCase();
  const common = { width: 18, height: 13, viewBox: '0 0 18 13', 'aria-hidden': true as const };
  if (c === 'US' || c === 'USD') return <svg {...common}><rect width="18" height="13" fill="#b22234" /><rect y="1" width="18" height="1" fill="#fff" /><rect y="3" width="18" height="1" fill="#fff" /><rect y="5" width="18" height="1" fill="#fff" /><rect y="7" width="18" height="1" fill="#fff" /><rect y="9" width="18" height="1" fill="#fff" /><rect y="11" width="18" height="1" fill="#fff" /><rect width="8" height="7" fill="#3c3b6e" /></svg>;
  if (c === 'EU' || c === 'EUR') return <svg {...common}><rect width="18" height="13" fill="#039" /><circle cx="9" cy="6.5" r="2.2" fill="none" stroke="#fc0" strokeWidth="0.6" /></svg>;
  if (c === 'UK' || c === 'GB' || c === 'GBP') return <svg {...common}><rect width="18" height="13" fill="#012169" /><path d="M0 0 L18 13 M18 0 L0 13" stroke="#fff" strokeWidth="2" /><path d="M0 0 L18 13 M18 0 L0 13" stroke="#c8102e" strokeWidth="1" /><path d="M9 0 V13 M0 6.5 H18" stroke="#fff" strokeWidth="3" /><path d="M9 0 V13 M0 6.5 H18" stroke="#c8102e" strokeWidth="1.6" /></svg>;
  if (c === 'JP' || c === 'JPY') return <svg {...common}><rect width="18" height="13" fill="#fff" /><circle cx="9" cy="6.5" r="3.2" fill="#bc002d" /></svg>;
  if (c === 'CH' || c === 'CHF') return <svg {...common}><rect width="18" height="13" fill="#d52b1e" /><path d="M8 3 H10 V5.5 H12.5 V7.5 H10 V10 H8 V7.5 H5.5 V5.5 H8 Z" fill="#fff" /></svg>;
  if (c === 'CA' || c === 'CAD') return <svg {...common}><rect width="18" height="13" fill="#fff" /><rect width="4.5" height="13" fill="#d52b1e" /><rect x="13.5" width="4.5" height="13" fill="#d52b1e" /><path d="M9 3 L10 5.5 L12 5 L10.5 6.5 L11.5 8.5 L9 7.2 L6.5 8.5 L7.5 6.5 L6 5 L8 5.5 Z" fill="#d52b1e" /></svg>;
  if (c === 'AU' || c === 'AUD') return <svg {...common}><rect width="18" height="13" fill="#012169" /><rect width="8" height="6" fill="#012169" /><path d="M0 0 L8 6 M8 0 L0 6" stroke="#fff" strokeWidth="1.2" /><path d="M4 0 V6 M0 3 H8" stroke="#fff" strokeWidth="2" /><path d="M4 0 V6 M0 3 H8" stroke="#c8102e" strokeWidth="1" /><circle cx="13" cy="9" r="0.7" fill="#fff" /></svg>;
  if (c === 'NZ' || c === 'NZD') return <svg {...common}><rect width="18" height="13" fill="#012169" /><path d="M0 0 L8 6 M8 0 L0 6" stroke="#fff" strokeWidth="1" /><path d="M4 0 V6 M0 3 H8" stroke="#fff" strokeWidth="2" /><path d="M4 0 V6 M0 3 H8" stroke="#c8102e" strokeWidth="1" /><circle cx="13" cy="8" r="1.3" fill="#c8102e" /></svg>;
  return <svg {...common}><rect width="18" height="13" fill="#1c3348" /></svg>;
}
function Spark({ seed }: { seed: string }) {
  return (
    <span className="ei-spark" aria-hidden="true">
      {Array.from({ length: 12 }, (_, n) => {
        const h = 4 + ((seed.charCodeAt(n % seed.length) * (n + 3)) % 12);
        const up = (seed.charCodeAt(n % seed.length) + n) % 3 !== 0;
        return <i key={n} className={up ? 'up' : 'down'} style={{ height: h }} />;
      })}
    </span>
  );
}
function statusLabel(e: EconEvent, now: number) {
  const mins = (Date.parse(e.scheduledAt) - now) / 60000;
  if (e.status === 'CANCELLED' || e.status === 'DELAYED' || e.status === 'RELEASED') return e.status === 'RELEASED' ? 'Released' : e.status === 'DELAYED' ? 'Delayed' : 'Cancelled';
  if (e.status === 'DUE' || Math.abs(mins) < 1.5) return 'Due Now';
  if (mins < 0) return 'Released';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h >= 1 ? `In ${h}h ${m}m` : `In ${Math.max(1, Math.round(mins))}m`;
}

export default function EconomicIntelligencePage() {
  useEffect(() => startEconomicStore(), []);
  const { data, error } = useEconomicStore();
  const [tab, setTab] = useState<Tab>('calendar');
  const [period, setPeriod] = useState<Period>('today');
  const [custom, setCustom] = useState('');
  const [currency, setCurrency] = useState('ALL');
  const [impact, setImpact] = useState<'ALL' | Impact>('ALL');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState('');
  const [externalFrame, setExternalFrame] = useState<'pending' | 'AVAILABLE' | 'UNAVAILABLE'>('pending');

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const zone = data?.policy.timezone || 'Africa/Lagos';
  const today = dayKey(new Date(now), zone);
  const events = data?.events ?? [];
  const visible = useMemo(() => {
    return events
      .filter((e) => inPeriod(e.scheduledAt, period, zone, custom || today, today))
      .filter((e) => currency === 'ALL' || e.currency === currency)
      .filter((e) => impact === 'ALL' || e.impact === impact)
      .filter((e) => !query || `${e.currency} ${e.title} ${e.country}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  }, [events, period, zone, custom, today, currency, impact, query]);
  const current = visible.find((e) => e.id === selected) || visible.find((e) => statusLabel(e, now) === 'Due Now') || visible[0] || null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tab !== 'calendar' || !visible.length) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      e.preventDefault();
      const idx = Math.max(0, visible.findIndex((row) => row.id === (current?.id || '')));
      const next = visible[Math.min(visible.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
      setSelected(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, visible, current]);

  if (!data && !error) {
    return (
      <section className="ei" aria-busy="true" aria-label="Economic Intelligence">
        <div className="ei-skel" />
        <div className="ei-kpis" style={{ marginTop: 12 }}>{Array.from({ length: 5 }, (_, i) => <div key={i} className="ei-skel" />)}</div>
      </section>
    );
  }

  const mode = data?.engine.sourceMode || 'UNCONFIGURED';
  const counts = {
    total: visible.length,
    high: visible.filter((e) => e.impact === 'HIGH').length,
    med: visible.filter((e) => e.impact === 'MEDIUM').length,
    low: visible.filter((e) => e.impact === 'LOW').length,
  };
  const upcoming = visible.filter((e) => Date.parse(e.scheduledAt) > now + 2 * 60_000).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
  const nextMins = upcoming ? Math.max(0, Math.round((Date.parse(upcoming.scheduledAt) - now) / 60000)) : null;

  return (
    <section className="ei">
      <header className="ei-head">
        <div>
          <h1>Economic Intelligence</h1>
          <p>Real-time economic calendar, event risk analysis and autonomous trading impact</p>
        </div>
        <div className="ei-head-tools">
          <label className="ei-field">
            <span>Time Zone</span>
            <select aria-label="Time zone" value={zone} onChange={(e) => void saveEconomicPolicy({ timezone: e.target.value })}>
              {ZONES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="ei-field">
            <span>Date</span>
            <button type="button" className="ei-date" onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement | null)?.showPicker?.()}>{prettyDate(zone, period === 'custom' && custom ? Date.parse(`${custom}T12:00:00Z`) : now)}</button>
            <input aria-label="Calendar date" type="date" value={period === 'custom' ? custom || today : today} onChange={(e) => { setCustom(e.target.value); setPeriod('custom'); }} hidden />
          </label>
        </div>
      </header>
      {data && <SourcePanel data={data} zone={zone} frame={externalFrame} />}
      {error && <div className="ei-banner bad" role="alert">{error}. The bridge engine keeps running; this page is only the view.</div>}
      {notice && <div className="ei-banner" role="status">{notice}</div>}
      <nav className="ei-tabs" aria-label="Economic intelligence sections">
        {([
          ['calendar', 'Live Calendar'],
          ['risk', 'Event Risk'],
          ['currency', 'Currency Impact'],
          ['exposure', 'Instrument Exposure'],
          ['reference', 'Live Reference'],
          ['history', 'Event History'],
          ['settings', 'Settings'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            {id === 'settings' ? <Settings size={14} aria-hidden="true" /> : null} {label}
          </button>
        ))}
      </nav>

      {tab === 'calendar' && data && (
        <>
          <div className="ei-kpis">
            <Kpi icon={<CalendarDays size={18} />} label="Total Events" value={counts.total} sub="Today" />
            <Kpi icon={<Flame size={18} />} tone="red" label="High Impact" value={counts.high} sub={counts.total ? `${Math.round(100 * counts.high / counts.total)}% of events` : 'No events'} />
            <Kpi icon={<TriangleAlert size={18} />} tone="amber" label="Medium Impact" value={counts.med} sub={counts.total ? `${Math.round(100 * counts.med / counts.total)}% of events` : 'No events'} />
            <Kpi icon={<ShieldCheck size={18} />} tone="green" label="Low Impact" value={counts.low} sub={counts.total ? `${Math.round(100 * counts.low / counts.total)}% of events` : 'No events'} />
            <Kpi icon={<Clock3 size={18} />} label="Next Event" value={nextMins == null ? '—' : nextMins < 60 ? `${nextMins}m` : `${Math.floor(nextMins / 60)}h ${nextMins % 60}m`} sub={upcoming?.title || 'No upcoming event'} />
          </div>
          <div className="ei-stage">
            <div className="ei-stage-main">
            <div className="ei-card">
              <div className="ei-toolbar">
                <div className="ei-period" role="tablist" aria-label="Calendar range">
                  {([['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This Week'], ['next', 'Next Week']] as const).map(([id, label]) => (
                    <button key={id} type="button" className={period === id ? 'on' : ''} onClick={() => setPeriod(id)}>{label}</button>
                  ))}
                  <button type="button" className={period === 'custom' ? 'on' : ''} onClick={() => setPeriod('custom')}>Custom Date</button>
                </div>
                <select className="ei-select" aria-label="Currency filter" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="ALL">All Currencies</option>
                  {CCY.map((c) => <option key={c}>{c}</option>)}
                </select>
                <select className="ei-select" aria-label="Impact filter" value={impact} onChange={(e) => setImpact(e.target.value as 'ALL' | Impact)}>
                  <option value="ALL">All Impact</option>
                  <option>HIGH</option>
                  <option>MEDIUM</option>
                  <option>LOW</option>
                </select>
                <input className="ei-search" aria-label="Search events" placeholder="Search events" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="ei-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time {ZONES.find((z) => z[0] === zone)?.[1].split(' ')[0] || 'UTC'}</th>
                      <th>Currency</th><th>Event</th><th>Impact</th><th>Actual</th><th>Forecast</th><th>Previous</th>
                      <th>Surprise</th><th>Affected Instruments</th><th>Status</th><th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((e) => {
                      const n = deskPairs(e, data.universe, data.policy.xauSensitivity).length;
                      const label = statusLabel(e, now);
                      const pill = label === 'Due Now' || label === 'Released';
                      return (
                        <tr key={e.id} className={current?.id === e.id ? 'on' : ''} tabIndex={0} onClick={() => setSelected(e.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') setSelected(e.id); }}>
                          <td className="ei-when">{clock(e.scheduledAt, zone)}</td>
                          <td><span className="ei-ccy"><span className="ei-flag"><Flag code={e.country || e.currency} /></span>{e.currency}</span></td>
                          <td className="ei-title">{e.title}</td>
                          <td><span className={`ei-badge ${e.impact.toLowerCase()}`}>{e.impact === 'MEDIUM' ? 'MED' : e.impact}</span></td>
                          <td>{e.actual || '—'}</td>
                          <td>{e.forecast || '—'}</td>
                          <td>{e.previous || '—'}</td>
                          <td className={surpriseTone(e)}>{surpriseLabel(e)}</td>
                          <td><span className="ei-pairs">{n} pairs <Spark seed={e.id} /></span></td>
                          <td>{pill ? <span className={`ei-badge ${label === 'Due Now' ? 'due' : 'info'}`}>{label}</span> : <span className="ei-status">{label}</span>}</td>
                          <td><button type="button" className="ei-view" onClick={() => setSelected(e.id)}>View →</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!visible.length && <div className="ei-empty">{mode === 'UNCONFIGURED' ? 'DATA SOURCE NOT CONFIGURED. No events are shown as live.' : 'No events match this range and filter.'}</div>}
              </div>
            </div>
              <Bottom data={data} zone={zone} now={now} />
            </div>
            <Details event={current} data={data} zone={zone} now={now} onNotice={setNotice} />
          </div>
        </>
      )}
      {tab === 'risk' && data && <RiskTab data={data} />}
      {tab === 'currency' && data && <CurrencyTab data={data} now={now} />}
      {tab === 'exposure' && data && <ExposureTab data={data} onNotice={setNotice} />}
      {tab === 'reference' && data && <ReferenceTab policy={data.policy} zone={zone} onFrame={setExternalFrame} />}
      {tab === 'history' && data && <HistoryTab data={data} />}
      {tab === 'settings' && data && <SettingsTab policy={data.policy} onNotice={setNotice} />}
    </section>
  );
}

function deskPairs(event: EconEvent, universe: string[], _sensitivity: string) {
  const board = DESK[event.currency] || universe.filter((symbol) => touches(symbol, event.currency, event.impact, _sensitivity));
  return board.filter((symbol) => universe.includes(symbol));
}
function posture(action?: string) {
  if (action === 'CAUTION') return { label: 'CAUTION', tone: 'warn' };
  if (action === 'REDUCE_RISK') return { label: 'REDUCE', tone: 'warn' };
  if (action === 'BLOCK_NEW_ENTRY' || action === 'REVALIDATE') return { label: 'BLOCK', tone: 'bad' };
  return { label: 'ALLOW', tone: 'ok' };
}
function chipFor(symbol: string, actionLabel: string) {
  if (actionLabel === 'CAUTION') {
    const hot = symbol.startsWith('EUR') || symbol.startsWith('GBP');
    return hot ? { label: 'CAUTION', tone: 'warn' } : { label: 'NEUTRAL', tone: 'ok' };
  }
  if (actionLabel === 'REDUCE') return { label: 'REDUCE', tone: 'warn' };
  if (actionLabel === 'BLOCK') return { label: 'BLOCK', tone: 'bad' };
  return { label: 'NEUTRAL', tone: 'ok' };
}

function Kpi({ icon, label, value, sub, tone = '' }: { icon: ReactNode; label: string; value: string | number; sub: string; tone?: string }) {
  return <article className={`ei-kpi ${tone}`}><i>{icon}</i><div><span>{label}</span><b>{value}</b><small>{sub}</small></div></article>;
}

function Details({ event, data, zone, now, onNotice }: { event: EconEvent | null; data: NonNullable<ReturnType<typeof useEconomicStore>['data']>; zone: string; now: number; onNotice: (s: string) => void }) {
  if (!event) return <aside className="ei-card ei-side"><h3>Event Details</h3><p className="ei-note">Select an event.</p></aside>;
  const linked = deskPairs(event, data.universe, data.policy.xauSensitivity);
  const preview = linked.slice(0, 4);
  const gate = data.instruments.find((row) => preview.includes(row.symbol) && row.currency === event.currency) || data.instruments.find((row) => row.activeEventId === event.id);
  const entry = posture(gate?.detail?.calculatedAction);
  const history = data.history.find((h) => h.currency === event.currency);
  const sample = !history && data.engine.sourceMode === 'DEVELOPMENT';
  const move30 = history?.avgMove30m ?? (sample ? 12.4 : null);
  const move1h = history?.avgMove1h ?? (sample ? 18.7 : null);
  const spread = history?.avgSpreadSpike ?? (sample ? 42 : null);
  const bias = (history?.directionalBias ?? (sample ? 'Mixed' : '—')).replaceAll('_', ' ');
  const biasLabel = bias === 'MIXED' ? 'Mixed' : bias.charAt(0) + bias.slice(1).toLowerCase();
  return (
    <aside className="ei-card ei-side" aria-label="Event details">
      <div className="ei-side-top"><h3>Event Details</h3><span className="ei-badge info">{statusLabel(event, now) === 'Due Now' ? 'In Progress' : statusLabel(event, now)}</span></div>
      <h2><span className="ei-flag"><Flag code={event.country || event.currency} /></span>{event.title}</h2>
      <p className="sub">{PLACE[event.country] || event.country} ({event.currency})</p>
      <p className="sub">{longWhen(event.scheduledAt, zone)}</p>
      <span className={`ei-badge ${event.impact.toLowerCase()}`}>{event.impact}<Stars impact={event.impact} /></span>
      <dl className="ei-dl">
        <div><dt>Actual</dt><dd>{event.actual || '—'}</dd></div>
        <div><dt>Forecast</dt><dd>{event.forecast || '—'}</dd></div>
        <div><dt>Previous</dt><dd>{event.previous || '—'}</dd></div>
        <div><dt>Surprise</dt><dd className={surpriseTone(event)}>{surpriseLabel(event)}</dd></div>
        <div><dt>Time Remaining</dt><dd>{statusLabel(event, now)}</dd></div>
      </dl>
      <h3>Affected Instruments ({linked.length})</h3>
      <div className="ei-aff">
        {preview.map((symbol) => {
          const tag = chipFor(symbol, entry.label);
          return (
            <button key={symbol} type="button" onClick={() => void requestEconomicRevalidation(symbol).then((r) => onNotice(r.message))}>
              <b>{symbol}</b>
              <Spark seed={symbol + event.id} />
              <span className={`ei-badge ${tag.tone}`}>{tag.label}</span>
            </button>
          );
        })}
      </div>
      <h3>Autonomous Action</h3>
      <div className="ei-action">
        <div><span>New Entries</span><span className={`ei-badge ${entry.label === 'BLOCK' ? 'bad' : entry.label === 'REDUCE' ? 'warn' : 'ok'}`}>{entry.label === 'BLOCK' ? 'BLOCK' : entry.label === 'REDUCE' ? 'REDUCE' : 'ALLOW'}</span></div>
        <div><span>Existing Positions</span><span className="ei-badge info">MANAGE</span></div>
        <div><span>Risk Adjustment</span><span className="ei-badge">{entry.label === 'REDUCE' ? 'REDUCE' : 'NONE'}</span></div>
        <div><span>Post-Event</span><span className="ei-badge info">Monitor volatility {data.policy.highPostVolMin}m</span></div>
      </div>
      <p className="ei-note">Existing positions stay open. This engine only gates new entries.</p>
      <div className="ei-hist">
        <header><b>Historical Impact ({event.currency})</b><span>{sample ? 'Last 12 Events' : history ? `Last ${history.samples} events` : 'No live sample'}</span></header>
        <dl className="ei-dl">
          <div><dt>Average Move (30m)</dt><dd>{move30 == null ? '—' : `${move30} pips`}</dd></div>
          <div><dt>Average Move (1h)</dt><dd>{move1h == null ? '—' : `${move1h} pips`}</dd></div>
          <div><dt>Volatility Increase</dt><dd>{spread == null ? '—' : `+${spread}%`}</dd></div>
          <div><dt>Direction Bias</dt><dd>{biasLabel}</dd></div>
        </dl>
        <Spark seed={`${event.currency}-hist`} />
        {sample && <p className="ei-note">Sample profile for layout. It is not stored as live evidence.</p>}
      </div>
    </aside>
  );
}

function Bottom({ data, zone, now }: { data: NonNullable<ReturnType<typeof useEconomicStore>['data']>; zone: string; now: number }) {
  const todayKey = parts(new Date(now).toISOString(), zone).key;
  const horizon = data.events.filter((e) => parts(e.scheduledAt, zone).key === todayKey);
  const nowLeft = (() => {
    const p = parts(new Date(now).toISOString(), zone);
    return ((p.hh * 60 + p.mm) / 1440) * 100;
  })();
  const impactOf = (currency: string): Impact | null => {
    const hits = horizon.filter((e) => e.currency === currency);
    if (!hits.length) return null;
    if (hits.some((e) => e.impact === 'HIGH')) return 'HIGH';
    if (hits.some((e) => e.impact === 'MEDIUM')) return 'MEDIUM';
    return 'LOW';
  };
  return (
    <div className="ei-bottom">
      <div className="ei-card">
        <h3>Currency Event Timeline (Next 24 Hours)</h3>
        <div className="ei-axis"><b /><span><em>00:00</em><em>06:00</em><em>12:00</em><em>18:00</em></span></div>
        {CCY.map((ccy) => (
          <div className="ei-tl" key={ccy}>
            <b>{ccy} <small>({horizon.filter((e) => e.currency === ccy).length})</small></b>
            <div className="ei-track">
              <i className="ei-now" style={{ left: `${nowLeft}%` }} />
              {horizon.filter((e) => e.currency === ccy).map((e) => {
                const p = parts(e.scheduledAt, zone);
                const left = ((p.hh * 60 + p.mm) / 1440) * 100;
                return <i key={e.id} className={e.impact.toLowerCase()} style={{ left: `${left}%` }} title={`${clock(e.scheduledAt, zone)} ${e.title}`} />;
              })}
            </div>
          </div>
        ))}
        <div className="ei-legend">
          <span><i className="high" style={{ background: '#ff4d67' }} /> High Impact</span>
          <span><i className="medium" style={{ background: '#f5b942' }} /> Medium Impact</span>
          <span><i className="low" style={{ background: '#3ddc97' }} /> Low Impact</span>
          <span><i className="now" /> Current Time</span>
        </div>
      </div>
      <div className="ei-card">
        <header className="ei-card-head"><h3>Instrument Event Heatmap (Next 24 Hours)</h3><span>Impact Level</span></header>
        <div className="ei-heat-head"><span>Pair</span>{HEAT_CCY.map((c) => <span key={c}>{c}</span>)}</div>
        <div className="ei-heat">
          {HEAT_PAIRS.map((symbol) => (
            <div className="ei-heat-row" key={symbol}>
              <b>{symbol}</b>
              {HEAT_CCY.map((ccy) => {
                const exposed = symbol === 'XAUUSD' || symbol.includes('USD') || symbol.includes(ccy);
                const level = exposed ? impactOf(ccy) : null;
                return <i key={ccy} className={`ei-cell ${level ? level.toLowerCase() : 'none'}`} title={level ? `${symbol} ${ccy} ${level}` : `${symbol} no ${ccy} event`} />;
              })}
            </div>
          ))}
        </div>
        <div className="ei-legend">
          <span><i style={{ background: '#e24b62' }} /> High</span>
          <span><i style={{ background: '#e0a33a' }} /> Medium</span>
          <span><i style={{ background: '#2f9a68' }} /> Low</span>
          <span><i style={{ background: '#163044' }} /> No event</span>
        </div>
      </div>
    </div>
  );
}

function touches(symbol: string, currency: string, impact: Impact, sensitivity: string) {
  if (symbol === 'XAUUSD') {
    const rank: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, ALL: 1 };
    return currency === 'USD' && rank[impact] >= rank[sensitivity] || currency === 'XAU';
  }
  return symbol.includes(currency);
}

function RiskTab({ data }: { data: NonNullable<ReturnType<typeof useEconomicStore>['data']> }) {
  return (
    <div className="ei-card ei-panel">
      <h2>Event risk state · {data.engine.state.replaceAll('_', ' ')}</h2>
      <p className="ei-note">{data.engine.reason}. Existing positions are managed, not closed, by this engine.</p>
      <div className="ei-grid">
        {data.events.filter((e) => Date.parse(e.scheduledAt) > Date.now() - 6 * 3600_000).slice(0, 12).map((e) => (
          <article key={e.id}>
            <h3>{e.currency} · {e.title}</h3>
            <span className={`ei-badge ${e.impact.toLowerCase()}`}>{e.impact}</span>
            <p>{e.seriesKind.replaceAll('_', ' ')} · {e.status}</p>
            <small>{e.surprise?.interpretation?.replaceAll('_', ' ') || 'Surprise not available'}</small>
          </article>
        ))}
      </div>
    </div>
  );
}

function CurrencyTab({ data, now }: { data: NonNullable<ReturnType<typeof useEconomicStore>['data']>; now: number }) {
  return (
    <div className="ei-card ei-panel">
      <h2>Currency impact</h2>
      <div className="ei-grid">
        {CCY.map((ccy) => {
          const rows = data.events.filter((e) => e.currency === ccy);
          const next = rows.filter((e) => Date.parse(e.scheduledAt) >= now).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
          const instruments = data.instruments.filter((i) => i.currency === ccy);
          const blocked = instruments.filter((i) => i.blocksNewEntries).length;
          return (
            <article key={ccy}>
              <h3>{ccy}</h3>
              <p>{rows.length} events · {blocked} instruments fail-closed</p>
              <small>{next ? `Next: ${next.title}` : 'No upcoming event'}</small>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ExposureTab({ data, onNotice }: { data: NonNullable<ReturnType<typeof useEconomicStore>['data']>; onNotice: (s: string) => void }) {
  return (
    <div className="ei-card ei-panel">
      <h2>Instrument exposure · {data.instruments.length} instruments</h2>
      <div className="ei-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th><th>State</th><th>Currency</th><th>Impact</th><th>Minutes</th><th>Restriction</th><th>Spread</th><th>Volatility</th><th>Revalidate</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.instruments.map((row) => (
              <tr key={row.symbol}>
                <td>{row.symbol}</td>
                <td>{row.state.replaceAll('_', ' ')}</td>
                <td>{row.currency || '—'}</td>
                <td>{row.impact || '—'}</td>
                <td>{row.minutesToEvent ?? '—'}</td>
                <td><span className={`ei-badge ${row.blocksNewEntries ? 'bad' : 'ok'}`}>{row.restriction}</span></td>
                <td>{row.spreadCondition}</td>
                <td>{row.volatilityCondition}</td>
                <td>{row.revalidationRequired ? 'YES' : 'NO'}</td>
                <td><button type="button" className="ei-view" onClick={() => void requestEconomicRevalidation(row.symbol).then((r) => onNotice(r.message))}>Revalidate</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryTab({ data }: { data: NonNullable<ReturnType<typeof useEconomicStore>['data']> }) {
  return (
    <div className="ei-card ei-panel">
      <h2>Event history</h2>
      <h3>Completed outcomes</h3>
      {!data.history.length && <p className="ei-note">No live event outcomes have been published to Performance & Learning yet.</p>}
      {data.history.map((h) => (
        <div className="ei-history" key={h.eventKey} style={{ marginBottom: 8 }}>
          <b>{h.currency} · {h.title || h.eventKey}</b>
          <span> {h.samples} samples · 5m {h.avgMove5m ?? '—'} · 15m {h.avgMove15m ?? '—'} · 30m {h.avgMove30m ?? '—'} · 1h {h.avgMove1h ?? '—'} · bias {h.directionalBias}</span>
        </div>
      ))}
      <h3>Audit</h3>
      <div className="ei-table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Event</th><th>Symbol</th><th>Detail</th></tr></thead>
          <tbody>
            {data.audit.map((row) => (
              <tr key={row.id}><td>{row.createdAt ? new Date(row.createdAt).toLocaleTimeString() : '—'}</td><td>{row.type}</td><td>{row.symbol || '—'}</td><td>{row.detail}</td></tr>
            ))}
          </tbody>
        </table>
        {!data.audit.length && <div className="ei-empty">No economic audit rows yet. The engine writes them as the state machine moves.</div>}
      </div>
    </div>
  );
}

function sourceView(data: NonNullable<ReturnType<typeof useEconomicStore>['data']>): EconSources {
  return data.sources || data.engine.detail?.sources || {
    calendar: data.engine.sourceMode === 'LIVE' ? 'LIVE' : 'NOT_CONFIGURED',
    calendarReason: data.engine.reason,
    sample: data.engine.sourceMode === 'DEVELOPMENT',
    lastSync: null,
    mt5: 'DISCONNECTED',
    external: data.policy.externalReference === false ? 'UNAVAILABLE' : 'AVAILABLE',
  };
}

function SourcePanel({ data, zone, frame }: { data: NonNullable<ReturnType<typeof useEconomicStore>['data']>; zone: string; frame: 'pending' | 'AVAILABLE' | 'UNAVAILABLE' }) {
  const sources = sourceView(data);
  const external = data.policy.externalReference === false ? 'UNAVAILABLE' : frame === 'pending' ? sources.external : frame;
  const sync = sources.lastSync ? clock(sources.lastSync, zone) + ' ' + (ZONES.find((z) => z[0] === zone)?.[1].split(' ')[0] || 'UTC') : '—';
  return (
    <section className="ei-sources" aria-label="Economic data sources">
      <header>Economic data sources</header>
      <div>
        <span>Machine Calendar</span>
        <b className={sources.calendar === 'LIVE' ? 'ok' : 'bad'}>{sources.calendar}</b>
      </div>
      <div>
        <span>MT5 Reaction Sensor</span>
        <b className={sources.mt5 === 'LIVE' ? 'ok' : 'bad'}>{sources.mt5}</b>
      </div>
      <div>
        <span>External Reference</span>
        <b className={external === 'AVAILABLE' ? 'ok' : 'bad'}>{external}</b>
      </div>
      <small>Last calendar sync {sync}. The reference widget never changes these states.</small>
      {sources.sample && <p>Development sample rows are loaded for this session. They are not a live calendar, and new entries stay fail-closed.</p>}
      {sources.calendar === 'NOT_CONFIGURED' && !sources.sample && <p>No permitted machine-readable calendar is configured. Missing rows are not treated as a clear calendar.</p>}
    </section>
  );
}

function ReferenceTab({ policy, zone, onFrame }: { policy: EconPolicy; zone: string; onFrame: (state: 'AVAILABLE' | 'UNAVAILABLE') => void }) {
  const enabled = policy.externalReference !== false;
  const zoneName = ZONES.find((item) => item[0] === zone)?.[1] || zone;
  const src = 'https://sslecal2.investing.com?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&features=datepicker,timezone&countries=5,72,4,35,12,6,25,43&calType=week&timeZone=166&lang=1';
  return (
    <section className="ei-card ei-reference" aria-label="Live economic reference">
      <header>
        <div>
          <h2>Live Economic Reference</h2>
          <p>Official external economic calendar for visual verification. Autonomous trading decisions use Cacsms Economic Intelligence and MT5 market-reaction data.</p>
        </div>
        <div className="ei-ref-tools">
          <a className="ei-open" href="https://www.investing.com/economic-calendar" rel="nofollow noreferrer" target="_blank">Open economic calendar</a>
          <span className={`ei-badge ${enabled ? 'info' : 'bad'}`}>External Reference · {enabled ? 'AVAILABLE' : 'UNAVAILABLE'}</span>
        </div>
      </header>
      <p className="ei-note">External reference calendar — not used directly for autonomous execution. The public calendar is <a href="https://www.investing.com/economic-calendar" rel="nofollow noreferrer" target="_blank">investing.com/economic-calendar</a>. The card below is Investing.com’s official embed of that calendar, set to Lagos (GMT+1), matching {zoneName}. Low-impact filtering stays on the machine calendar.</p>
      {enabled ? (
        <iframe title="Investing.com economic calendar" src={src} onLoad={() => onFrame('AVAILABLE')} onError={() => onFrame('UNAVAILABLE')} />
      ) : <div className="ei-empty">The external reference is turned off in Settings.</div>}
      <p className="ei-attrib">Real Time Economic Calendar provided by <a href="https://www.investing.com/" rel="nofollow noreferrer" target="_blank">Investing.com</a>.</p>
    </section>
  );
}

function SettingsTab({ policy, onNotice }: { policy: EconPolicy; onNotice: (s: string) => void }) {
  const [draft, setDraft] = useState(policy);
  useEffect(() => setDraft(policy), [policy]);
  const set = (patch: Partial<EconPolicy>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <div className="ei-card ei-panel">
      <h2>Economic policy</h2>
      <p className="ei-note">Provider secrets stay in environment variables named here. This form never displays those values, and learning cannot rewrite these controls.</p>
      <div className="ei-set" style={{ maxWidth: 720 }}>
        <label>Enabled <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} /></label>
        <label>Machine calendar <input type="checkbox" checked={draft.machineCalendar !== false} onChange={(e) => set({ machineCalendar: e.target.checked })} /></label>
        <label>External reference <input type="checkbox" checked={draft.externalReference !== false} onChange={(e) => set({ externalReference: e.target.checked })} /></label>
        <label>Calendar URL variable <input aria-label="Provider URL variable" value={draft.providerUrlRef} onChange={(e) => set({ providerUrlRef: e.target.value })} /></label>
        <label>Token variable <input aria-label="Provider token variable" value={draft.providerTokenRef} onChange={(e) => set({ providerTokenRef: e.target.value })} /></label>
        <label>Provider configured <b>{policy.providerConfigured ? 'YES' : 'NO'}</b></label>
        <label>Stale feed blocks new entries <input type="checkbox" checked={draft.blockOnStaleFeed} onChange={(e) => set({ blockOnStaleFeed: e.target.checked })} /></label>
        <label>Stale after (sec) <input type="number" value={draft.staleAfterSec} onChange={(e) => set({ staleAfterSec: Number(e.target.value) })} /></label>
        <label>High watch (min) <input type="number" value={draft.highPreWatchMin} onChange={(e) => set({ highPreWatchMin: Number(e.target.value) })} /></label>
        <label>High restrict (min) <input type="number" value={draft.highPreRestrictMin} onChange={(e) => set({ highPreRestrictMin: Number(e.target.value) })} /></label>
        <label>High lock (min) <input type="number" value={draft.highLockMin} onChange={(e) => set({ highLockMin: Number(e.target.value) })} /></label>
        <label>High post-volatility (min) <input type="number" value={draft.highPostVolMin} onChange={(e) => set({ highPostVolMin: Number(e.target.value) })} /></label>
        <label>Revalidation (min) <input type="number" value={draft.highRevalidateMin} onChange={(e) => set({ highRevalidateMin: Number(e.target.value) })} /></label>
        <label>Medium caution (min) <input type="number" value={draft.mediumPreCautionMin} onChange={(e) => set({ mediumPreCautionMin: Number(e.target.value) })} /></label>
        <label>Medium post (min) <input type="number" value={draft.mediumPostMin} onChange={(e) => set({ mediumPostMin: Number(e.target.value) })} /></label>
        <label>Low watch (min) <input type="number" value={draft.lowWatchMin} onChange={(e) => set({ lowWatchMin: Number(e.target.value) })} /></label>
        <label>Spread spike multiple <input type="number" step="0.1" value={draft.maxSpreadMultiplier} onChange={(e) => set({ maxSpreadMultiplier: Number(e.target.value) })} /></label>
        <label>Reaction move (pips) <input type="number" value={draft.reactionMovePips ?? 12} onChange={(e) => set({ reactionMovePips: Number(e.target.value) })} /></label>
        <label>Reaction score threshold <input type="number" value={draft.reactionScoreMin ?? 70} onChange={(e) => set({ reactionScoreMin: Number(e.target.value) })} /></label>
        <label>Volatility multiple <input type="number" step="0.1" value={draft.volatilityAtr} onChange={(e) => set({ volatilityAtr: Number(e.target.value) })} /></label>
        <label>XAU sensitivity
          <select aria-label="XAU sensitivity" value={draft.xauSensitivity} onChange={(e) => set({ xauSensitivity: e.target.value })}>
            {['HIGH', 'MEDIUM', 'LOW', 'ALL'].map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label>Risk reduction factor <input type="number" step="0.1" value={draft.riskReductionFactor} onChange={(e) => set({ riskReductionFactor: Number(e.target.value) })} /></label>
        <fieldset>
          <legend>Currencies</legend>
          {CCY.map((c) => (
            <label key={c}>{c}
              <input type="checkbox" checked={draft.currencies.includes(c)} onChange={(e) => set({ currencies: e.target.checked ? [...draft.currencies, c] : draft.currencies.filter((x) => x !== c) })} />
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Impact levels</legend>
          {(['HIGH', 'MEDIUM', 'LOW'] as Impact[]).map((c) => (
            <label key={c}>{c}
              <input type="checkbox" checked={draft.impacts.includes(c)} onChange={(e) => set({ impacts: e.target.checked ? [...draft.impacts, c] : draft.impacts.filter((x) => x !== c) })} />
            </label>
          ))}
        </fieldset>
        {policy.developmentMode && (
          <label>Development sample <input type="checkbox" checked={draft.developmentSample} onChange={(e) => set({ developmentSample: e.target.checked })} /></label>
        )}
        <button type="button" className="ei-view" onClick={() => void saveEconomicPolicy(draft).then(() => onNotice('Policy saved. The engine applies it on the next cycle. Live parameters were not rewritten.'))}>Save policy</button>
        <button type="button" className="ei-view" onClick={() => void refreshEconomicCalendar().then((r) => onNotice(r.message))}>Refresh calendar</button>
      </div>
    </div>
  );
}
