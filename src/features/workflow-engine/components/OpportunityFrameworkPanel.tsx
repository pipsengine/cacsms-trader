import { Fragment, useMemo, useState } from 'react';
import {
  lifecycleTone,
  useFrameworkContracts,
  useOpportunityFramework,
  type FrameworkHypothesis,
  type FrameworkMatrix,
} from '../services/frameworkClient';
import { clock } from '../utils/format';

const TYPES = ['OP-01', 'OP-02', 'OP-03', 'OP-04', 'OP-05', 'OP-06', 'OP-07', 'OP-08', 'OP-09', 'OP-10', 'OP-11', 'OP-12'];
const TERMINAL = new Set(['EXPIRED', 'INVALIDATED', 'COMPLETED']);
const STAGE_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'econ'];
const STAGE_NAMES: Record<string, string> = {
  '1': 'Data', '2': 'Strength', '3': 'Regime', '4': 'Discovery', '5': 'Vision', '6': 'Structure', '7': 'Confirmation',
  '8': 'Risk', '9': 'Execution', '10': 'Learning', econ: 'Economic',
};
const OP01_LABELS: [string, string][] = [
  ['validChannels', 'Valid channels'], ['nearBoundary', 'Near boundary'], ['zoneReached', 'Zone reached'],
  ['reactionsDetected', 'Reactions detected'], ['reactionsConfirmed', 'Reactions confirmed'], ['withoutBos', 'Confirmed without BOS'],
  ['withBos', 'Confirmed with BOS'], ['readyForRisk', 'Ready for risk'], ['blockedByStage8Shadow', 'Stage 8 shadow blocked'],
  ['insufficientHistory', 'Insufficient history'],
];

function px(v: number | null | undefined) {
  return v == null ? '—' : Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5);
}

function TypeBadge({ h }: { h: Pick<FrameworkHypothesis, 'opportunityType' | 'badge' | 'opportunityName'> }) {
  return (
    <span className={`op-badge op-${h.opportunityType.toLowerCase()}`} title={h.opportunityName}>
      {h.opportunityType} · {h.badge}
    </span>
  );
}

function Detail({ h, shadow8 }: { h: FrameworkHypothesis; shadow8?: { setupState?: string; setupReason?: string } }) {
  const room = h.room;
  return (
    <div className="op-detail">
      <div className="op-detail-cols">
        <div>
          <h4>Why this opportunity</h4>
          <ul className="op-why">
            {h.why.map((w, i) => (
              <li key={i} className={w.ok === true ? 'ok' : w.ok === false ? 'bad' : 'muted'}>
                <i>{w.ok === true ? '✓' : w.ok === false ? '✗' : '○'}</i>
                <span>{w.text}</span>
                <em>{w.kind.replace('_', ' ')}</em>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Why not ready</h4>
          {h.whyNotReady.length ? (
            <ul className="op-notready">
              {h.whyNotReady.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing outstanding — next step: {h.nextStep}</p>
          )}
          <dl className="op-facts">
            <dt>Contract</dt>
            <dd className="mono">{h.confirmationContractId}</dd>
            <dt>Route</dt>
            <dd>
              {h.route} <small>({h.mode})</small>
            </dd>
            <dt>Trigger</dt>
            <dd>
              {h.triggerType ?? '—'} {h.triggerPrice != null ? `@ ${px(h.triggerPrice)}` : ''}
            </dd>
            <dt>Room</dt>
            <dd>
              {room
                ? `entry ${px(room.entry)} · stop ${px(room.invalidation)} · target ${px(room.target)} (${room.targetKind ?? '—'}) · R:R ${room.rewardRisk ?? '—'} / ${room.minRR ?? '—'}`
                : 'Measured by Stage 8 for this route'}
            </dd>
            <dt>Entry quality</dt>
            <dd>{h.entryQuality ?? '—'}</dd>
            <dt>Regime</dt>
            <dd>
              {h.regime.label} <small>{h.regime.compatibility} (advisory)</small>
            </dd>
            <dt>Context</dt>
            <dd>{h.opportunityContext.length ? h.opportunityContext.join(', ') : '—'}</dd>
            <dt>Risk budget</dt>
            <dd>
              {h.riskRole === 'PRIMARY' ? 'Primary owner' : 'Shares the campaign budget'} <small>{h.riskGroup}</small>
            </dd>
            <dt>Legs</dt>
            <dd>
              P1 {h.legs.p1 ? 'applicable' : 'n/a'} · P2 {h.legs.p2 ? 'applicable' : 'n/a'}
            </dd>
            {shadow8 && (
              <>
                <dt>Stage 8 shadow</dt>
                <dd>
                  {shadow8.setupState} <small>{shadow8.setupReason}</small>
                </dd>
              </>
            )}
          </dl>
          {h.relationships.length > 0 && (
            <p className="muted">
              Related:{' '}
              {h.relationships
                .filter((r) => r.kind !== 'RELATED')
                .map((r) => `${r.kind} ${r.type}`)
                .join(' · ') || `${h.relationships.length} other hypothesis(es) on this instrument`}
            </p>
          )}
        </div>
      </div>
      <div className="op-stage-cards">
        {STAGE_ORDER.filter((k) => h.stages[k]).map((k) => (
          <div key={k} className={`op-stage s-${String(h.stages[k].status).toLowerCase()}`}>
            <span>
              {k === 'econ' ? 'ECON' : `S${k}`} · {STAGE_NAMES[k]}
            </span>
            <b>{h.stages[k].status}</b>
            <small>{h.stages[k].detail}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function Matrix({ matrix }: { matrix: FrameworkMatrix }) {
  const label = (k: string) => matrix.evidence[k]?.label ?? k;
  return (
    <details className="op-matrix">
      <summary>Confirmation contracts {matrix.contractVersion} — the backend matrix every stage applies</summary>
      <table className="wf-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Required</th>
            <th>Optional</th>
            <th>Not required</th>
            <th>Incompatible</th>
            <th>P1 / P2</th>
          </tr>
        </thead>
        <tbody>
          {matrix.contracts.map((c) => (
            <tr key={c.contractId}>
              <td>
                <b>{c.opportunityType}</b> {c.name}
              </td>
              <td>{c.requiredEvidence.map(label).join(' · ')}</td>
              <td className="muted">{c.optionalEvidence.map(label).join(' · ') || '—'}</td>
              <td className="muted">{c.notRequired.map(label).join(' · ') || '—'}</td>
              <td className="muted">{c.incompatible.map(label).join(' · ') || '—'}</td>
              <td className="muted">
                {c.legs.p1 ? 'P1' : '—'} / {c.legs.p2 ? 'P2' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function OpportunityFrameworkPanel({ focus, onPinSymbol }: { focus?: string; onPinSymbol?: (symbol: string) => void }) {
  const { data, error } = useOpportunityFramework();
  const matrix = useFrameworkContracts();
  const [type, setType] = useState<string | null>(null);
  const [mode, setMode] = useState<string>('ALL');
  const [symbol, setSymbol] = useState<string>('ALL');
  const [showClosed, setShowClosed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const fw = data?.framework ?? null;
  const rows = useMemo(
    () =>
      (fw?.hypotheses ?? []).filter(
        (h) =>
          (!type || h.opportunityType === type) &&
          (mode === 'ALL' || h.mode === mode) &&
          (symbol === 'ALL' || h.symbol === symbol) &&
          (showClosed || !TERMINAL.has(h.lifecycle)),
      ),
    [fw, type, mode, symbol, showClosed],
  );
  const symbols = useMemo(() => Array.from(new Set((fw?.hypotheses ?? []).map((h) => h.symbol))).sort(), [fw]);

  return (
    <section className="panel op-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">OPPORTUNITY CLASSIFICATION &amp; CONFIRMATION</span>
          <h2>
            {fw ? `${fw.summary.hypotheses} opportunities across ${fw.summary.universe} instruments` : 'Opportunity framework'}
          </h2>
          {fw && (
            <span className="muted">
              {fw.frameworkVersion} · contracts {fw.contractVersion} · light scan escalated {fw.summary.lightScan.escalated} channels · built in{' '}
              {fw.durationMs} ms · {clock(fw.generatedAt)} · position limit {fw.productionLimits.operatorPositionLimit} · XAU reserve{' '}
              {fw.productionLimits.xauReservePct}%
            </span>
          )}
        </div>
        <div className="filters">
          <select
            value={symbol}
            onChange={(e) => {
              const v = e.target.value;
              setSymbol(v);
              if (v !== 'ALL') onPinSymbol?.(v);
            }}
            aria-label="Instrument"
          >
            <option value="ALL">All instruments</option>
            {focus && !symbols.includes(focus) && <option value={focus}>{focus}</option>}
            {symbols.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Route mode">
            <option value="ALL">All modes</option>
            <option value="PRODUCTION">Production</option>
            <option value="SHADOW">Shadow</option>
            <option value="OBSERVE">Observe</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> expired / invalidated
          </label>
        </div>
      </div>
      {error && !fw && <p className="muted">Framework state unavailable: {error}</p>}
      {data && !fw && <p className="muted">The opportunity service has not completed a framework run since the bridge started.</p>}
      {fw && (
        <>
          <div className="op-types">
            {TYPES.map((op) => (
              <button
                type="button"
                key={op}
                className={`op-type${type === op ? ' on' : ''}${fw.summary.byType[op] ? '' : ' zero'}`}
                onClick={() => setType(type === op ? null : op)}
              >
                <b>{fw.summary.byType[op] ?? 0}</b>
                <span>{op}</span>
              </button>
            ))}
          </div>
          <div className="op-diag">
            <span className="eyebrow">OP-01 BOUNDARY REACTION (SHADOW)</span>
            {OP01_LABELS.map(([k, l]) => (
              <span key={k}>
                {l} <b>{fw.summary.op01[k] ?? 0}</b>
              </span>
            ))}
            <span>
              Legacy NORMAL route <b>{fw.summary.legacyNormal}</b>
            </span>
          </div>
          {fw.persistError && <p className="muted bad">Persistence: {fw.persistError}</p>}
          {fw.errors.length > 0 && (
            <p className="muted warn">
              {fw.errors.length} detector error(s): {fw.errors.slice(0, 3).map((e) => `${e.detector} ${e.symbol ?? ''} ${e.error}`).join(' · ')}
            </p>
          )}
          {rows.length === 0 ? (
            <div className="empty">No opportunity matches these filters. Zero is a valid result — nothing is fabricated to fill a category.</div>
          ) : (
            <div className="op-table-wrap">
              <table className="wf-table op-table">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Opportunity</th>
                    <th>Dir</th>
                    <th>Mode</th>
                    <th>TF</th>
                    <th>Detector</th>
                    <th>Confirmation</th>
                    <th>Lifecycle</th>
                    <th>Waiting for / next</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <Fragment key={h.opportunityId}>
                      <tr className={open === h.opportunityId ? 'open' : ''} onClick={() => setOpen(open === h.opportunityId ? null : h.opportunityId)}>
                        <td>
                          <b>{h.symbol}</b>
                          {h.TiTLevel ? <small> {h.TiTLevel}</small> : null}
                        </td>
                        <td>
                          <TypeBadge h={h} />
                          {h.opportunityContext.includes('POST_EVENT') && <span className="op-ctx">POST EVENT</span>}
                        </td>
                        <td className={`dir ${h.direction === 'BULLISH' ? 'long' : h.direction === 'BEARISH' ? 'short' : 'neutral'}`}>{h.side}</td>
                        <td>
                          <span className={`op-mode m-${h.mode.toLowerCase()}`}>{h.mode}</span>
                        </td>
                        <td>
                          {h.parentTimeframe ?? '—'}→{h.executionTimeframe ?? '—'}
                        </td>
                        <td className="mono">{h.detectorState}</td>
                        <td className="mono">{h.confirmationState}</td>
                        <td>
                          <span className={`op-life t-${lifecycleTone(h.lifecycle)}`}>{h.lifecycle}</span>
                        </td>
                        <td className="muted">{h.missingEvidence.length ? h.missingEvidence.join(', ') : h.nextStep}</td>
                      </tr>
                      {open === h.opportunityId && (
                        <tr className="detail-row">
                          <td colSpan={9}>
                            <Detail h={h} shadow8={data?.shadowStage8[h.opportunityId]} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {matrix && <Matrix matrix={matrix} />}
    </section>
  );
}
