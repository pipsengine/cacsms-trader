import type { TradingSession } from '@/packages/shared-types';
import { isContinuousTradingEnabled } from './execution-risk-limits';

function envBool(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

/** When true, forex selection and execution ignore session windows (Mon–Fri all hours). */
export function is24HourTradingEnabled(): boolean {
  if (envBool('CACSMS_24H_TRADING_ENABLED', false)) return true;
  return isContinuousTradingEnabled();
}

/** Crypto / index symbols trade outside the forex weekly close. */
export function isExtendedHoursSymbol(symbol: string): boolean {
  const normalized = symbol.toUpperCase();
  return normalized.startsWith('BTC')
    || normalized.startsWith('ETH')
    || normalized.startsWith('XAU')
    || normalized.startsWith('XAG')
    || ['US30', 'UK100', 'NASDAQ100', 'NAS100', 'SP500', 'US500', 'SPX500'].includes(normalized);
}

export function isForexMarketOpen(now = new Date(), symbol?: string): boolean {
  if (symbol && isExtendedHoursSymbol(symbol)) return true;
  const utcDay = now.getUTCDay();
  const utcHour = now.getUTCHours();
  if (utcDay === 6) return false;
  if (utcDay === 0 && utcHour < 22) return false;
  if (utcDay === 5 && utcHour >= 22) return false;
  return true;
}

export function detectTradingSession(now = new Date(), symbol?: string): TradingSession {
  if (!isForexMarketOpen(now, symbol)) return 'closed';

  const hour = resolveSessionHour(now);
  if (hour >= 13 && hour < 17) return 'overlap';
  if (hour >= 8 && hour < 13) return 'london';
  if (hour >= 17 && hour < 22) return 'new_york';
  if (hour >= 0 && hour < 8) return 'asian';
  if (is24HourTradingEnabled()) return hour >= 22 ? 'new_york' : 'asian';
  return 'closed';
}

function resolveSessionHour(now: Date): number {
  const timeZone = String(process.env.CACSMS_TIMEZONE ?? 'UTC').trim() || 'UTC';
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(now));
}

export function isTradingSessionTradable(
  session: TradingSession,
  options?: { symbol?: string; now?: Date; continuousMode?: boolean },
): boolean {
  const now = options?.now ?? new Date();
  const symbol = options?.symbol;
  if (options?.continuousMode || is24HourTradingEnabled()) {
    return isForexMarketOpen(now, symbol) || Boolean(symbol && isExtendedHoursSymbol(symbol));
  }
  return session !== 'closed';
}

export function sessionRankingBoost(session: TradingSession, continuousMode = false): number {
  if (continuousMode || is24HourTradingEnabled()) {
    return session === 'closed' ? 0 : 8;
  }
  if (session === 'overlap') return 12;
  if (session === 'london' || session === 'new_york') return 8;
  if (session === 'asian') return 5;
  return 0;
}

export function shouldBypassNewsBlackout(): boolean {
  if (envBool('CACSMS_BYPASS_NEWS_BLACKOUT', false)) return true;
  return is24HourTradingEnabled() && envBool('CACSMS_ALLOW_TRADING_DURING_NEWS', true);
}
