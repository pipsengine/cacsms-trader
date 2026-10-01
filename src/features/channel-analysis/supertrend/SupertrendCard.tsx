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

const ST_TF_CLASS: Record<SupertrendTimeframe, string> = {
  Y: 'tf-y',
  Q: 'tf-q',
  MN: 'tf-mn',
  W: 'tf-w',
  D: 'tf-d1',
  H8: 'tf-h8',
  H1: 'tf-h1',
  M15: 'tf-h1',
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

function dirCardClass(card: SupertrendCardSnapshot) {
  if (card.health === 'INSUFFICIENT_DATA' || card.direction === 'UNKNOWN') return 'unknown';
  return card.direction === 'UP' ? 'bullish' : 'bearish';
}

function pillText(card: SupertrendCardSnapshot) {
  if (card.health === 'INSUFFICIENT_DATA' || card.direction === 'UNKNOWN') return 'NONE';
  return card.direction === 'UP' ? 'UP' : 'DOWN';
}

export function SupertrendCardButton({ card, onOpen }: { card: SupertrendCardSnapshot; onOpen: () => void }) {
  const d = card.digits;
  const bt = barTimeTf(card.timeframe);
  const insufficient = card.health === 'INSUFFICIENT_DATA';
  return (
    <button
      type="button"
      className={`ca-card ${ST_TF_CLASS[card.timeframe]} dir-${dirCardClass(card)}${insufficient ? ' invalid' : ''}`}
      onClick={onOpen}
      aria-label={`Inspect ${ST_TITLE[card.timeframe]} Supertrend: ${directionLabel(card)}`}
    >
      <header>
        <span className="ca-tf">{card.timeframe}</span>
        <span className="ca-label">{ST_TITLE[card.timeframe]}</span>
        <span className="ca-head-pills">
          <span className={`ca-pill ${dirCardClass(card)}`}>{pillText(card)}</span>
          <span className={`ca-status ${card.health === 'STALE' ? 'warn' : card.health === 'LIVE' ? 'good' : 'muted'}`}>
            ● {card.health}
          </span>
        </span>
      </header>
      {insufficient ? (
        <div className="ca-novalid">
          <b>INSUFFICIENT DATA</b>
          <span>Need {card.atrPeriod} closed bars for Wilder ATR — {card.barCount} available.</span>
        </div>
      ) : (
        <div className="ca-position">
          <span>Distance from Supertrend</span>
          <b className={card.direction === 'UP' ? 'tone-good' : 'tone-bad'}>
            {card.distanceAtr == null ? '—' : `${signed(card.distanceAtr, 2)} ATR`}
          </b>
        </div>
      )}
      {card.candles.length > 0 ? (
        <SupertrendChart card={card} height={128} axes provisional={Boolean(card.chartProvisional)} />
      ) : (
        <div className="ca-chart-empty" style={{ height: 128 }}>
          No closed candles in history
        </div>
      )}
      <div className="ca-metrics">
        <span>
          Price <b>{num(card.currentPrice, d)}</b>
        </span>
        <span>
          Supertrend <b>{num(card.supertrend, d)}</b>
        </span>
        <span>
          ATR <b>{num(card.atr, d)}</b>
        </span>
        <span>
          Mult <b>{card.multiplier.toFixed(2)}</b>
        </span>
        <span>
          Trend age <b>{card.barsSinceFlip == null ? '—' : `${card.barsSinceFlip}b`}</b>
        </span>
        <span>
          Closed <b>{barTime(card.lastClosedCandleTime, bt)}</b>
        </span>
      </div>
      <footer>
        <span>
          Freshness <b>{card.freshnessMs == null ? '—' : age(card.freshnessMs / 1000)}</b>
        </span>
        <span>
          Trend <b>{directionLabel(card)}</b>
        </span>
      </footer>
    </button>
  );
}
