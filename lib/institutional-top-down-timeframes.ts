/** Institutional analysis stack — monthly anchor through M15 execution context. */
export const INSTITUTIONAL_MTF_TIMEFRAMES = ['MN', 'W', 'D', 'H4', 'H1', 'M15'] as const;

export type InstitutionalMtfTimeframe = (typeof INSTITUTIONAL_MTF_TIMEFRAMES)[number];

export const INSTITUTIONAL_MTF_WEIGHTS: Record<InstitutionalMtfTimeframe, number> = {
  MN: 0.32,
  W: 0.24,
  D: 0.2,
  H4: 0.14,
  H1: 0.06,
  M15: 0.04,
};

export const INSTITUTIONAL_MTF_ALIGNMENT_PAIRS: Array<[InstitutionalMtfTimeframe, InstitutionalMtfTimeframe]> = [
  ['MN', 'W'],
  ['W', 'D'],
  ['D', 'H4'],
  ['H4', 'H1'],
  ['H1', 'M15'],
];

export const INSTITUTIONAL_MACRO_HTF: InstitutionalMtfTimeframe[] = ['MN', 'W'];

export const INSTITUTIONAL_STRUCTURE_HTF: InstitutionalMtfTimeframe[] = ['D', 'H4'];

export const INSTITUTIONAL_DIRECTIONAL_HTF: InstitutionalMtfTimeframe[] = ['MN', 'W', 'D', 'H4'];
