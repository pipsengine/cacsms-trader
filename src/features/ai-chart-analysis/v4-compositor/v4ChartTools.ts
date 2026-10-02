import type { DrawTool } from '../production-v4/components/ChartDrawTools';

export type V4RailTool = {
  icon: string;
  tool: DrawTool;
  label: string;
  /** If true, selecting keeps navigate (pan/zoom) mode. */
  navigate?: boolean;
};

/** v4 reference tool rail → drawing / navigation actions. */
export const V4_RAIL_TOOLS: V4RailTool[] = [
  { icon: '＋', tool: 'crosshair', label: 'Crosshair (pan & zoom)', navigate: true },
  { icon: '⌁', tool: 'zoom', label: 'Zoom to fit' },
  { icon: '♨', tool: 'hide', label: 'Toggle user drawings' },
  { icon: '⌘', tool: 'trendline', label: 'Trend line' },
  { icon: '⌗', tool: 'hline', label: 'Horizontal line' },
  { icon: 'T', tool: 'text', label: 'Text label' },
  { icon: '□', tool: 'rectangle', label: 'Rectangle zone' },
  { icon: '╱', tool: 'ray', label: 'Ray / line' },
  { icon: '◉', tool: 'magnet', label: 'Magnet (snap to OHLC)' },
  { icon: '∩', tool: 'pitchfork', label: 'Parallel channel' },
  { icon: '✎', tool: 'brush', label: 'Freehand segment' },
  { icon: '▣', tool: 'trash', label: 'Clear drawings' },
];
