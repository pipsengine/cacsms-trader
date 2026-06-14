import { STRATEGY_CONTROL_SLUGS } from '@/lib/strategies/strategy-control-modules';
import { RESEARCH_EVOLUTION_SLUGS } from '@/lib/strategies/research-evolution-modules';

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

export function strategyControlPageHref(pageId: string): string | null {
  const prefix = 'strategy-control-';
  const slug = pageId.startsWith(prefix)
    ? pageId.slice(prefix.length)
    : (STRATEGY_CONTROL_SLUGS as readonly string[]).includes(pageId)
      ? pageId
      : null;
  if (!slug || !(STRATEGY_CONTROL_SLUGS as readonly string[]).includes(slug)) return null;
  return `/institutional-strategy-intelligence/strategy-control/${slug}`;
}

export function strategyControlPageIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/institutional-strategy-intelligence\/strategy-control\/([^/]+)$/);
  if (!match?.[1]) return null;
  return `strategy-control-${match[1]}`;
}

export function researchEvolutionPageHref(pageId: string): string | null {
  const prefix = 'research-and-evolution-';
  const slug = pageId.startsWith(prefix)
    ? pageId.slice(prefix.length)
    : (RESEARCH_EVOLUTION_SLUGS as readonly string[]).includes(pageId)
      ? pageId
      : null;
  if (!slug || !(RESEARCH_EVOLUTION_SLUGS as readonly string[]).includes(slug)) return null;
  return `/institutional-strategy-intelligence/research-and-evolution/${slug}`;
}

export function researchEvolutionPageIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/institutional-strategy-intelligence\/research-and-evolution\/([^/]+)$/);
  if (!match?.[1]) return null;
  return `research-and-evolution-${match[1]}`;
}

export function strategyPageHref(pageId: string): string | null {
  const controlHref = strategyControlPageHref(pageId);
  if (controlHref) return controlHref;
  const researchHref = researchEvolutionPageHref(pageId);
  if (researchHref) return researchHref;
  for (const group of STRATEGY_GROUP_SLUGS) {
    const prefix = `${group}-`;
    if (pageId.startsWith(prefix)) {
      return `/institutional-strategy-intelligence/${group}/${pageId.slice(prefix.length)}`;
    }
  }
  return null;
}

export function strategyPageIdFromPath(pathname: string): string | null {
  const controlId = strategyControlPageIdFromPath(pathname);
  if (controlId) return controlId;
  const researchId = researchEvolutionPageIdFromPath(pathname);
  if (researchId) return researchId;
  const match = pathname.match(/^\/institutional-strategy-intelligence\/([^/]+)\/([^/]+)$/);
  if (!match?.[1] || !match[2]) return null;
  return `${match[1]}-${match[2]}`;
}
