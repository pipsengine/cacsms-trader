export interface PositionManagementMetadata {
  peakProfit: number;
  peakFavorablePoints: number;
  peakRMultiple: number;
  breakEvenApplied: boolean;
  profitLockApplied: boolean;
  partialCloseApplied: boolean;
  partialCloseStage: number;
  lastLockedSl: number | null;
  wasEverProfitable: boolean;
  lastPeakAt: string | null;
  lastActionAt: string | null;
}

export const EMPTY_POSITION_MANAGEMENT_METADATA: PositionManagementMetadata = {
  peakProfit: 0,
  peakFavorablePoints: 0,
  peakRMultiple: 0,
  breakEvenApplied: false,
  profitLockApplied: false,
  partialCloseApplied: false,
  partialCloseStage: 0,
  lastLockedSl: null,
  wasEverProfitable: false,
  lastPeakAt: null,
  lastActionAt: null,
};

export function parsePositionManagementMetadata(raw: unknown): PositionManagementMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...EMPTY_POSITION_MANAGEMENT_METADATA };
  }
  const value = raw as Record<string, unknown>;
  return {
    peakProfit: Number(value.peakProfit ?? 0),
    peakFavorablePoints: Number(value.peakFavorablePoints ?? 0),
    peakRMultiple: Number(value.peakRMultiple ?? 0),
    breakEvenApplied: Boolean(value.breakEvenApplied),
    profitLockApplied: Boolean(value.profitLockApplied),
    partialCloseApplied: Boolean(value.partialCloseApplied),
    partialCloseStage: Number(value.partialCloseStage ?? 0),
    lastLockedSl: value.lastLockedSl == null ? null : Number(value.lastLockedSl),
    wasEverProfitable: Boolean(value.wasEverProfitable),
    lastPeakAt: value.lastPeakAt ? String(value.lastPeakAt) : null,
    lastActionAt: value.lastActionAt ? String(value.lastActionAt) : null,
  };
}

export function mergePositionManagementMetadata(
  current: PositionManagementMetadata,
  input: {
    profitLoss: number;
    favorablePoints: number;
    rMultiple: number;
    nowIso: string;
  },
): PositionManagementMetadata {
  const next = { ...current };
  if (input.profitLoss > next.peakProfit) {
    next.peakProfit = input.profitLoss;
    next.peakFavorablePoints = Math.max(next.peakFavorablePoints, input.favorablePoints);
    next.peakRMultiple = Math.max(next.peakRMultiple, input.rMultiple);
    next.lastPeakAt = input.nowIso;
  }
  if (input.profitLoss > 0) next.wasEverProfitable = true;
  return next;
}
