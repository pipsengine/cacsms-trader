export type ChartOverlayFlags = {
  channel: boolean;
  channelFill: boolean;
  supertrend: boolean;
  zones: boolean;
  expectedPath: boolean;
  thesisTags: boolean;
  structureMarkers: boolean;
  volume: boolean;
  p2Line: boolean;
};

export const DEFAULT_CHART_OVERLAYS: ChartOverlayFlags = {
  channel: true,
  channelFill: true,
  supertrend: true,
  zones: true,
  expectedPath: true,
  thesisTags: true,
  structureMarkers: true,
  volume: true,
  p2Line: true,
};

export const OVERLAY_TOGGLE_LABELS: { key: keyof ChartOverlayFlags; label: string }[] = [
  { key: 'supertrend', label: 'Supertrend' },
  { key: 'channel', label: 'Trend channel' },
  { key: 'channelFill', label: 'Channel fill' },
  { key: 'zones', label: 'Supply / ERZ zones' },
  { key: 'expectedPath', label: 'Expected path' },
  { key: 'thesisTags', label: 'T1 / T2 / Invalidation' },
  { key: 'structureMarkers', label: 'BOS / CHOCH' },
  { key: 'p2Line', label: 'P2 break line' },
  { key: 'volume', label: 'Volume' },
];
