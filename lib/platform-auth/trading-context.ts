import { getTradingConfig, getUserById } from '@/lib/platform-auth/store';
import { listUserTradingAccounts } from '@/lib/platform-auth/enterprise-store';
import type { PlatformTradingAccountLink, PlatformTradingConfig, PlatformUserPublic } from '@/lib/platform-auth/types';

export type PlatformTradingContext = {
  user: PlatformUserPublic;
  trading: PlatformTradingConfig;
  accounts: PlatformTradingAccountLink[];
  primaryAccount: PlatformTradingAccountLink | null;
};

export async function resolvePlatformTradingContext(userId: string): Promise<PlatformTradingContext | null> {
  const user = await getUserById(userId);
  if (!user || user.status !== 'active') return null;

  const [trading, accounts] = await Promise.all([
    getTradingConfig(userId),
    listUserTradingAccounts(userId),
  ]);

  return {
    user,
    trading,
    accounts,
    primaryAccount: accounts.find((account) => account.isPrimary) ?? accounts[0] ?? null,
  };
}

export async function isPlatformTradingEnabledForUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return true;
  const context = await resolvePlatformTradingContext(userId);
  if (!context) return false;
  return context.trading.tradingEnabled && context.trading.goldEngineEnabled;
}
