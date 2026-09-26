/** Cacsms Trader — System Control
 * Production integration contract. UI currently runs against deterministic simulation fixtures.
 */
export const systemControlSpec = {
  id: 'systemControl',
  stage: 10,
  title: 'System Control',
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
