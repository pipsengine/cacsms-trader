import { finiteNumber } from './chartMath';

export type PlacedAnnotation = {
  id: string;
  label: string;
  tone: string;
  px: number;
  py: number;
  lane: number;
  hidden?: boolean;
};

const LANE_STEP = 22;
const MIN_X_GAP = 28;

/** Vertical lanes + defer overlapping labels (lower priority hidden). */
export function layoutAnnotations(
  items: { id: string; label: string; tone: string; timeIndex: number; price: number; priority: number }[],
  indexToX: (i: number) => number,
  priceToY: (p: number) => number | null,
  chartTop: number,
  chartBottom: number,
  maxVisible = 10,
): PlacedAnnotation[] {
  const sorted = [...items].sort((a, b) => a.priority - b.priority);
  const placed: PlacedAnnotation[] = [];
  const occupied: { x: number; y: number; r: number }[] = [];

  for (const z of sorted) {
    const px = indexToX(z.timeIndex);
    const baseY = priceToY(z.price);
    if (baseY === null || !Number.isFinite(px)) continue;

    let lane = 0;
    let py = baseY;
    for (let attempt = 0; attempt < 6; attempt++) {
      py = baseY + lane * LANE_STEP * (lane % 2 === 0 ? -1 : 1);
      if (py < chartTop + 8) py = chartTop + 8;
      if (py > chartBottom - 8) py = chartBottom - 8;
      const clash = occupied.some((o) => Math.hypot(o.x - px, o.y - py) < o.r + 14);
      if (!clash) break;
      lane += 1;
    }

    const tooClose = occupied.some((o) => Math.abs(o.x - px) < MIN_X_GAP && Math.abs(o.y - py) < LANE_STEP);
    const hidden = tooClose && placed.length >= maxVisible;

    if (!hidden) {
      occupied.push({ x: px, y: py, r: z.label.length < 3 ? 12 : 8 });
    }

    placed.push({
      id: z.id,
      label: z.label,
      tone: z.tone,
      px,
      py,
      lane,
      hidden,
    });
  }

  return placed.filter((p) => !p.hidden);
}

export function finitePrice(value: unknown): number | null {
  return finiteNumber(value);
}
