import { useCallback, useRef, useState } from 'react';
import type { DrawTool } from './ChartDrawTools';

export type UserDrawing =
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; dash?: string }
  | { id: string; kind: 'rect'; x: number; y: number; w: number; h: number; color: string; label?: string }
  | { id: string; kind: 'text'; x: number; y: number; text: string }
  | { id: string; kind: 'multiline'; segments: { x1: number; y1: number; x2: number; y2: number }[]; color: string };

const NO_DRAW: DrawTool[] = [
  'crosshair',
  'lock',
  'magnet',
  'trash',
  'zoom',
  'hide',
  'link',
  'penlock',
];

type Props = {
  tool: DrawTool;
  locked: boolean;
  drawings: UserDrawing[];
  onChange: (next: UserDrawing[]) => void;
  hidden?: boolean;
};

function addLine(
  drawings: UserDrawing[],
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  dash?: string,
) {
  return [...drawings, { id, kind: 'line' as const, x1, y1, x2, y2, color, dash }];
}

function addMultiline(
  drawings: UserDrawing[],
  id: string,
  segments: { x1: number; y1: number; x2: number; y2: number }[],
  color: string,
) {
  return [...drawings, { id, kind: 'multiline' as const, segments, color }];
}

export function ChartDrawOverlay({ tool, locked, drawings, onChange, hidden }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);

  const pt = useCallback((e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const onDown = (e: React.MouseEvent) => {
    if (locked || hidden || NO_DRAW.includes(tool)) return;
    const p = pt(e);
    if (!p) return;
    if (tool === 'text') {
      const text = window.prompt('Label text', 'Note')?.trim();
      if (text) {
        onChange([...drawings, { id: `t-${Date.now()}`, kind: 'text', x: p.x, y: p.y, text }]);
      }
      return;
    }
    setStart(p);
    setDraft(p);
  };

  const onMove = (e: React.MouseEvent) => {
    if (!start) return;
    const p = pt(e);
    if (p) setDraft(p);
  };

  const onUp = () => {
    if (!start || !draft || locked) {
      setStart(null);
      setDraft(null);
      return;
    }
    const id = `d-${Date.now()}`;
    let next = drawings;

    if (tool === 'hline') {
      next = addLine(next, id, start.x, start.y, draft.x, start.y, '#e8eef5', '6 4');
    } else if (tool === 'vline') {
      next = addLine(next, id, start.x, start.y, start.x, draft.y, '#e8eef5', '6 4');
    } else if (tool === 'ray' || tool === 'trendline' || tool === 'measure' || tool === 'brush') {
      const color = tool === 'measure' ? '#f1b83f' : tool === 'brush' ? '#51d9ff' : '#8eb4ff';
      next = addLine(next, id, start.x, start.y, draft.x, draft.y, color);
    } else if (tool === 'pitchfork') {
      const dx = draft.x - start.x;
      const dy = draft.y - start.y;
      const off = Math.max(12, Math.hypot(dx, dy) * 0.35);
      const nx = -dy * 0.15;
      const ny = dx * 0.15;
      next = addMultiline(
        next,
        id,
        [
          { x1: start.x, y1: start.y, x2: draft.x, y2: draft.y },
          { x1: start.x + nx, y1: start.y + ny - off, x2: draft.x + nx, y2: draft.y + ny - off },
          { x1: start.x - nx, y1: start.y - ny + off, x2: draft.x - nx, y2: draft.y - ny + off },
        ],
        '#e8eef5',
      );
    } else if (tool === 'fib') {
      const y0 = start.y;
      const y1 = draft.y;
      const x0 = Math.min(start.x, draft.x);
      const x1 = Math.max(start.x, draft.x);
      const levels = [0, 0.382, 0.5, 0.618, 1];
      next = addMultiline(
        next,
        id,
        levels.map((l) => {
          const y = y0 + (y1 - y0) * l;
          return { x1: x0, y1: y, x2: x1, y2: y };
        }),
        '#8eb4ff',
      );
    } else if (tool === 'rectangle' || tool === 'geometric') {
      const x = Math.min(start.x, draft.x);
      const y = Math.min(start.y, draft.y);
      const w = Math.abs(draft.x - start.x);
      const h = Math.abs(draft.y - start.y);
      if (w > 4 && h > 4) {
        next = [
          ...next,
          {
            id,
            kind: 'rect' as const,
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

    onChange(next);
    setStart(null);
    setDraft(null);
  };

  const pointerEvents = locked || hidden || NO_DRAW.includes(tool) ? 'none' : 'auto';

  return (
    <svg
      ref={svgRef}
      className={`chartDrawOverlay${hidden ? ' isHidden' : ''}`}
      style={{ pointerEvents }}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
    >
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
              {!d.label ? (
                <>
                  <circle cx={d.x} cy={d.y} r={3} fill="#e8eef5" />
                  <circle cx={d.x + d.w} cy={d.y} r={3} fill="#e8eef5" />
                  <circle cx={d.x} cy={d.y + d.h} r={3} fill="#e8eef5" />
                  <circle cx={d.x + d.w} cy={d.y + d.h} r={3} fill="#e8eef5" />
                </>
              ) : null}
              {d.label && (
                <text x={d.x + 6} y={d.y + 14} fill="#e6eef5" fontSize={10}>
                  {d.label}
                </text>
              )}
            </g>
          );
        }
        return (
          <text key={d.id} x={d.x} y={d.y} fill="#eaf7ff" fontSize={11}>
            {d.text}
          </text>
        );
      })}
      {start && draft && !NO_DRAW.includes(tool) && tool !== 'text' && (
        <>
          {(tool === 'trendline' ||
            tool === 'ray' ||
            tool === 'brush' ||
            tool === 'measure' ||
            tool === 'pitchfork' ||
            tool === 'fib') && (
            <line
              x1={start.x}
              y1={start.y}
              x2={draft.x}
              y2={draft.y}
              stroke="#51d9ff"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}
          {tool === 'hline' && (
            <line x1={start.x} y1={start.y} x2={draft.x} y2={start.y} stroke="#e8eef5" strokeDasharray="4 3" />
          )}
          {tool === 'vline' && (
            <line x1={start.x} y1={start.y} x2={start.x} y2={draft.y} stroke="#e8eef5" strokeDasharray="4 3" />
          )}
          {(tool === 'rectangle' || tool === 'geometric') && (
            <rect
              x={Math.min(start.x, draft.x)}
              y={Math.min(start.y, draft.y)}
              width={Math.abs(draft.x - start.x)}
              height={Math.abs(draft.y - start.y)}
              fill="rgba(20,216,154,0.08)"
              stroke="#1ddd9d"
              strokeWidth={1}
            />
          )}
        </>
      )}
    </svg>
  );
}
