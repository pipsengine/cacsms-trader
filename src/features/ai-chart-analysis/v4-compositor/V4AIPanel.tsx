import { useState } from 'react';
import type { AnalysisState } from '../v3-e2e/types/analysis';

const tabs = ['AI Analysis', 'Opportunity', 'P1 / P2', 'Engines'];
const inner = ['Thesis', 'Evidence', 'Scenarios', 'Tradability', 'Reconciliation'];

function humanStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

export default function V4AIPanel({ data }: { data: AnalysisState }) {
  const [top, setTop] = useState(0);
  const [inside, setInside] = useState(0);
  const dirGlyph = data.direction.toLowerCase().includes('bear') ? '↘' : '↗';

  return (
    <aside className="aiPanel">
      <div className="tabs">
        {tabs.map((t, i) =>
          i === 0 ? (
            <b key={t}>{t}</b>
          ) : (
            <span key={t} role="button" tabIndex={0} onClick={() => setTop(i)} onKeyDown={() => undefined}>
              {t}
            </span>
          ),
        )}
      </div>
      <div className="aiBody">
        <div className="thesisHead">
          <div className="aiIcon">⌘</div>
          <b>
            {data.symbol} — {data.timeframe}
          </b>
          <strong>{humanStatus(data.status)}</strong>
        </div>
        <div className="thesis">
          <div className="thesisGlyph">{dirGlyph}</div>
          <div>
            <h2>{data.title}</h2>
            <p>{data.summary}</p>
          </div>
        </div>
        <div className="metrics">
          <div>
            <small>Direction</small>
            <b>
              {dirGlyph} {data.direction}
            </b>
          </div>
          <div>
            <small>Market State</small>
            <b>{data.marketState}</b>
          </div>
          <div>
            <small>Structure</small>
            <b>{data.structure}</b>
          </div>
          <div className="score">
            <small>Evidence</small>
            <b>{data.evidenceScore} / 100</b>
            <i
              className="score-ring"
              style={{ ['--score-deg' as string]: `${data.evidenceScore * 3.6}deg` }}
            />
          </div>
        </div>
        <div className="subtabs">
          {inner.map((t, i) =>
            i === inside ? (
              <b key={t}>{t}</b>
            ) : (
              <span key={t} role="button" tabIndex={0} onClick={() => setInside(i)}>
                {t}
              </span>
            ),
          )}
        </div>
        {inside === 0 ? (
          <>
            <div className="evidence">
              <section>
                <h3>Supporting Evidence ({data.support.length})</h3>
                {data.support.map((e) => (
                  <p key={e.id}>● {e.text}</p>
                ))}
              </section>
              <section className="conflict">
                <h3>Conflicting Evidence ({data.conflict.length})</h3>
                {data.conflict.map((e) => (
                  <p key={e.id}>◉ {e.text}</p>
                ))}
              </section>
              <section className="missing">
                <h3>Missing Evidence ({data.missing.length})</h3>
                {data.missing.map((e) => (
                  <p key={e.id}>○ {e.text}</p>
                ))}
              </section>
            </div>
            <div className="miniCards">
              <div>
                <b>Price Location</b>
                <p>
                  {data.location.split('\n').map((line, i) => (
                    <span key={i}>
                      {line}
                      <br />
                    </span>
                  ))}
                </p>
                <div className="slider">
                  <i />
                </div>
              </div>
              <div>
                <b>Supertrend</b>
                <strong>
                  {dirGlyph} &nbsp; {data.supertrend}
                </strong>
                <div className="bars">▮ ▮ ▮ ▮ ▮</div>
              </div>
              <div>
                <b>HTF Alignment</b>
                {data.alignment.map((x) => (
                  <strong key={x}>● &nbsp; {x}</strong>
                ))}
              </div>
            </div>
            <div className="expected">
              <b>
                Expected Path <small>(Not observed price)</small>
              </b>
              <div className="pathline">
                {data.expectedPath.map((step, i) => (
                  <span key={step.label}>
                    <i>{i + 1}</i>
                    <small>{step.label}</small>
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="evidence">
            <section>
              <h3>{inner[inside]}</h3>
              <p>Autonomous engine data for this tab is shown in production when wired to the backend snapshot.</p>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
