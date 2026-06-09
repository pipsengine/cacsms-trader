export const runtime = 'nodejs';

import { dispatchExecutionCommand, ExecutionPolicyBlockedError, ExecutionRiskBlockedError } from '@/lib/execution-dispatch';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';

export async function POST(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    const body = (await request.json()) as Record<string, unknown>;
    const mode = String(body?.mode ?? '').toUpperCase();
    const sandboxMode = Boolean(body?.sandboxMode ?? body?.sandbox ?? (mode ? mode === 'SANDBOX' : true));
    const environment = String(body?.environment ?? (body?.payload as Record<string, unknown> | undefined)?.environment ?? 'DEMO').toUpperCase();
    const commandType = String(body?.type ?? '').trim() || 'place_order';

    const resolvedSymbol = String(body?.symbol ?? (body?.payload as Record<string, unknown> | undefined)?.symbol ?? '').trim();
    const resolvedSideRaw = String(body?.side ?? (body?.payload as Record<string, unknown> | undefined)?.side ?? '').trim();
    const resolvedSide = resolvedSideRaw ? resolvedSideRaw.toUpperCase() : 'BUY';
    const resolvedOrderType = String(body?.orderType ?? (body?.payload as Record<string, unknown> | undefined)?.orderType ?? (body?.payload as Record<string, unknown> | undefined)?.orderKind ?? 'MARKET')
      .trim()
      .toUpperCase();
    const resolvedVolume = Number(body?.volume ?? (body?.payload as Record<string, unknown> | undefined)?.volume ?? (body?.payload as Record<string, unknown> | undefined)?.volumeLots ?? NaN);
    const resolvedSl = Number(body?.sl ?? (body?.payload as Record<string, unknown> | undefined)?.sl ?? (body?.payload as Record<string, unknown> | undefined)?.stopLoss ?? 0);
    const resolvedTp = Number(body?.tp ?? (body?.payload as Record<string, unknown> | undefined)?.tp ?? (body?.payload as Record<string, unknown> | undefined)?.takeProfit ?? 0);
    const resolvedComment = String(body?.comment ?? (body?.payload as Record<string, unknown> | undefined)?.comment ?? 'Cacsms Trader sandbox test');

    const canonicalPayload: Record<string, unknown> = {
      mode: sandboxMode ? 'SANDBOX' : 'LIVE',
      environment,
      symbol: resolvedSymbol,
      side: resolvedSide,
      orderType: resolvedOrderType,
      volume: Number.isFinite(resolvedVolume) ? resolvedVolume : null,
      sl: Number.isFinite(resolvedSl) ? resolvedSl : 0,
      tp: Number.isFinite(resolvedTp) ? resolvedTp : 0,
      comment: resolvedComment,
      orderKind: resolvedOrderType.toLowerCase(),
      volumeLots: Number.isFinite(resolvedVolume) ? resolvedVolume : null,
      stopLoss: Number.isFinite(resolvedSl) ? resolvedSl : 0,
      takeProfit: Number.isFinite(resolvedTp) ? resolvedTp : 0,
      sideLower: resolvedSide.toLowerCase(),
      ...((typeof body?.payload === 'object' && body.payload ? body.payload : {}) as Record<string, unknown>),
    };

    if (String(commandType).trim().toUpperCase() === 'PLACE_ORDER') {
      if (!resolvedSymbol) throw new Error('symbol is required.');
      if (!Number.isFinite(resolvedVolume) || resolvedVolume <= 0) throw new Error('volume must be a positive number.');
      if (resolvedOrderType !== 'MARKET') throw new Error('Only MARKET orderType is supported in the current test pipeline.');
      if (resolvedSide !== 'BUY' && resolvedSide !== 'SELL') throw new Error('side must be BUY or SELL.');
    }

    const result = await dispatchExecutionCommand({
      commandId: String(body?.commandId ?? '').trim() || undefined,
      terminalId: String(body?.terminalId ?? ''),
      type: commandType,
      payload: canonicalPayload,
      createdAt: String(body?.createdAt ?? new Date().toISOString()),
      expiresAt: String(body?.expiresAt ?? ''),
      environment: environment as any,
      sandboxMode,
      dedupeKey: typeof body?.dedupeKey === 'string' ? body.dedupeKey : undefined,
      maxAttempts: Number(body?.maxAttempts ?? 0) || undefined,
      intentId: String((body?.payload as Record<string, unknown> | undefined)?.intentId ?? '').trim() || undefined,
      source: 'EXECUTION_BRIDGE_API',
    });

    return Response.json(
      { ok: true, command: result.command, inserted: result.inserted, deduped: result.deduped ?? false, bridge: result.bridge },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ExecutionRiskBlockedError) {
      return Response.json(
        {
          ok: false,
          error: error.message,
          risk: {
            allowed: false,
            code: error.decision.code,
            message: error.decision.message,
            remainingDailyLossAmount: error.decision.remainingDailyLossAmount,
            accountNumber: error.accountNumber,
          },
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (error instanceof ExecutionPolicyBlockedError) {
      return Response.json({ ok: false, error: error.message, code: error.code }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to enqueue command.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
