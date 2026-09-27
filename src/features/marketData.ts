/** Cacsms Trader — Market Data (Stage 1)
 * Live implementation: MT5 bridge → enrich/validate → TradingContext → Workflow Stage 1 gates.
 */
export const marketDataSpec = {
  id: 'marketData',
  stage: 1,
  title: 'Market Data',
  responsibilities: [
    'Ingest MT5 ticks/bars via local bridge',
    'Validate freshness and quote integrity per instrument',
    'Publish timestamped outputs to the shared Market World Model',
    'Fail-closed Stage 1 gates (instrument-scoped, not global)',
    'Preserve audit-ready quality issues for the Feed Status / Data Quality tabs',
  ],
  lifecycle: ['IDLE', 'QUEUED', 'PROCESSING', 'CURRENT', 'STALE', 'DEGRADED', 'FAILED'],
  controls: { enabled: true, failClosed: true, audit: true },
} as const;
