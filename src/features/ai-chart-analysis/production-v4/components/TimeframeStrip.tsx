import { evidenceScoreDisplay } from '../displayFormat';
import type { Timeframe, TimeframeState } from '../types';

export function TimeframeStrip({
  items,
  active,
  onSelect,
}: {
  items: TimeframeState[];
  active: Timeframe;
  onSelect: (x: Timeframe) => void;
}) {
  return (
    <div className="tfStrip">
      {items.map((x) => (
        <button
          type="button"
          key={x.timeframe}
          onClick={() => onSelect(x.timeframe)}
          className={`tfCard ${active === x.timeframe ? 'selected' : ''}`}
        >
          <div>
            <b>{x.timeframe}</b>
            <span className={x.direction === 'BULLISH' ? 'up' : x.direction === 'BEARISH' ? 'down' : 'flat'}>
              {x.direction === 'BULLISH' ? '↗' : x.direction === 'BEARISH' ? '↘' : '—'}
            </span>
          </div>
          <strong className={x.direction === 'BULLISH' ? 'up' : x.direction === 'BEARISH' ? 'down' : 'flat'}>
            {x.phase}
          </strong>
          <small>{x.regime || 'Insufficient data'}</small>
          <em>{evidenceScoreDisplay(x.evidenceScore)}</em>
        </button>
      ))}
    </div>
  );
}
