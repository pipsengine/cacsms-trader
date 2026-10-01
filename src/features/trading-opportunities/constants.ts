/** UI-only grouping — backend OpportunityType codes are authoritative. */
export const OP_FAMILY: Record<string, readonly string[]> = {
  CONTINUATION: ['OP-01', 'OP-02', 'OP-03'],
  'TREND-IN-TREND': ['OP-04', 'OP-05'],
  BREAKOUT: ['OP-06', 'OP-07', 'OP-08', 'OP-09'],
  REVERSAL: ['OP-10'],
  RANGE: ['OP-11', 'OP-12'],
};

export const ALL_OP_TYPES = Object.values(OP_FAMILY).flat();

export const TERMINAL_LIFECYCLES = new Set(['COMPLETED', 'INVALIDATED', 'EXPIRED']);

export const STAGE_NAMES: Record<string, string> = {
  '1': 'Data',
  '2': 'Strength',
  '3': 'Regime',
  '4': 'Discovery',
  '5': 'Market Vision',
  '6': 'Structural Direction',
  '7': 'Confirmation',
  '8': 'Risk & Authorization',
  '9': 'Execution',
  '10': 'Learning',
};

export const STALE_MS = 120_000;

export const TRIGGER_LABELS: Record<string, string> = {
  UPPER_BOUNDARY_REACTION: 'Upper Boundary Reaction',
  LOWER_BOUNDARY_REACTION: 'Lower Boundary Reaction',
  INTERNAL_SUPPORT_REACTION: 'Internal Support Reaction',
  INTERNAL_RESISTANCE_REACTION: 'Internal Resistance Reaction',
  CHANNEL_BREAK: 'Channel Break',
  CHANNEL_RETEST: 'Channel Retest',
  TIT_ERZ_OR_CHILD_BREAK: 'TiT ERZ / Child Break',
  TIT_CORRECTION_TRIGGER: 'TiT Correction Trigger',
  CHILD_CHANNEL_BREAK: 'Child Channel Break',
  H1_PULLBACK_CONFIRMATION: 'H1 Pullback Confirmation',
  RANGE_BREAK_RETEST: 'Range Break + Retest',
  STRUCTURAL_BOS: 'Structural BOS',
  FAILED_BREAK_REENTRY: 'Failed Break Re-entry',
};
