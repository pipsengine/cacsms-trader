export type BridgeControlHealth = { ok: boolean; service?: string; message?: string };

export type BridgeRestartResult = { ok: boolean; message?: string };

const CONTROL = '/dev/bridge-control';

export async function bridgeControlHealth(): Promise<BridgeControlHealth> {
  try {
    const res = await fetch(`${CONTROL}/health`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, message: `Control plane HTTP ${res.status}` };
    const data = (await res.json()) as { ok?: boolean; service?: string };
    return { ok: Boolean(data.ok), service: data.service };
  } catch {
    return {
      ok: false,
      message: 'Bridge control unavailable. Use npm run dev or npm run mt5:bridge (supervisor).',
    };
  }
}

export async function restartMt5Bridge(): Promise<BridgeRestartResult> {
  const res = await fetch(`${CONTROL}/restart`, { method: 'POST', headers: { Accept: 'application/json' } });
  const data = (await res.json().catch(() => ({}))) as BridgeRestartResult;
  if (!res.ok) {
    throw new Error(data.message || `Restart failed (${res.status})`);
  }
  return data;
}

/** Poll bridge /health until it responds or timeout. */
export async function waitForBridgeHealth(timeoutMs = 45_000, intervalMs = 1500): Promise<boolean> {
  const base = (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || '/mt5-bridge';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`, { headers: { Accept: 'application/json' } });
      if (res.ok) return true;
    } catch {
      /* bridge still starting */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
