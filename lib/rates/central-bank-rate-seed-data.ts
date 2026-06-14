import { AUD_RATE_HISTORY_SEED } from '@/lib/rates/aud-rate-history-seed-data';
import { CAD_RATE_HISTORY_SEED } from '@/lib/rates/cad-rate-history-seed-data';
import { CHF_RATE_HISTORY_SEED } from '@/lib/rates/chf-rate-history-seed-data';
import { EUR_RATE_HISTORY_SEED } from '@/lib/rates/eur-rate-history-seed-data';
import { GBP_RATE_HISTORY_SEED } from '@/lib/rates/gbp-rate-history-seed-data';
import { JPY_RATE_HISTORY_SEED } from '@/lib/rates/jpy-rate-history-seed-data';
import { NZD_RATE_HISTORY_SEED } from '@/lib/rates/nzd-rate-history-seed-data';
import { USD_RATE_HISTORY_SEED } from '@/lib/rates/usd-rate-history-seed-data';

export type CentralBankRateSeedEntry = {
  eventId: number;
  currency: string;
  country: string;
  centralBank: string;
  eventName: string;
  sourceUrl: string;
  history: Array<{
    releaseDate: string;
    releaseTime: string;
    actualRate: number | null;
    forecastRate: number | null;
    previousRate: number | null;
  }>;
};

/** Bootstrap snapshot — major central-bank policy rates and recent decision history. */
export const CENTRAL_BANK_RATE_SEED: CentralBankRateSeedEntry[] = [
  {
    eventId: 168,
    currency: 'USD',
    country: 'United States',
    centralBank: 'Federal Reserve (FOMC)',
    eventName: 'Interest Rate Decision',
    sourceUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-168',
    history: [...USD_RATE_HISTORY_SEED],
  },
  {
    eventId: 164,
    currency: 'EUR',
    country: 'Eurozone',
    centralBank: 'European Central Bank (ECB)',
    eventName: 'Interest Rate Decision',
    sourceUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-164',
    history: [...EUR_RATE_HISTORY_SEED],
  },
  {
    eventId: 170,
    currency: 'GBP',
    country: 'United Kingdom',
    centralBank: 'Bank of England (BoE)',
    eventName: 'Interest Rate Decision',
    sourceUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-170',
    history: [...GBP_RATE_HISTORY_SEED],
  },
  {
    eventId: 165,
    currency: 'JPY',
    country: 'Japan',
    centralBank: 'Bank of Japan (BoJ)',
    eventName: 'Interest Rate Decision',
    sourceUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-165',
    history: [...JPY_RATE_HISTORY_SEED],
  },
  {
    eventId: 166,
    currency: 'CAD',
    country: 'Canada',
    centralBank: 'Bank of Canada (BoC)',
    eventName: 'Interest Rate Decision',
    sourceUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-166',
    history: [...CAD_RATE_HISTORY_SEED],
  },
  {
    eventId: 171,
    currency: 'AUD',
    country: 'Australia',
    centralBank: 'Reserve Bank of Australia (RBA)',
    eventName: 'Interest Rate Decision',
    sourceUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-171',
    history: [...AUD_RATE_HISTORY_SEED],
  },
  {
    eventId: 167,
    currency: 'NZD',
    country: 'New Zealand',
    centralBank: 'Reserve Bank of New Zealand (RBNZ)',
    eventName: 'Interest Rate Decision',
    sourceUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-167',
    history: [...NZD_RATE_HISTORY_SEED],
  },
  {
    eventId: 169,
    currency: 'CHF',
    country: 'Switzerland',
    centralBank: 'Swiss National Bank (SNB)',
    eventName: 'Interest Rate Decision',
    sourceUrl: 'https://www.investing.com/economic-calendar/interest-rate-decision-169',
    history: [...CHF_RATE_HISTORY_SEED],
  },
];
