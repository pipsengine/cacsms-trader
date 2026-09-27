/** FX market session + Nigeria (Africa/Lagos) local clock helpers. */

export type SessionStatus = 'Open' | 'Closed';

export type MarketSessionInfo = {
  session: string;
  status: SessionStatus;
  nigeriaTime: string;
  nigeriaDate: string;
  nigeriaLabel: string;
};

/** Forex week: open Sun 22:00 UTC → Fri 22:00 UTC. */
export function isFxMarketOpen(date = new Date()): boolean {
  const day = date.getUTCDay(); // 0=Sun … 6=Sat
  const mins = date.getUTCHours() * 60 + date.getUTCMinutes();
  const friClose = 22 * 60;
  const sunOpen = 22 * 60;

  if (day === 6) return false; // Saturday
  if (day === 5 && mins >= friClose) return false; // Friday after 22:00 UTC
  if (day === 0 && mins < sunOpen) return false; // Sunday before 22:00 UTC
  return true;
}

/** Primary overlapping FX session name in UTC. */
export function activeFxSession(date = new Date()): string {
  if (!isFxMarketOpen(date)) return 'Weekend';

  const h = date.getUTCHours() + date.getUTCMinutes() / 60;
  const sydney = h >= 21 || h < 6;
  const tokyo = h >= 0 && h < 9;
  const london = h >= 7 && h < 16;
  const newYork = h >= 12 && h < 21;

  if (london && newYork) return 'London / New York';
  if (tokyo && london) return 'Tokyo / London';
  if (sydney && tokyo) return 'Sydney / Tokyo';
  if (london) return 'London';
  if (newYork) return 'New York';
  if (tokyo) return 'Tokyo';
  if (sydney) return 'Sydney';
  return 'Off-peak';
}

export function getMarketSessionInfo(date = new Date()): MarketSessionInfo {
  const status: SessionStatus = isFxMarketOpen(date) ? 'Open' : 'Closed';
  const session = activeFxSession(date);

  const nigeriaTime = new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);

  const nigeriaDate = new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);

  return {
    session,
    status,
    nigeriaTime,
    nigeriaDate,
    nigeriaLabel: `${nigeriaDate} · ${nigeriaTime} WAT`,
  };
}
