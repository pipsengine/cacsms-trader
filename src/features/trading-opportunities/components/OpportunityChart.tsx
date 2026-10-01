import { useEffect, useState } from 'react';
import type { FrameworkHypothesis } from '../../workflow-engine/services/frameworkClient';
import { fetchChannelSnapshot } from '../../channel-analysis/services/channelClient';
import type { ChannelTimeframe } from '../../channel-analysis/types';

function pickTimeframe(h: FrameworkHypothesis): ChannelTimeframe {
  const want = (h.executionTimeframe || h.childTimeframe || h.parentTimeframe || 'H1').toUpperCase();
  const map: Record<string, ChannelTimeframe> = {
    MN: 'MN',
    W: 'W',
    D1: 'D1',
    H8: 'H8',
    H1: 'H1',
    M15: 'H1',
    M5: 'H1',
  };
  return map[want] ?? 'H1';
}

export function OpportunityChart({ h }: { h: FrameworkHypothesis }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [svg, setSvg] = useState<{ w: number; h: number; path: string; upper?: string; lower?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const tf = pickTimeframe(h);
    void fetchChannelSnapshot(h.symbol)
      .then((snap) => {
        if (!alive) return;
        const ch = snap.selected?.channels?.[tf];
        const candles = ch?.candles ?? [];
        if (candles.length < 10) {
          setSvg(null);
          setError('Insufficient closed-bar history for this timeframe.');
          return;
        }
        const tail = candles.slice(-80);
        const lows = tail.map((c) => c.low);
        const highs = tail.map((c) => c.high);
        let min = Math.min(...lows);
        let max = Math.max(...highs);
        const room = h.room;
        if (room?.invalidation != null) min = Math.min(min, room.invalidation);
        if (room?.entry != null) {
          min = Math.min(min, room.entry);
          max = Math.max(max, room.entry);
        }
        if (room?.target != null) {
          min = Math.min(min, room.target);
          max = Math.max(max, room.target);
        }
        const pad = (max - min) * 0.08 || 0.0001;
        min -= pad;
        max += pad;
        const w = 640;
        const height = 220;
        const x = (i: number) => (i / Math.max(1, tail.length - 1)) * w;
        const y = (p: number) => height - ((p - min) / (max - min)) * height;
        const path = tail
          .map((c, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(c.close).toFixed(1)}`)
          .join(' ');
        const lines = ch?.lines?.slice(-80) ?? [];
        let upper: string | undefined;
        let lower: string | undefined;
        if (lines.length >= 2) {
          upper = lines.map((l, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(l.upper).toFixed(1)}`).join(' ');
          lower = lines.map((l, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(l.lower).toFixed(1)}`).join(' ');
        }
        setSvg({ w, h: height, path, upper, lower });
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Chart unavailable'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [h.symbol, h.opportunityId, h.executionTimeframe, h.childTimeframe, h.parentTimeframe, h.room?.entry, h.room?.invalidation, h.room?.target]);

  if (loading) return <div className="to-chart muted">Loading chart…</div>;
  if (error) return <div className="to-chart muted">{error}</div>;
  if (!svg) return <div className="to-chart muted">No chart data for {pickTimeframe(h)}.</div>;

  const entry = h.room?.entry;
  const stop = h.room?.invalidation;
  const target = h.room?.target;

  return (
    <div className="to-chart" aria-label={`Price chart ${h.symbol}`}>
      <svg viewBox={`0 0 ${svg.w} ${svg.h}`} role="img">
        {svg.upper && <path d={svg.upper} fill="none" stroke="var(--to-channel)" strokeWidth="1" opacity="0.5" />}
        {svg.lower && <path d={svg.lower} fill="none" stroke="var(--to-channel)" strokeWidth="1" opacity="0.5" />}
        <path d={svg.path} fill="none" stroke="var(--to-price)" strokeWidth="2" />
        {entry != null && (
          <line x1={0} x2={svg.w} y1={svg.h * 0.4} y2={svg.h * 0.4} stroke="var(--to-entry)" strokeDasharray="4 3" />
        )}
        {stop != null && (
          <line x1={0} x2={svg.w} y1={svg.h * 0.75} y2={svg.h * 0.75} stroke="var(--to-stop)" strokeDasharray="4 3" />
        )}
        {target != null && (
          <line x1={0} x2={svg.w} y1={svg.h * 0.15} y2={svg.h * 0.15} stroke="var(--to-target)" strokeDasharray="4 3" />
        )}
      </svg>
      <div className="to-chart-legend muted">
        {pickTimeframe(h)} closed bars · overlays when room geometry exists
      </div>
    </div>
  );
}
