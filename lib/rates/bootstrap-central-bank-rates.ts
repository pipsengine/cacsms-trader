import { CentralBankRateHistoryCollectorService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

let bootstrapInflight: Promise<void> | null = null;

export async function bootstrapCentralBankRatesIfEmpty(): Promise<void> {
  if (bootstrapInflight) {
    await bootstrapInflight.catch(() => null);
    return;
  }

  const collector = new CentralBankRateHistoryCollectorService();
  bootstrapInflight = collector
    .registerAllEventPages()
    .then(() => collector.bootstrapFromSeedIfEmpty(false))
    .then(() => undefined)
    .finally(() => {
      bootstrapInflight = null;
    });

  await bootstrapInflight.catch(() => null);
}

export async function bootstrapCentralBankRatesFromSeed(force = false) {
  const collector = new CentralBankRateHistoryCollectorService();
  await collector.registerAllEventPages().catch(() => null);
  return collector.bootstrapFromSeedIfEmpty(force);
}

export async function registerCentralBankRateEventPages(): Promise<void> {
  await new CentralBankRateHistoryCollectorService().registerAllEventPages();
}
