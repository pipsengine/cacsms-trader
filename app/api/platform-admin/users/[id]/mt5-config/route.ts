import { canManageUser } from '@/lib/platform-auth/rbac';
import { encryptSecret } from '@/lib/platform-auth/crypto';
import { clientIp, jsonError, jsonOk, requirePlatformAuth } from '@/lib/platform-auth/request-auth';
import { getMt5Config, getUserById, insertAuditLog, updateMt5Config } from '@/lib/platform-auth/store';

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

    return jsonOk({ mt5: await getMt5Config(id) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load MT5 config.', 500);
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
    if (!isSelf && auth.user.role === 'viewer') {
      return jsonError('Insufficient permissions.', 403);
    }

    const body = await request.json().catch(() => ({}));
    const patch: Parameters<typeof updateMt5Config>[1] = {};

    if (body.brokerName !== undefined) patch.brokerName = String(body.brokerName);
    if (body.accountNumber !== undefined) patch.accountNumber = String(body.accountNumber);
    if (body.serverName !== undefined) patch.serverName = String(body.serverName);
    if (body.terminalId !== undefined) patch.terminalId = body.terminalId ? String(body.terminalId) : null;
    if (body.symbol !== undefined) patch.symbol = String(body.symbol);
    if (body.connectionStatus !== undefined) patch.connectionStatus = String(body.connectionStatus);
    if (body.password) patch.encryptedPassword = encryptSecret(String(body.password), id);
    if (body.investorPassword) patch.encryptedInvestorPassword = encryptSecret(String(body.investorPassword), id);

    const mt5 = await updateMt5Config(id, patch);

    await insertAuditLog({
      actorUserId: auth.user.id,
      targetUserId: id,
      category: 'mt5',
      action: 'mt5_config_updated',
      detail: { fields: Object.keys(patch).filter((k) => !k.startsWith('encrypted')) },
      ipAddress: clientIp(request),
    });

    return jsonOk({ mt5 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update MT5 config.', 500);
  }
}
