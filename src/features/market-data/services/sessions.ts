/** Full FX session intelligence (timezone / DST aware via Intl). */

export type NamedSession = {
  id: 'Sydney' | 'Tokyo' | 'London' | 'NewYork';
  name: string;
  timezone: string;
  openHourLocal: number;
  closeHourLocal: number;
  currencies: string[];
};

export const FX_SESSIONS: NamedSession[] = [
  { id: 'Sydney', name: 'Sydney', timezone: 'Australia/Sydney', openHourLocal: 7, closeHourLocal: 16, currencies: ['AUD', 'NZD', 'JPY'] },
  { id: 'Tokyo', name: 'Tokyo', timezone: 'Asia/Tokyo', openHourLocal: 9, closeHourLocal: 18, currencies: ['JPY', 'AUD', 'NZD'] },
  { id: 'London', name: 'London', timezone: 'Europe/London', openHourLocal: 8, closeHourLocal: 17, currencies: ['EUR', 'GBP', 'CHF'] },
  { id: 'NewYork', name: 'New York', timezone: 'America/New_York', openHourLocal: 8, closeHourLocal: 17, currencies: ['USD', 'CAD', 'XAU'] },
];

function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    weekday: parts.weekday || '',
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    label: `${parts.day} ${parts.month} ${parts.year} · ${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

/** Forex week open Sun 22:00 UTC – Fri 22:00 UTC. */
export function isFxMarketOpen(date = new Date()): boolean {
  const day = date.getUTCDay();
  const mins = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (day === 6) return false;
  if (day === 5 && mins >= 22 * 60) return false;
  if (day === 0 && mins < 22 * 60) return false;
  return true;
}

export function sessionStatus(session: NamedSession, date = new Date()) {
  const marketOpen = isFxMarketOpen(date);
  const local = zonedParts(date, session.timezone);
  const mins = local.hour * 60 + local.minute;
  const openM = session.openHourLocal * 60;
  const closeM = session.closeHourLocal * 60;
  const inHours = mins >= openM && mins < closeM;
  const open = marketOpen && inHours;
  return {
    ...session,
    open,
    marketOpen,
    localTime: local.label,
    localHour: local.hour,
    localMinute: local.minute,
    status: open ? ('Open' as const) : ('Closed' as const),
  };
}

export function getAllSessionStatuses(date = new Date()) {
  return FX_SESSIONS.map((s) => sessionStatus(s, date));
}

export function activeOverlaps(date = new Date()) {
  const rows = getAllSessionStatuses(date).filter((s) => s.open);
  return {
    active: rows,
    label: rows.length ? rows.map((r) => r.name).join(' / ') : isFxMarketOpen(date) ? 'Off-peak' : 'Weekend',
    overlap: rows.length >= 2,
  };
}

export function nextTransition(date = new Date()) {
  const rows = getAllSessionStatuses(date);
  // Approximate next boundary in 15m steps (local-aware via recompute)
  for (let i = 1; i <= 96; i++) {
    const t = new Date(date.getTime() + i * 15 * 60_000);
    const next = getAllSessionStatuses(t);
    for (let j = 0; j < rows.length; j++) {
      if (rows[j].open !== next[j].open) {
        return {
          at: t.toISOString(),
          session: next[j].name,
          becomes: next[j].open ? 'Open' : 'Closed',
          inMinutes: i * 15,
        };
      }
    }
  }
  return null;
}

export function instrumentsForSession(sessionId: NamedSession['id'], symbols: string[]) {
  const session = FX_SESSIONS.find((s) => s.id === sessionId);
  if (!session) return [];
  return symbols.filter((sym) => session.currencies.some((c) => sym.includes(c) || (c === 'XAU' && sym === 'XAUUSD')));
}
