/** Canonical institutional timeframe codes (MN, W, D, H4, H1, M15, …). */
export function normalizeInstitutionalTimeframe(value: string): string {
  const raw = String(value ?? '').trim().toUpperCase();
  const mapping: Record<string, string> = {
    PERIOD_MN1: 'MN',
    MN1: 'MN',
    MN: 'MN',
    PERIOD_W1: 'W',
    W1: 'W',
    WEEKLY: 'W',
    W: 'W',
    PERIOD_D1: 'D',
    D1: 'D',
    DAILY: 'D',
    D: 'D',
    PERIOD_H4: 'H4',
    H4: 'H4',
    PERIOD_H1: 'H1',
    H1: 'H1',
    PERIOD_M30: 'M30',
    M30: 'M30',
    PERIOD_M15: 'M15',
    M15: 'M15',
    PERIOD_M5: 'M5',
    M5: 'M5',
    PERIOD_M1: 'M1',
    M1: 'M1',
  };
  return mapping[raw] ?? raw.replace(/^PERIOD_/, '');
}

/** DB lookup aliases for a canonical timeframe (legacy rows may use MN1, W1, …). */
export function institutionalTimeframeDbAliases(canonical: string): string[] {
  const tf = normalizeInstitutionalTimeframe(canonical);
  const aliasMap: Record<string, string[]> = {
    MN: ['MN', 'MN1'],
    W: ['W', 'W1'],
    D: ['D', 'D1'],
  };
  return aliasMap[tf] ?? [tf];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Reject H1 bars mislabeled as monthly (EA bug before PERIOD_MN1 support). */
export function isPlausibleMacroTimeframeCapture(
  timeframe: string,
  bars: ReadonlyArray<{ timestamp?: string }>,
): boolean {
  const tf = normalizeInstitutionalTimeframe(timeframe);
  if (tf !== 'MN' && tf !== 'W') return true;
  if (bars.length < 2) return true;

  const times = bars
    .map((bar) => Date.parse(String(bar.timestamp ?? '')))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (times.length < 2) return true;

  const spanMs = times[times.length - 1] - times[0];
  const avgMs = spanMs / (times.length - 1);
  const minAvgMs = tf === 'MN' ? 20 * MS_PER_DAY : 5 * MS_PER_DAY;
  return avgMs >= minAvgMs;
}
