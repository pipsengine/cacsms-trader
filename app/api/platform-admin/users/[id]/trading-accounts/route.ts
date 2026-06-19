import { canManageUser } from '@/lib/platform-auth/rbac';
import { clientIp, jsonError, jsonOk, requirePlatformAuth } from '@/lib/platform-auth/request-auth';
import { getUserById, insertAuditLog } from '@/lib/platform-auth/store';
import {
  createUserTradingAccount,
  deleteUserTradingAccount,
  listUserEaInstances,
  listUserTradingAccounts,
  updateUserTradingAccount,
} from '@/lib/platform-auth/enterprise-store';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request);
    if (auth instanceof Response) return auth;

    const { id } = await context.params;
    const user = await getUserById(id);
    if (!user) return jsonError('User not found.', 404);
    if (!canManageUser(auth.user, user) && auth.user.id !== user.id) {
      return jsonError('Insufficient permissions.', 403);
    }

    const [accounts, eaInstances] = await Promise.all([
      listUserTradingAccounts(id),
      listUserEaInstances(id),
    ]);

    return jsonOk({ accounts, eaInstances });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load trading accounts.', 500);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request);
    if (auth instanceof Response) return auth;

    const { id } = await context.params;
    const user = await getUserById(id);
    if (!user) return jsonError('User not found.', 404);
    if (!canManageUser(auth.user, user) && auth.user.id !== user.id) {
      return jsonError('Insufficient permissions.', 403);
    }

    const body = await request.json().catch(() => ({}));
    const account = await createUserTradingAccount({
      userId: id,
      label: body.label ? String(body.label) : undefined,
      accountNumber: String(body.accountNumber ?? ''),
      brokerName: body.brokerName ? String(body.brokerName) : undefined,
      serverName: body.serverName ? String(body.serverName) : undefined,
      terminalId: body.terminalId ? String(body.terminalId) : null,
      symbol: body.symbol ? String(body.symbol) : undefined,
      isPrimary: Boolean(body.isPrimary),
      tradingEnabled: body.tradingEnabled !== false,
      goldEngineEnabled: Boolean(body.goldEngineEnabled),
    });

    await insertAuditLog({
      actorUserId: auth.user.id,
      targetUserId: id,
      category: 'mt5',
      action: 'trading_account_created',
      detail: { accountId: account.id, accountNumber: account.accountNumber },
      ipAddress: clientIp(request),
    });

    return jsonOk({ account });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to create trading account.', 500);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request);
    if (auth instanceof Response) return auth;

    const { id } = await context.params;
    const user = await getUserById(id);
    if (!user) return jsonError('User not found.', 404);
    if (!canManageUser(auth.user, user) && auth.user.id !== user.id) {
      return jsonError('Insufficient permissions.', 403);
    }

    const body = await request.json().catch(() => ({}));
    const accountId = String(body.accountId ?? '');
    if (!accountId) return jsonError('accountId is required.');

    const account = await updateUserTradingAccount(accountId, {
      label: body.label !== undefined ? String(body.label) : undefined,
      accountNumber: body.accountNumber !== undefined ? String(body.accountNumber) : undefined,
      brokerName: body.brokerName !== undefined ? String(body.brokerName) : undefined,
      serverName: body.serverName !== undefined ? String(body.serverName) : undefined,
      terminalId: body.terminalId !== undefined ? (body.terminalId ? String(body.terminalId) : null) : undefined,
      symbol: body.symbol !== undefined ? String(body.symbol) : undefined,
      isPrimary: body.isPrimary !== undefined ? Boolean(body.isPrimary) : undefined,
      tradingEnabled: body.tradingEnabled !== undefined ? Boolean(body.tradingEnabled) : undefined,
      goldEngineEnabled: body.goldEngineEnabled !== undefined ? Boolean(body.goldEngineEnabled) : undefined,
    });

    if (!account || account.userId !== id) return jsonError('Trading account not found.', 404);

    await insertAuditLog({
      actorUserId: auth.user.id,
      targetUserId: id,
      category: 'mt5',
      action: 'trading_account_updated',
      detail: { accountId: account.id },
      ipAddress: clientIp(request),
    });

    return jsonOk({ account });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update trading account.', 500);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request);
    if (auth instanceof Response) return auth;

    const { id } = await context.params;
    const user = await getUserById(id);
    if (!user) return jsonError('User not found.', 404);
    if (!canManageUser(auth.user, user)) {
      return jsonError('Insufficient permissions.', 403);
    }

    const url = new URL(request.url);
    const accountId = url.searchParams.get('accountId');
    if (!accountId) return jsonError('accountId is required.');

    await deleteUserTradingAccount(accountId);
    await insertAuditLog({
      actorUserId: auth.user.id,
      targetUserId: id,
      category: 'mt5',
      action: 'trading_account_deleted',
      detail: { accountId },
      ipAddress: clientIp(request),
    });

    return jsonOk({ message: 'Trading account removed.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to delete trading account.', 500);
  }
}
