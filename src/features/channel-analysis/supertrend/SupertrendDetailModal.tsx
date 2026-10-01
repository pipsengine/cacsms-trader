import { useEffect, useRef } from 'react';
import { age, barTime, num } from '../format';
import type { ChannelTimeframe } from '../types';
import { SupertrendChart } from './SupertrendChart';
import type { SupertrendCardSnapshot, SupertrendTimeframe } from './types';

const ST_TITLE: Record<SupertrendTimeframe, string> = {
  Y: 'Yearly (1Y)',
  Q: 'Quarterly (3M)',
  MN: 'Monthly (1M)',
  W: 'Weekly (1W)',
  D: 'Daily (1D)',
  H8: '8 Hours',
  H1: '1 Hour',
  M15: '15 Minutes',
};

function barTimeTf(tf: SupertrendTimeframe): ChannelTimeframe | undefined {
  if (tf === 'D') return 'D1';
  if (tf === 'M15') return undefined;
  return tf as ChannelTimeframe;
}

function signed(v: number | null | undefined, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
}

function directionLabel(card: SupertrendCardSnapshot) {
  if (card.health === 'INSUFFICIENT_DATA') return 'INSUFFICIENT DATA';
  if (card.health === 'STALE') return 'STALE';
  if (card.direction === 'UP') return 'UPTREND';
  if (card.direction === 'DOWN') return 'DOWNTREND';
  return 'INSUFFICIENT DATA';
}

function pillClass(card: SupertrendCardSnapshot) {
  if (card.health === 'INSUFFICIENT_DATA' || card.direction === 'UNKNOWN') return 'unknown';
  return card.direction === 'UP' ? 'bullish' : 'bearish';
}

type Props = {
  card: SupertrendCardSnapshot;
  symbol: string;
  onClose: () => void;
};

export function SupertrendDetailModal({ card, symbol, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const d = card.digits;
  const bt = barTimeTf(card.timeframe);
  const stats: [string, string][] = [
    ['Confirmed trend', directionLabel(card)],
    ['Current price', num(card.currentPrice, d)],
    ['Supertrend', num(card.supertrend, d)],
    ['ATR', num(card.atr, d)],
    ['ATR multiplier', card.multiplier.toFixed(2)],
    ['ATR period', String(card.atrPeriod)],
    ['Confirmation', 'Closed candle (previous bar)'],
    ['Distance (price)', signed(card.distancePrice, d)],
    ['Distance (ATR)', card.distanceAtr == null ? '—' : `${signed(card.distanceAtr, 2)} ATR`],
    ['Trend age', card.barsSinceFlip == null ? '—' : `${card.barsSinceFlip} bars`],
    ['Last flip', card.lastFlipTime ? new Date(card.lastFlipTime).toLocaleString() : '—'],
    ['Latest closed candle', barTime(card.lastClosedCandleTime, bt)],
    ['Data freshness', card.freshnessMs == null ? '—' : age(card.freshnessMs / 1000)],
    ['Data quality', card.health],
    ['Bars in series', String(card.barCount)],
    ['Settings version', String(card.settingsRevision)],
    ['Calculated', new Date(card.calculatedAt).toLocaleString()],
  ];

  return (
    <div
      className="ca-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ca-modal" role="dialog" aria-modal="true" aria-labelledby="st-modal-title" tabIndex={-1} ref={ref}>
        <header>
          <div>
            <small>
              {symbol} · {ST_TITLE[card.timeframe]} ({card.timeframe}) · ← → switch timeframe
            </small>
            <h2 id="st-modal-title">
              <span className={`ca-pill ${pillClass(card)}`}>{card.direction === 'UP' ? 'UP' : card.direction === 'DOWN' ? 'DOWN' : '—'}</span>{' '}
              {ST_TITLE[card.timeframe]} Supertrend
            </h2>
          </div>
          <div className="ca-modal-actions">
            <button type="button" onClick={onClose} aria-label="Close Supertrend detail">
              ✕
            </button>
          </div>
        </header>

        <div role="tabpanel">
          {card.health === 'INSUFFICIENT_DATA' && (
            <div className="ca-novalid wide">
              <b>INSUFFICIENT DATA</b>
              <span>
                {card.chartProvisional
                  ? `Confirmed Supertrend requires ${card.atrPeriod} closed bars (${card.barCount} available). Chart shows provisional ST (dashed) for context only.`
                  : `Not enough closed history to calculate Wilder ATR (${card.atrPeriod}).`}
              </span>
            </div>
          )}
          <SupertrendChart card={card} height={390} detail provisional={Boolean(card.chartProvisional)} />
          <div className="ca-touch-legend">
            <span><i style={{ background: '#31dfa1' }} />Uptrend regime candle &amp; line</span>
            <span><i style={{ background: '#ff5d70' }} />Downtrend regime candle &amp; line</span>
            <span><i style={{ background: '#f2bd4a' }} />Live price</span>
            <span>Open candle body is semi-transparent (provisional)</span>
            {card.chartProvisional && <span>Dashed Supertrend line is provisional until ATR({card.atrPeriod}) is satisfied</span>}
          </div>
          <div className="ca-detail-grid">
            {stats.map(([k, v]) => (
              <div key={k}>
                <small>{k}</small>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
