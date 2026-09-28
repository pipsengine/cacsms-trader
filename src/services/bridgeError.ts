/** Turn a dead bridge connection into an operator instruction. The pipeline runs in that process, not in the browser. */
export function explainBridgeError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : '';
  const dead = !raw || raw === 'Failed to fetch' || /ECONNREFUSED|NetworkError|bridge unreachable|Failed to fetch/i.test(raw);
  if (!dead) return raw;
  return 'MT5 bridge is not running. Open a terminal in the project folder and run: npm run mt5:bridge. Leave that window open. If the website is closed too, run npm run dev instead — it starts the bridge and the website together.';
}
