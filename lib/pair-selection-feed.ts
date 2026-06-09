import { getLatestPairSelection } from './pair-selector';
import { listPairSelectionEvents, type PairSelectionEvent } from './pair-selection-audit';
import { shouldRefreshPairSelection } from './pair-selector';

export interface PairSelectionFeed {
  latest: Awaited<ReturnType<typeof getLatestPairSelection>>;
  events: PairSelectionEvent[];
  stale: boolean;
  nextRefreshInMs: number | null;
  generatedAt: string;
}

const REFRESH_MS = Number(process.env.PAIR_SELECTION_REFRESH_MS ?? 5 * 60 * 1000);

export async function getPairSelectionFeed(limit = 25): Promise<PairSelectionFeed> {
  const latest = await getLatestPairSelection();
  const events = await listPairSelectionEvents(limit);
  const stale = shouldRefreshPairSelection(latest);
  const nextRefreshInMs = latest
    ? Math.max(0, REFRESH_MS - (Date.now() - new Date(latest.selectedAt).getTime()))
    : 0;

  return {
    latest,
    events,
    stale,
    nextRefreshInMs,
    generatedAt: new Date().toISOString(),
  };
}
