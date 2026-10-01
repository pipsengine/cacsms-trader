import type { ChannelSnapshot, ChannelTimeframe } from '../types';
import {
  dirClass,
  displayPhase,
  human,
  isContext,
  isValid,
  num,
  pct,
  phaseTone,
  posTone,
  slopeText,
  statusTone,
  TF_HELP,
  TF_TITLE,
} from '../format';
import { ChannelChart } from './ChannelChart';

function cardHelp(channel: ChannelSnapshot): string | undefined {
  const help = TF_HELP[channel.timeframe];
  if (!help) return undefined;
  const w = channel.window;
  return w ? `${help}\nWindow ${w.label} · ${w.bars} closed ${w.sourceTimeframe} candles` : help;
}

/** Placeholder for a context the bridge has not published yet; the other cards render independently. */
export function ChannelCardPending({ timeframe }: { timeframe: ChannelTimeframe }) {
  return (
    <div className={`ca-card tf-${timeframe.toLowerCase()} dir-unknown invalid pending`} role="status" title={TF_HELP[timeframe]}>
      <header>
        <span className="ca-tf">{timeframe}</span>
        <span className="ca-label">{TF_TITLE[timeframe]}</span>
        <span className="ca-head-pills">
          <span className="ca-status muted">● Loading</span>
        </span>
      </header>
      <div className="ca-novalid">
        <b>AWAITING FIRST CALCULATION</b>
        <span>The bridge has not published this context for the selected instrument yet.</span>
      </div>
    </div>
  );
}

export function ChannelCard({ channel, onOpen }: { channel: ChannelSnapshot; onOpen: () => void }) {
  const valid = isValid(channel);
  const forming = channel.status === 'FORMING';
  const show = valid || forming;
  const dir = show ? channel.direction : 'UNKNOWN';
  const pos = show ? (channel.live?.position ?? channel.position) : null;
  const posWidth = pos == null ? 0 : Math.max(0, Math.min(100, pos));
  const tone = posTone(dir, pos);
  const phase = displayPhase(channel);
  const d = channel.digits;
  const primary = valid && channel.relationship === 'PRIMARY' && !isContext(channel);
  const stale = channel.dataStatus === 'STALE';
  return (
    <button
      type="button"
      className={`ca-card tf-${channel.timeframe.toLowerCase()} dir-${dirClass(dir)}${valid ? '' : ' invalid'}`}
      onClick={onOpen}
      aria-label={`Inspect ${TF_TITLE[channel.timeframe]} channel: ${valid ? `${dir.toLowerCase()}, ${phase}` : human(channel.status)}`}
    >
      <header>
        <span className="ca-tf">{channel.timeframe}</span>
        <span className="ca-label" title={cardHelp(channel)}>
          {TF_TITLE[channel.timeframe]}
        </span>
        <span className="ca-head-pills">
          <span className={`ca-pill ${dirClass(dir)}`}>{show ? dir : 'NONE'}</span>
          {primary ? (
            <span className="ca-primary-tag">PRIMARY</span>
          ) : (
            <span className={`ca-status ${stale ? 'warn' : statusTone(channel.status)}`} title={stale ? channel.dataReason : undefined}>
              ● {channel.status === 'ACTIVE' ? 'Active' : human(channel.status)}
              {stale ? ' · Stale' : ''}
            </span>
          )}
        </span>
      </header>
      {valid ? (
        <>
          <div className="ca-position">
            <span>Channel Position</span>
            <b className={`tone-${tone}`}>{pct(pos)}</b>
          </div>
          <div className="ca-meter" aria-hidden="true">
            <i className={`tone-${tone}`} style={{ width: `${posWidth}%` }} />
          </div>
        </>
      ) : (
        <div className="ca-novalid" title={channel.reason}>
          <b>{forming ? 'FORMING — NOT YET VALID' : 'NO VALID CHANNEL'}</b>
          <span>{channel.reason.replace(/^NO VALID CHANNEL — /, '')}</span>
        </div>
      )}
      <ChannelChart channel={channel} height={128} axes />
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
          Touches <b>{show ? `${channel.anchorTouches} / ${channel.oppositeTouches}` : '—'}</b>
        </span>
        <span>
          Slope <b>{valid ? slopeText(channel.slope) : '—'}</b>
        </span>
        <span>
          Confidence <b>{show ? pct(channel.confidence) : '—'}</b>
        </span>
      </div>
      <footer>
        <span>
          Phase <b className={`ca-phase ${phaseTone(phase)}`}>{phase}</b>
        </span>
        <span>
          Status <b className={statusTone(channel.status)}>{human(channel.status).toUpperCase()}</b>
        </span>
      </footer>
    </button>
  );
}
