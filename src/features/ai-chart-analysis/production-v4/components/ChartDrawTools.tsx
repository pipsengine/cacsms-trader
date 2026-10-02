import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpRight,
  Crosshair,
  EyeOff,
  GitBranch,
  Link2,
  Lock,
  Magnet,
  MoveHorizontal,
  MoveVertical,
  PenLine,
  Pencil,
  Ruler,
  Square,
  Trash2,
  TrendingUp,
  Type,
  VectorSquare,
  Waypoints,
  ZoomIn,
} from 'lucide-react';

/** Full TradingView-style drawing rail (reference mockup). */
export type DrawTool =
  | 'crosshair'
  | 'trendline'
  | 'hline'
  | 'ray'
  | 'vline'
  | 'pitchfork'
  | 'fib'
  | 'brush'
  | 'geometric'
  | 'text'
  | 'rectangle'
  | 'measure'
  | 'zoom'
  | 'magnet'
  | 'link'
  | 'lock'
  | 'penlock'
  | 'hide'
  | 'trash';

type ToolDef = { id: DrawTool; icon: LucideIcon; label: string };

const GROUPS: ToolDef[][] = [
  [{ id: 'crosshair', icon: Crosshair, label: 'Crosshair' }],
  [
    { id: 'trendline', icon: TrendingUp, label: 'Trend line' },
    { id: 'hline', icon: MoveHorizontal, label: 'Horizontal line' },
    { id: 'ray', icon: ArrowUpRight, label: 'Ray' },
    { id: 'vline', icon: MoveVertical, label: 'Vertical line' },
    { id: 'pitchfork', icon: GitBranch, label: 'Parallel channel / pitchfork' },
    { id: 'fib', icon: Waypoints, label: 'Fibonacci retracement' },
  ],
  [
    { id: 'brush', icon: Pencil, label: 'Brush' },
    { id: 'geometric', icon: VectorSquare, label: 'Geometric shapes' },
    { id: 'text', icon: Type, label: 'Text' },
    { id: 'rectangle', icon: Square, label: 'Rectangle' },
  ],
  [{ id: 'measure', icon: Ruler, label: 'Measure' }],
  [
    { id: 'zoom', icon: ZoomIn, label: 'Zoom to fit' },
    { id: 'magnet', icon: Magnet, label: 'Magnet mode' },
    { id: 'link', icon: Link2, label: 'Link to scale (magnet)' },
  ],
  [
    { id: 'lock', icon: Lock, label: 'Lock all drawings' },
    { id: 'penlock', icon: PenLine, label: 'Keep drawing mode' },
    { id: 'hide', icon: EyeOff, label: 'Hide drawings' },
    { id: 'trash', icon: Trash2, label: 'Remove drawings' },
  ],
];

export function ChartDrawTools({
  active,
  onTool,
  locked,
  magnet,
  penlock,
  drawingsHidden,
}: {
  active: DrawTool;
  onTool: (t: DrawTool) => void;
  locked: boolean;
  magnet: boolean;
  penlock: boolean;
  drawingsHidden: boolean;
}) {
  return (
    <div className="drawToolsTv" role="toolbar" aria-label="Chart drawing tools">
      {GROUPS.map((group, gi) => (
        <div key={gi} className="drawToolsGroup">
          {group.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              className={[
                id === 'crosshair' && active === 'crosshair' ? 'tvCrosshairActive' : '',
                active === id ||
                (id === 'lock' && locked) ||
                (id === 'magnet' && magnet) ||
                (id === 'penlock' && penlock) ||
                (id === 'hide' && drawingsHidden)
                  ? 'active'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={label}
              aria-label={label}
              aria-pressed={
                id === 'lock'
                  ? locked
                  : id === 'magnet'
                    ? magnet
                    : id === 'penlock'
                      ? penlock
                      : id === 'hide'
                        ? drawingsHidden
                        : active === id
              }
              onClick={() => onTool(id)}
            >
              <Icon size={19} strokeWidth={1.35} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
