/** Cacsms Trader — Htf Vision
 * Production integration contract. UI currently runs against deterministic simulation fixtures.
 */
export const htfVisionSpec = {
  id: 'htfVision',
  stage: 5,
  title: 'Htf Vision',
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
