/** Cacsms Trader — H1 Confirmation
 * Production integration contract. UI currently runs against deterministic simulation fixtures.
 */
export const h1ConfirmationSpec = {
  id: 'h1Confirmation',
  stage: 7,
  title: 'H1 Confirmation',
  responsibilities: [
    'Validate required upstream state before processing',
    'Publish timestamped outputs to the shared Market World Model',
    'Attach confidence, provenance, freshness and invalidation metadata',
    'Emit events only when state materially changes',
    'Preserve a complete decision audit record for every instrument',
  ],
  lifecycle: ['IDLE','QUEUED','PROCESSING','CURRENT','STALE','DEGRADED','FAILED'],
  controls: { enabled: true, failClosed: true, audit: true },
} as const;
