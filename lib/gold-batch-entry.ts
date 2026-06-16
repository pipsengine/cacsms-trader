import { goldEntryLegCount } from '@/lib/gold-trading-engine';

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeLots(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(Math.max(0, Math.floor(value * 100 + 1e-9) / 100).toFixed(2));
}

/** Minimum lot size per batch leg (each position). */
export function goldLegLotsPerPosition(): number {
  return Math.max(0.01, normalizeLots(envNumber('CACSMS_GOLD_LEG_LOTS', 0.01)));
}

/**
 * Batch lot mode:
 * - replicate (default): open N separate positions, each at per-leg size (e.g. 5 × 0.01)
 * - split: divide total sized volume across legs (legacy — collapses to 1 leg when total is 0.01)
 */
export function goldBatchLotMode(): 'replicate' | 'split' {
  const raw = String(process.env.CACSMS_GOLD_BATCH_LOT_MODE ?? 'replicate').trim().toLowerCase();
  return raw === 'split' ? 'split' : 'replicate';
}

/** Split total lots evenly across N legs, preserving total volume to 0.01 lot precision. */
export function splitLotsAcrossLegs(totalLots: number, legCount = goldEntryLegCount()): number[] {
  const total = normalizeLots(totalLots);
  const legs = Math.max(1, Math.min(legCount, Math.floor(total / 0.01) || 1));
  if (legs <= 1 || total < 0.02) return [Math.max(total, 0.01)];

  const base = normalizeLots(total / legs);
  if (base < 0.01) return [total];

  const output = Array.from({ length: legs }, () => base);
  const allocated = normalizeLots(base * legs);
  const remainder = normalizeLots(total - allocated);
  if (remainder >= 0.01) {
    output[0] = normalizeLots(output[0] + remainder);
  }
  return output.filter((lots) => lots >= 0.01);
}

/** Build per-leg volumes for a batch entry — always returns `legCount` legs when replicating. */
export function buildBatchLegVolumes(totalLots: number, legCount = goldEntryLegCount()): number[] {
  const count = Math.max(1, legCount);

  if (goldBatchLotMode() === 'split') {
    const split = splitLotsAcrossLegs(totalLots, count);
    if (split.length >= count) return split.slice(0, count);
    while (split.length < count) split.push(split[split.length - 1] ?? goldLegLotsPerPosition());
    return split;
  }

  const perLeg = Math.max(goldLegLotsPerPosition(), normalizeLots(totalLots));
  return Array.from({ length: count }, () => perLeg);
}

export function buildBatchLegMetadata(input: {
  setupGroupId: string;
  basketId: string;
  legIndex: number;
  legCount: number;
  batchEntry: boolean;
}): Record<string, unknown> {
  return {
    setupGroupId: input.setupGroupId,
    basketId: input.basketId,
    legIndex: input.legIndex,
    legCount: input.legCount,
    batchEntry: input.batchEntry,
    basketManaged: input.batchEntry && input.legCount >= 5,
  };
}

export function totalBatchExposureLots(legVolumes: number[]): number {
  return normalizeLots(legVolumes.reduce((sum, lots) => sum + lots, 0));
}
