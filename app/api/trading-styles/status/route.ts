import { getEnabledTradingStyles } from '@/lib/trading-styles/registry';
import { getMultiStyleTradingSnapshot, listTradingStyleCapabilities } from '@/lib/trading-styles/multi-style-orchestrator';

export async function GET(): Promise<Response> {
  try {
    const styles = getEnabledTradingStyles();
    const snapshot = await getMultiStyleTradingSnapshot();
    return Response.json({
      ok: true,
      capabilities: listTradingStyleCapabilities(),
      enabledStyles: styles.map((style) => ({
        id: style.id,
        label: style.label,
        entryTimeframe: style.entryTimeframe,
        biasTimeframes: style.biasTimeframes,
        maxHoldHours: style.maxHoldHours,
        minRewardRisk: style.minRewardRisk,
        algorithms: style.algorithms,
      })),
      lastCycle: snapshot,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load trading style status.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
