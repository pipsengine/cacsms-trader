import { isContinuousTradingEnabled } from './execution-risk-limits';
import { SYSTEM_FOCUS_SYMBOLS } from './focus-symbols';
import type { PairSelectionResult } from './pair-selector';

/** All symbols that should advance through the autonomous pipeline this cycle. */
export function resolvePipelineSymbolUniverse(
  requestedSymbol: string,
  latestSelection: PairSelectionResult | null,
): string[] {
  const normalized = requestedSymbol.toUpperCase();
  if (normalized !== 'AUTO') return [normalized];

  if (isContinuousTradingEnabled()) {
    return [...SYSTEM_FOCUS_SYMBOLS];
  }

  if (!latestSelection) return ['XAUUSD'];

  const qualified = (latestSelection.qualifiedSymbols ?? latestSelection.eligibleSymbols ?? [])
    .map((symbol) => symbol.toUpperCase())
    .filter(Boolean);
  const monitoring = (latestSelection.openPositionSymbols ?? [])
    .map((symbol) => symbol.toUpperCase())
    .filter(Boolean);
  const pipelineSymbols = [...new Set([...qualified, ...monitoring])];
  if (pipelineSymbols.length > 0) return pipelineSymbols;

  const tradable = latestSelection.candidates
    .filter((candidate) => candidate.tradable && candidate.eligibleForNewEntry !== false)
    .sort((a, b) => a.rank - b.rank)
    .map((candidate) => candidate.symbol.toUpperCase());
  if (tradable.length > 0) return [...new Set(tradable)];

  const selected = latestSelection.selectedSymbols.map((symbol) => symbol.toUpperCase());
  if (selected.length > 0) return [...new Set(selected)];

  return [latestSelection.selectedSymbol.toUpperCase()];
}
