export const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}%`);

export function age(sec: number | null | undefined): string {
  if (sec == null) return '—';
  if (sec < 90) return `${sec}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

const utcMillis = (iso: string) => {
  const stamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(iso) ? `${iso.replace(' ', 'T')}Z` : iso;
  const t = Date.parse(stamp);
  return Number.isFinite(t) ? t : null;
};

export function ageOf(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = utcMillis(iso);
  return t == null ? null : Math.max(0, Math.round((now - t) / 1000));
}

export const ago = (iso: string | null | undefined) => {
  const s = ageOf(iso);
  return s == null ? '—' : `${age(s)} ago`;
};

export const clock = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const t = utcMillis(iso);
  return t == null ? '—' : new Date(t).toLocaleTimeString();
};

export const stamp = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const t = utcMillis(iso);
  return t == null ? '—' : new Date(t).toLocaleString();
};

export const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—');

export const ms = (n: number | null | undefined) => (n == null ? '—' : n >= 10000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
