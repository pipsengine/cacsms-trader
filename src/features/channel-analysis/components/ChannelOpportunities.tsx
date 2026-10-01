import { lifecycleTone, useOpportunityFramework } from '../../workflow-engine/services/frameworkClient';

const TERMINAL = new Set(['EXPIRED', 'INVALIDATED', 'COMPLETED']);

/** Compact per-instrument view of the backend opportunity framework. Full detail lives in the Workflow Engine panel. */
export function ChannelOpportunities({ instrument }: { instrument: string }) {
  const { data, error } = useOpportunityFramework(instrument);
  const rows = (data?.framework?.hypotheses ?? []).filter((h) => !TERMINAL.has(h.lifecycle));
  return (
    <section className="ca-panel ca-opps" aria-label={`${instrument} opportunities`}>
      <header>
        <b>{instrument} opportunities</b>
        <span className="ca-muted">
          {data?.framework ? `${rows.length} active · classified by the backend confirmation contracts` : error ? `Unavailable: ${error}` : 'Loading…'}
        </span>
      </header>
      {data?.framework && rows.length === 0 && (
        <p className="ca-muted">No active opportunity on this instrument. Zero is a valid result.</p>
      )}
      {rows.length > 0 && (
        <ul>
          {rows.map((h) => (
            <li key={h.opportunityId}>
              <span className="ca-opp-type">{h.opportunityType}</span>
              <span className="ca-opp-name">
                {h.badge}
                {h.opportunityContext.includes('POST_EVENT') && <em> · post-event</em>}
              </span>
              <span className={h.direction === 'BULLISH' ? 'ca-opp-dir long' : 'ca-opp-dir short'}>{h.side}</span>
              <span className="ca-opp-tf">
                {h.parentTimeframe ?? '—'}→{h.executionTimeframe ?? '—'}
              </span>
              <span className={`ca-opp-mode m-${h.mode.toLowerCase()}`}>{h.mode}</span>
              <span className={`ca-opp-life t-${lifecycleTone(h.lifecycle)}`}>{h.lifecycle}</span>
              <span className="ca-opp-next ca-muted">{h.missingEvidence.length ? `missing ${h.missingEvidence.join(', ')}` : h.nextStep}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
