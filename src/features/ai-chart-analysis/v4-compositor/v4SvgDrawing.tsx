import type { DrawTool } from '../production-v4/components/ChartDrawTools';
import type { UserDrawing } from '../production-v4/components/ChartDrawOverlay';

export function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

const NO_DRAW: DrawTool[] = ['crosshair', 'lock', 'magnet', 'trash', 'zoom', 'hide', 'link', 'penlock'];

export function isDrawTool(tool: DrawTool): boolean {
  return !NO_DRAW.includes(tool);
}

type SnapInput = {
  x: number;
  y: number;
  magnet: boolean;
  candles: Array<{ open: number; high: number; low: number; close: number }>;
  indexAt: (x: number) => number;
  priceAt: (p: number) => number;
  xAt: (i: number) => number;
};

export function snapPoint(input: SnapInput): { x: number; y: number } {
  if (!input.magnet) return { x: input.x, y: input.y };
  const i = input.indexAt(input.x);
  const c = input.candles[i];
  if (!c) return { x: input.x, y: input.y };
  const candidates = [c.open, c.high, c.low, c.close].map((p) => ({
    x: input.xAt(i),
    y: input.priceAt(p),
  }));
  let best = { x: input.x, y: input.y };
  let bestD = Infinity;
  for (const p of candidates) {
    const d = Math.hypot(p.x - input.x, p.y - input.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function addLine(
  drawings: UserDrawing[],
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  dash?: string,
): UserDrawing[] {
  return [...drawings, { id, kind: 'line', x1, y1, x2, y2, color, dash }];
}

function addMultiline(
  drawings: UserDrawing[],
  id: string,
  segments: { x1: number; y1: number; x2: number; y2: number }[],
  color: string,
): UserDrawing[] {
  return [...drawings, { id, kind: 'multiline', segments, color }];
}

export function finishDrawing(
  tool: DrawTool,
  drawings: UserDrawing[],
  start: { x: number; y: number },
  end: { x: number; y: number },
): UserDrawing[] {
  const id = `d-${Date.now()}`;
  if (tool === 'hline') return addLine(drawings, id, start.x, start.y, end.x, start.y, '#e8eef5', '6 4');
  if (tool === 'vline') return addLine(drawings, id, start.x, start.y, start.x, end.y, '#e8eef5', '6 4');
  if (tool === 'ray' || tool === 'trendline' || tool === 'measure' || tool === 'brush') {
    const color = tool === 'measure' ? '#f1b83f' : tool === 'brush' ? '#51d9ff' : '#8eb4ff';
    return addLine(drawings, id, start.x, start.y, end.x, end.y, color);
  }
  if (tool === 'pitchfork') {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const off = Math.max(12, Math.hypot(dx, dy) * 0.35);
    const nx = -dy * 0.15;
    const ny = dx * 0.15;
    return addMultiline(
      drawings,
      id,
      [
        { x1: start.x, y1: start.y, x2: end.x, y2: end.y },
        { x1: start.x + nx, y1: start.y + ny - off, x2: end.x + nx, y2: end.y + ny - off },
        { x1: start.x - nx, y1: start.y - ny + off, x2: end.x - nx, y2: end.y - ny + off },
      ],
      '#e8eef5',
    );
  }
  if (tool === 'rectangle' || tool === 'geometric') {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if (w > 4 && h > 4) {
      return [
        ...drawings,
        {
          id,
          kind: 'rect',
          x,
          y,
          w,
          h,
          color: tool === 'geometric' ? 'rgba(142,180,255,0.12)' : 'rgba(239,78,140,0.18)',
          label: tool === 'geometric' ? undefined : 'Zone',
        },
      ];
    }
  }
  return drawings;
}

export function UserDrawingLayer({ drawings }: { drawings: UserDrawing[] }) {
  return (
    <>
      {drawings.map((d) => {
        if (d.kind === 'line') {
          return (
            <line
              key={d.id}
              x1={d.x1}
              y1={d.y1}
              x2={d.x2}
              y2={d.y2}
              stroke={d.color}
              strokeWidth={d.dash ? 1.5 : 2}
              strokeDasharray={d.dash}
            />
          );
        }
        if (d.kind === 'multiline') {
          return (
            <g key={d.id}>
              {d.segments.map((s, i) => (
                <line
                  key={i}
                  x1={s.x1}
                  y1={s.y1}
                  x2={s.x2}
                  y2={s.y2}
                  stroke={d.color}
                  strokeWidth={1.5}
                  strokeDasharray={i > 0 ? '4 3' : undefined}
                />
              ))}
            </g>
          );
        }
        if (d.kind === 'rect') {
          return (
            <g key={d.id}>
              <rect x={d.x} y={d.y} width={d.w} height={d.h} fill={d.color} stroke="#e14f8b" strokeWidth={1} />
              {d.label ? (
                <text x={d.x + 6} y={d.y + 14} fill="#e6eef5" fontSize={10}>
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        }
        return (
          <text key={d.id} x={d.x} y={d.y} fill="#eaf7ff" fontSize={11}>
            {d.text}
          </text>
        );
      })}
    </>
  );
}
