export const STRATEGY_GROUP_SLUGS = [
  'trend-following-strategies',
  'breakout-trading-strategies',
  'scalping-strategies',
  'day-trading-strategies',
  'swing-trading-strategies',
  'position-trading-strategies',
  'price-action-strategies',
  'indicator-based-strategies',
  'mean-reversion-strategies',
  'momentum-trading-strategies',
  'reversal-trading-strategies',
  'range-trading-strategies',
  'smart-money-and-institutional-strategies',
  'quantitative-and-algorithmic-strategies',
  'fundamental-trading-strategies',
  'news-trading-strategies',
  'correlation-and-intermarket-strategies',
  'volatility-based-strategies',
  'hedging-strategies',
  'arbitrage-strategies',
  'session-based-strategies',
  'pattern-trading-strategies',
  'candlestick-trading-strategies',
  'risk-management-strategies',
  'advanced-professional-and-institutional-models',
  'hybrid-strategies',
] as const;

export function strategyPageHref(pageId: string): string | null {
  for (const group of STRATEGY_GROUP_SLUGS) {
    const prefix = `${group}-`;
    if (pageId.startsWith(prefix)) {
      return `/institutional-strategy-intelligence/${group}/${pageId.slice(prefix.length)}`;
    }
  }
  return null;
}

export function strategyPageIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/institutional-strategy-intelligence\/([^/]+)\/([^/]+)$/);
  if (!match?.[1] || !match[2]) return null;
  return `${match[1]}-${match[2]}`;
}
