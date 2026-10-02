import { useCallback, useEffect, useRef, useState } from 'react';
import {
  barsForRangePreset,
  clampViewport,
  defaultViewport,
  indexAtPlotX,
  type ChartViewport,
} from './chartViewport';
import { MARGIN_L, plotWidth } from './compositorLayout';

export function useV4ChartInteraction(barCount: number) {
  const [viewport, setViewport] = useState<ChartViewport>(() => defaultViewport(barCount));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showOverlays, setShowOverlays] = useState(true);
  const [activeRange, setActiveRange] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; from: number; to: number } | null>(null);

  useEffect(() => {
    setViewport(defaultViewport(barCount));
    setHoverIndex(null);
    setActiveRange(null);
  }, [barCount]);

  const visibleBars = viewport.to - viewport.from + 1;

  const setRangePreset = useCallback(
    (preset: string) => {
      const count = barsForRangePreset(preset, barCount);
      setActiveRange(preset);
      setViewport(clampViewport(barCount - count, barCount - 1, barCount));
    },
    [barCount],
  );

  const resetView = useCallback(() => {
    setActiveRange(null);
    setViewport(defaultViewport(barCount));
  }, [barCount]);

  const zoomBy = useCallback(
    (factor: number, focusRatio: number) => {
      setActiveRange(null);
      setViewport((vp) => {
        const cur = vp.to - vp.from + 1;
        const next = Math.round(cur * factor);
        const clamped = Math.max(28, Math.min(barCount, next));
        const focus = vp.from + Math.round(cur * focusRatio);
        let from = focus - Math.round(clamped * focusRatio);
        let to = from + clamped - 1;
        return clampViewport(from, to, barCount);
      });
    },
    [barCount],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent, allowPan: boolean) => {
      if (!allowPan || e.button !== 0) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { x: e.clientX, from: viewport.from, to: viewport.to };
    },
    [viewport.from, viewport.to],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent, svg: SVGSVGElement | null) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.x;
        const span = dragRef.current.to - dragRef.current.from + 1;
        const plotW = plotWidth();
        const barsPerPx = span / plotW;
        const shift = Math.round(-dx * barsPerPx);
        if (shift !== 0) {
          setActiveRange(null);
          const next = clampViewport(
            dragRef.current.from + shift,
            dragRef.current.to + shift,
            barCount,
          );
          dragRef.current = { x: e.clientX, from: next.from, to: next.to };
          setViewport(next);
        }
        return;
      }
      if (!svg) {
        setHoverIndex(null);
        return;
      }
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const local = pt.matrixTransform(ctm.inverse());
      setHoverIndex(indexAtPlotX(local.x, visibleBars, MARGIN_L, plotWidth()));
    },
    [barCount, visibleBars, viewport.from, viewport.to],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onPointerLeave = useCallback(() => {
    if (!dragRef.current) setHoverIndex(null);
  }, []);

  return {
    viewport,
    hoverIndex,
    showOverlays,
    setShowOverlays,
    activeRange,
    setRangePreset,
    resetView,
    zoomBy,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    visibleBars,
  };
}
