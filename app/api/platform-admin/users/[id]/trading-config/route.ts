import { canManageUser, hasPermission } from '@/lib/platform-auth/rbac';
import { clientIp, jsonError, jsonOk, requirePlatformAuth } from '@/lib/platform-auth/request-auth';
import { getTradingConfig, getUserById, insertAuditLog, updateTradingConfig } from '@/lib/platform-auth/store';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request);
    if (auth instanceof Response) return auth;

    const { id } = await context.params;
    const target = await getUserById(id);
    if (!target) return jsonError('User not found.', 404);
    if (!canManageUser(auth.user, target) && auth.user.id !== id) {
      return jsonError('Insufficient permissions.', 403);
    }

    return jsonOk({ trading: await getTradingConfig(id) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load trading config.', 500);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request);
    if (auth instanceof Response) return auth;

    const { id } = await context.params;
    const target = await getUserById(id);
    if (!target) return jsonError('User not found.', 404);

    const isSelf = auth.user.id === id;
    if (!isSelf && !canManageUser(auth.user, target)) {
      return jsonError('Insufficient permissions.', 403);
    }
    if (!isSelf && !hasPermission(auth.user, 'manage_user_trading')) {
      return jsonError('Insufficient permissions.', 403);
    }
    if (isSelf && !hasPermission(auth.user, 'manage_own_trading_config')) {
      return jsonError('Insufficient permissions.', 403);
    }

    const body = await request.json().catch(() => ({}));
    if (!isSelf && body.goldEngineEnabled !== undefined && !hasPermission(auth.user, 'enable_disable_trading_engine')) {
      return jsonError('Insufficient permissions to toggle trading engine.', 403);
    }

    const trading = await updateTradingConfig(id, {
      tradingEnabled: body.tradingEnabled,
      lotSize: body.lotSize !== undefined ? Number(body.lotSize) : undefined,
      riskPerTradePercent: body.riskPerTradePercent !== undefined ? Number(body.riskPerTradePercent) : undefined,
      dailyDrawdownPercent: body.dailyDrawdownPercent !== undefined ? Number(body.dailyDrawdownPercent) : undefined,
      maxOpenTrades: body.maxOpenTrades !== undefined ? Number(body.maxOpenTrades) : undefined,
      basketLimit: body.basketLimit !== undefined ? Number(body.basketLimit) : undefined,
      profitLockEnabled: body.profitLockEnabled,
      profitLockPercent: body.profitLockPercent !== undefined ? Number(body.profitLockPercent) : undefined,
      goldEngineEnabled: body.goldEngineEnabled,
    });

    await insertAuditLog({
      actorUserId: auth.user.id,
      targetUserId: id,
      category: 'trading',
      action: 'trading_config_updated',
      detail: { goldEngineEnabled: trading.goldEngineEnabled, tradingEnabled: trading.tradingEnabled },
      ipAddress: clientIp(request),
    });

    return jsonOk({ trading });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update trading config.', 500);
  }
}
