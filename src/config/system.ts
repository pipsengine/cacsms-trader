export const SYSTEM = {
  name: 'Cacsms Trader', version: '2.0.0', mode: 'SIMULATION',
  universe: { currencies: ['USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD'], fxPairs: 28, metals: ['XAUUSD'], total: 29 },
  timeframes: { macro: ['Q1','MN1'], structure: ['D1','H8'], confirmation: ['H1'], execution: ['M15','M5'] },
  safety: { staleSignalProtection: true, requireRiskApproval: true, maxConcurrentPositions: 3, defaultRiskPct: .5, dailyLossLimitPct: 2.5 },
} as const;
