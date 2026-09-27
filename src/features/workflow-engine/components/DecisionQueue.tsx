import type { DecisionQueueItem } from '../types/workflow';
import { StateChip } from './chips';
import { age } from '../utils/format';

export function DecisionQueue({ rows, onSelect }: { rows: DecisionQueueItem[]; onSelect: (symbol: string) => void }) {
  const live = rows.filter((r) => r.live).length;
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ACTIVE DECISION QUEUE</span>
          <h2>Instruments progressing through Stages 5–9</h2>
        </div>
        <span className="muted">
          {live} live · {rows.length - live} last-known (held upstream)
        </span>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="wf-table queue">
            <thead>
              <tr>
                <th className="w-sym">Instrument</th>
                <th className="w-gate">Current stage</th>
                <th className="w-state">State</th>
                <th className="p3 w-dir">Direction</th>
                <th className="pm w-conf">Conf.</th>
                <th>Waiting for / blocker</th>
                <th className="pm w-age">Age</th>
                <th className="p3">Next expected action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className={r.live ? '' : 'known'} onClick={() => onSelect(r.symbol)}>
                  <td>
                    <b>{r.symbol}</b>
                    {!r.live && <span className="fresh known">LAST KNOWN</span>}
                  </td>
                  <td>
                    S{r.stage} <small>{r.stageName}</small>
                  </td>
                  <td>
                    <StateChip state={r.state} />
                  </td>
                  <td className={`p3 dir ${r.direction.toLowerCase()}`}>{r.direction}</td>
                  <td className="pm">{r.confidence == null ? '—' : `${r.confidence}%`}</td>
                  <td className="wrap" title={r.waitingFor}>
                    {r.waitingFor || '—'}
                  </td>
                  <td className="pm">{age(r.ageSec)}</td>
                  <td className="p3 wrap" title={r.nextAction}>
                    {r.nextAction}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">No instrument has passed Stage 4 on the live path or holds last-known Stage 4+ analysis. The queue fills as the scanner promotes candidates.</p>
      )}
    </section>
  );
}
