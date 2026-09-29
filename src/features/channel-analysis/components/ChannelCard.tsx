import type { ChannelSnapshot } from '../types';
import {
  age,
  atr,
  currentView,
  dirClass,
  geometryWord,
  human,
  isValid,
  num,
  pct,
  REL_LABEL,
  relTone,
  statusLabel,
  statusTone,
  TF_LABEL,
} from '../format';
import { ChannelChart } from './ChannelChart';

export function ChannelCard({ channel, onOpen }: { channel: ChannelSnapshot; onOpen: () => void }) {
  const valid = isValid(channel);
  const forming = channel.status === 'FORMING';
  const view = currentView(channel);
  const d = channel.digits;
  const dir = valid || forming ? channel.direction : 'UNKNOWN';
  const posWidth = view.position == null ? 0 : Math.max(0, Math.min(100, view.position));
  return (
    <button
      type="button"
      className={`ca-card dir-${dirClass(valid ? channel.direction : 'UNKNOWN')}${valid ? '' : ' invalid'}`}
      onClick={onOpen}
      aria-label={`Inspect ${TF_LABEL[channel.timeframe]} channel: ${statusLabel(channel)}${valid ? `, ${channel.direction.toLowerCase()}` : ''}`}
    >
      <header>
        <span className="ca-tf">{channel.timeframe}</span>
        <span className="ca-label">{TF_LABEL[channel.timeframe]}</span>
        <span className={`ca-pill ${dirClass(dir)}`}>{forming ? `${dir} · LEAN` : valid ? dir : 'NONE'}</span>
        <span className={`ca-status ${statusTone(channel.status)}`}>
          ● {statusLabel(channel)}
          {(valid || forming) && channel.trend ? ` · ${geometryWord(channel.trend)} channel` : ''}
        </span>
      </header>
      {valid ? (
        <>
          <div className="ca-position">
            <span>Channel position{view.isLive ? ' · live' : ''}</span>
            <b>{pct(view.position)}</b>
          </div>
          <div className="ca-meter" aria-hidden="true">
            <i style={{ width: `${posWidth}%` }} />
          </div>
        </>
      ) : (
        <div className="ca-novalid" title={channel.reason}>
          <b>{forming ? 'FORMING — NOT YET VALID' : 'NO VALID CHANNEL'}</b>
          <span>{channel.reason.replace(/^NO VALID CHANNEL — /, '')}</span>
        </div>
      )}
      <ChannelChart channel={channel} />
      <div className="ca-metrics">
        <span>
          Upper <b>{valid ? num(channel.upperBoundary, d) : '—'}</b>
        </span>
        <span>
          Mid <b>{valid ? num(channel.midline, d) : '—'}</b>
        </span>
        <span>
          Lower <b>{valid ? num(channel.lowerBoundary, d) : '—'}</b>
        </span>
        <span>
          Touches <b>{valid || forming ? `${channel.anchorTouches}+${channel.oppositeTouches}` : '—'}</b>
        </span>
        <span>
          To upper <b>{valid ? atr(view.distanceUpperAtr) : '—'}</b>
        </span>
        <span>
          Confidence <b>{valid || forming ? pct(channel.confidence) : '—'}</b>
        </span>
      </div>
      <footer>
        <span className={`ca-rel ${relTone(channel.relationship)}`}>{REL_LABEL[channel.relationship]}</span>
        <span>
          Phase <b>{human(channel.phase)}</b>
        </span>
        <span title={`Last closed ${channel.timeframe} candle closed ${age(channel.freshnessSeconds)} ago`}>
          {channel.dataStatus !== 'READY' ? <b className="warn">{human(channel.dataStatus)}</b> : `${age(channel.freshnessSeconds)} old`}
          {channel.pendingRecalculation ? ' · updating' : ''}
        </span>
      </footer>
    </button>
  );
}
