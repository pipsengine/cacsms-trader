import { useState } from 'react';
import { GitCompareArrows, ShieldAlert } from 'lucide-react';
import { humanizeEngineState, supertrendClass } from '../displayFormat';
import type { AnalysisResult, Evidence } from '../types';

const tabs = ['AI Analysis', 'Opportunity', 'P1 / P2', 'Engines'];
const sub = ['Thesis', 'Evidence', 'Scenarios', 'Tradability', 'Reconciliation'];

export function AnalysisPanel({ a }: { a: AnalysisResult }) {
  const [tab, setTab] = useState('AI Analysis');
  const [view, setView] = useState('Thesis');

  const dirCls = a.direction === 'BULLISH' ? 'up' : a.direction === 'BEARISH' ? 'down' : 'flat';
  const dirLabel =
    a.direction === 'BULLISH' ? '↗ Bullish' : a.direction === 'BEARISH' ? '↘ Bearish' : a.direction;

  return (
    <aside className="analysisPanel">
      <div className="mainTabs">
        {tabs.map((t) => (
          <button type="button" key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'AI Analysis' ? (
        <div className="aiAnalysisBody">
          <div className="analysisSummary">
            <div className="summaryTitle">
              <div className="brain">⌁</div>
              <b>
                {a.symbol} — {a.primaryTimeframe}
              </b>
              <span>{a.status}</span>
            </div>
            <div className="thesisHero">
              <div className="heroGlyph">◔</div>
              <div>
                <h3>{a.thesisTitle}</h3>
                {a.modeFocus ? <small className="engineNote">{a.modeFocus}</small> : null}
                <p>{a.thesis}</p>
              </div>
            </div>
            <div className="metrics">
              <Metric n="Direction" v={dirLabel} cls={dirCls} />
              <Metric n="Market State" v={a.marketState} />
              <Metric n="Structure" v={a.structure} />
              <Metric n="Evidence Score" v={`${a.evidenceScore} / 100`} ring />
            </div>
          </div>
          <div className="subTabs">
            {sub.map((t) => (
              <button type="button" key={t} className={view === t ? 'active' : ''} onClick={() => setView(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="panelContent">
            {view === 'Thesis' && <Thesis a={a} />}
            {view === 'Evidence' && <EvidenceView a={a} />}
            {view === 'Scenarios' && <Scenarios a={a} />}
            {view === 'Tradability' && <Tradability a={a} />}
            {view === 'Reconciliation' && <ReconciliationView a={a} />}
          </div>
        </div>
      ) : (
        <div className="aiAnalysisBody">
          <EngineTab tab={tab} a={a} />
        </div>
      )}
    </aside>
  );
}

function Metric({ n, v, cls = '', ring = false }: { n: string; v: string; cls?: string; ring?: boolean }) {
  return (
    <div className="metric">
      <small>{n}</small>
      <strong className={cls}>{v}</strong>
      {ring && <i className="scoreRing" aria-hidden />}
    </div>
  );
}

function Thesis({ a }: { a: AnalysisResult }) {
  const [loc, detail] = a.priceLocation.split(' · ');
  return (
    <>
      <div className="evidenceColumns">
        <EvidenceCol title="Supporting Evidence" kind="SUPPORTING" data={a.evidence} />
        <EvidenceCol title="Conflicting Evidence" kind="CONFLICTING" data={a.evidence} />
        <EvidenceCol title="Missing Evidence" kind="MISSING" data={a.evidence} />
      </div>
      <div className="miniCards">
        <div>
          <small>Price Location</small>
          <b>{loc}</b>
          <span>{detail}</span>
          <input type="range" value={72} readOnly />
        </div>
        <div>
          <small>Supertrend</small>
          <b className={supertrendClass(a.supertrend)}>
            {a.supertrend === 'BULLISH' ? '↗' : a.supertrend === 'BEARISH' ? '↘' : '—'}{' '}
            {a.supertrend === 'NEUTRAL' ? 'Unavailable' : title(a.supertrend)}
          </b>
          <span>▮▮▮▮▮</span>
        </div>
        <div>
          <small>HTF Alignment</small>
          {a.htfAlignment.map((x) => (
            <b key={x} className={x.toLowerCase().includes('bear') ? 'down' : x.toLowerCase().includes('bull') ? 'up' : 'flat'}>
              ● {x}
            </b>
          ))}
        </div>
      </div>
      <ExpectedPath a={a} />
    </>
  );
}

function EvidenceCol({ title: titleText, kind, data }: { title: string; kind: string; data: Evidence[] }) {
  const xs = data.filter((x) => x.kind === kind).slice(0, 6);
  const total = data.filter((x) => x.kind === kind).length;
  return (
    <div className={`evidenceCol ${kind.toLowerCase()}`}>
      <b>
        {titleText} ({total})
      </b>
      {xs.map((x) => (
        <div key={x.id} title={x.detail}>
          <span>{kind === 'SUPPORTING' ? '✓' : kind === 'CONFLICTING' ? '●' : '○'}</span>
          {x.label}
        </div>
      ))}
    </div>
  );
}

function ExpectedPath({ a }: { a: AnalysisResult }) {
  return (
    <div className="expected">
      <b>
        Expected Path <small>(Not observed price)</small>
      </b>
      <div className="pathLine">
        {a.expectedPath.map((x, i) => (
          <span key={x.label} style={{ display: 'contents' }}>
            <div>
              <i className={x.status}>{i + 1}</i>
              <small>{x.label}</small>
            </div>
            {i < a.expectedPath.length - 1 && <span />}
          </span>
        ))}
      </div>
    </div>
  );
}

function EvidenceView({ a }: { a: AnalysisResult }) {
  return (
    <div className="detailList">
      <p className="engineNote">Raw engine observations (deduplicated). Main thesis uses synthesized evidence only.</p>
      {a.evidence.slice(0, 24).map((x) => (
        <article key={x.id}>
          <span className={x.kind.toLowerCase()}>{x.kind}</span>
          <div>
            <b>
              {x.timeframe} · {x.label}
            </b>
            <p>{x.detail}</p>
            <small>{x.source}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

function Scenarios({ a }: { a: AnalysisResult }) {
  return (
    <div className="scenarioList">
      <small className="engineNote">Projected scenarios — not observed price.</small>
      {a.scenarios.map((s) => (
        <article key={s.id}>
          <header>
            <b>{s.name}</b>
            <span>{s.status}</span>
          </header>
          {s.conditions.map((c) => (
            <p key={c}>✓ {c}</p>
          ))}
          <strong>Invalidation: {s.invalidation}</strong>
        </article>
      ))}
    </div>
  );
}

function Tradability({ a }: { a: AnalysisResult }) {
  return (
    <div className="tradeChain">
      {a.tradability.map((s) => (
        <div key={s.id}>
          <i className={s.status.toLowerCase()}>{s.status === 'COMPLETE' ? '✓' : s.status === 'ACTIVE' ? '◷' : '○'}</i>
          <section>
            <b>{s.label}</b>
            <small>{s.detail}</small>
          </section>
        </div>
      ))}
      {!a.tradable && <strong className="notAuth">EXECUTION NOT AUTHORIZED</strong>}
    </div>
  );
}

function ReconciliationView({ a }: { a: AnalysisResult }) {
  return (
    <div className="recon">
      <GitCompareArrows />
      <h3>{a.reconciliation.state}</h3>
      <b>AI interpretation</b>
      <p>{a.reconciliation.ai}</p>
      <b>Deterministic engine</b>
      <p>{a.reconciliation.engine}</p>
      <b>Difference</b>
      <p>{a.reconciliation.difference}</p>
    </div>
  );
}

function EngineRow({ row }: { row: NonNullable<AnalysisResult['engines']>[number] }) {
  const [open, setOpen] = useState(false);
  const highlights = (row.highlights || []).filter((h) => h && h !== '—');
  return (
    <div className="engineRow">
      <button type="button" className="engineRowHead" onClick={() => setOpen((v) => !v)}>
        <span>{row.engine}</span>
        <b>{row.summary}</b>
        <small>{row.agreement || '—'}</small>
        {highlights.length ? <small>{open ? '▾' : '▸'} evidence</small> : null}
      </button>
      {open && highlights.length ? (
        <ul className="engineHighlights">
          {highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EngineTab({ tab, a }: { tab: string; a: AnalysisResult }) {
  return (
    <div className="engineTab scrollPane">
      <ShieldAlert />
      <h3>{tab}</h3>
      <p>Authoritative engine state — AI interprets but cannot authorize execution.</p>
      {tab === 'P1 / P2' && (
        <>
          <b>P1: {humanizeEngineState(a.p1State)}</b>
          <b>P2: {humanizeEngineState(a.p2State)}</b>
          <small>Analytical tradability: {a.analyticalTradability?.replace(/_/g, ' ') || '—'}</small>
        </>
      )}
      {tab === 'Opportunity' && <OpportunityView a={a} />}
      {tab === 'Engines' && (
        <>
          {(a.engines?.length ? a.engines : []).map((row) => (
            <EngineRow key={row.engine} row={row} />
          ))}
          {!a.engines?.length &&
            a.timeframes.map((x) => (
              <div key={x.timeframe}>
                <span>{x.timeframe}</span>
                <b>{x.lastEvent}</b>
                <small>{x.supertrend}</small>
              </div>
            ))}
          {a.contradictions?.length ? (
            <>
              <b>Derived contradictions</b>
              {a.contradictions.map((c) => (
                <p key={c}>{c}</p>
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function OpportunityView({ a }: { a: AnalysisResult }) {
  const o = a.opportunityDetail;
  if (!o?.available) {
    return (
      <>
        <b>No active opportunity row</b>
        <p>Opportunity Framework returned no hypothesis for this symbol.</p>
      </>
    );
  }
  return (
    <>
      <b>{o.opportunityType || a.opportunity}</b>
      <span>ID: {o.opportunityId}</span>
      <p>
        Direction: {o.direction} · Origin: {o.originTimeframe} · Lifecycle: {o.lifecycle}
      </p>
      {o.zone && <p>Zone: {o.zone}</p>}
      {o.distanceToZone != null && <p>Distance to zone: {o.distanceToZone}</p>}
      <p>Reaction: {humanizeEngineState(o.reactionState || '—')}</p>
      <p>Break: {humanizeEngineState(o.breakState || a.p2State)}</p>
      {o.retestState && <p>Retest: {humanizeEngineState(o.retestState)}</p>}
      {o.invalidation && <p>Invalidation: {o.invalidation}</p>}
      {!!o.blockingRequirements?.length && (
        <>
          <b>Blocking requirements</b>
          {o.blockingRequirements.slice(0, 5).map((req, i) => (
            <small key={i}>{typeof req === 'string' ? req : JSON.stringify(req)}</small>
          ))}
        </>
      )}
    </>
  );
}

const title = (x: string) => x[0] + x.slice(1).toLowerCase();
