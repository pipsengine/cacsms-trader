const TERMINAL_PREFIX = 'CACSMS-MT5-';

/** Format: CACSMS-MT5-0001 */
export function formatTerminalInstanceId(n: number) {
  return `${TERMINAL_PREFIX}${String(Math.max(1, Math.floor(n))).padStart(4, '0')}`;
}

/** Next unused auto ID from existing terminal instance values. */
export function nextTerminalInstanceId(existing: string[]) {
  let max = 0;
  for (const id of existing) {
    const m = /^CACSMS-MT5-(\d+)$/i.exec(id.trim());
    if (m) max = Math.max(max, Number(m[1]));
    else {
      // Legacy MT5-01 / MT5-1 style — still reserve a sequential slot
      const legacy = /^MT5-(\d+)$/i.exec(id.trim());
      if (legacy) max = Math.max(max, Number(legacy[1]));
    }
  }
  return formatTerminalInstanceId(max + 1);
}
