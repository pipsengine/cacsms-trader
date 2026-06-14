export type CentralBankRateEventPageMeta = {
  currency: string;
  country: string;
  centralBank: string;
  eventName: string;
  investingUrl: string;
};

/** Investing.com interest-rate-decision event pages for G8 central banks. */
export const CENTRAL_BANK_RATE_EVENT_PAGES: Record<number, CentralBankRateEventPageMeta> = {
  164: {
    currency: 'EUR',
    country: 'Eurozone',
    centralBank: 'European Central Bank (ECB)',
    eventName: 'Interest Rate Decision',
    investingUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-164',
  },
  165: {
    currency: 'JPY',
    country: 'Japan',
    centralBank: 'Bank of Japan (BoJ)',
    eventName: 'Interest Rate Decision',
    investingUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-165',
  },
  166: {
    currency: 'CAD',
    country: 'Canada',
    centralBank: 'Bank of Canada (BoC)',
    eventName: 'Interest Rate Decision',
    investingUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-166',
  },
  167: {
    currency: 'NZD',
    country: 'New Zealand',
    centralBank: 'Reserve Bank of New Zealand (RBNZ)',
    eventName: 'Interest Rate Decision',
    investingUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-167',
  },
  168: {
    currency: 'USD',
    country: 'United States',
    centralBank: 'Federal Reserve (FOMC)',
    eventName: 'Interest Rate Decision',
    investingUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-168',
  },
  169: {
    currency: 'CHF',
    country: 'Switzerland',
    centralBank: 'Swiss National Bank (SNB)',
    eventName: 'Interest Rate Decision',
    investingUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-169',
  },
  170: {
    currency: 'GBP',
    country: 'United Kingdom',
    centralBank: 'Bank of England (BoE)',
    eventName: 'Interest Rate Decision',
    investingUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-170',
  },
  171: {
    currency: 'AUD',
    country: 'Australia',
    centralBank: 'Reserve Bank of Australia (RBA)',
    eventName: 'Interest Rate Decision',
    investingUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-171',
  },
};

export const CENTRAL_BANK_RATE_PAGE_IDS = Object.keys(CENTRAL_BANK_RATE_EVENT_PAGES)
  .map((id) => Number(id))
  .sort((a, b) => a - b);

export const centralBankEventIdByCurrency = Object.fromEntries(
  Object.entries(CENTRAL_BANK_RATE_EVENT_PAGES).map(([id, meta]) => [meta.currency.toUpperCase(), Number(id)]),
) as Record<string, number>;

export function resolveCentralBankRatePageId(input: { eventId?: number | null; currency?: string | null }): number | null {
  if (Number.isFinite(Number(input.eventId)) && CENTRAL_BANK_RATE_EVENT_PAGES[Number(input.eventId)]) {
    return Number(input.eventId);
  }
  const currency = String(input.currency ?? '')
    .trim()
    .toUpperCase();
  if (!currency) return null;
  const eventId = centralBankEventIdByCurrency[currency];
  return Number.isFinite(eventId) ? eventId : null;
}
