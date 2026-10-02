import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  X,
} from 'lucide-react';
import { formatTfScore } from './evidenceSynthesis';
import type { AnalysisView, TF } from './types';
import { tfStripClass } from './mapAnalysis';

export function Pill({ children, tone = 'blue' }: { children: ReactNode; tone?: string }) {
  return <span className={'pill ' + tone}>{children}</span>;
}

export function TFStrip({ analysis, selected, onSelect }: { analysis: AnalysisView; selected: TF; onSelect: (tf: TF) => void }) {
  return (
    <div className="tfstrip">
      {analysis.tfs.map((t) => (
        <button type="button" className={tfStripClass(t, selected)} key={t.tf} onClick={() => onSelect(t.tf)}>
          <span>{t.tf}</span>
          <strong>{t.short}</strong>
          <small>{t.structure}</small>
          <em>{formatTfScore(t.confidence, t.direction)}</em>
        </button>
      ))}
    </div>
  );
}

export function Tradability({ analysis, compact }: { analysis: AnalysisView; compact?: boolean }) {
  return (
    <section className={'panel compactPanel' + (compact ? ' chainCompact' : '')}>
      <div className="panelTitle">
        <span>Tradability chain</span>
        <Pill tone={analysis.tradable ? 'green' : 'red'}>{analysis.tradable ? 'ANALYTICAL TRADABLE' : 'EXECUTION NOT AUTHORIZED'}</Pill>
      </div>
      <div className="chain">
        {analysis.steps.map((s, i) => (
          <div className={'step ' + s.state} key={s.label}>
            <div className="stepIcon">
              {s.state === 'done' ? <Check /> : s.state === 'blocked' ? <X /> : <Clock3 />}
            </div>
            <b>{s.label}</b>
            <small>{s.detail}</small>
            {i < analysis.steps.length - 1 && <ChevronRight className="arr" />}
          </div>
        ))}
      </div>
    </section>
  );
}

export function EvidenceColumns({
  analysis,
  onViewRaw,
}: {
  analysis: AnalysisView;
  onViewRaw?: () => void;
}) {
  const support = analysis.evidence.filter((e) => e.kind === 'support');
  const conflict = analysis.evidence.filter((e) => e.kind === 'conflict');
  const missing = analysis.evidence.filter((e) => e.kind === 'missing');
  const extra = analysis.evidenceExtra;
  const extraTotal = extra.support + extra.conflict + extra.missing;

  const block = (
    kind: 'support' | 'conflict' | 'missing',
    rows: typeof support,
    title: string,
    cls: string,
    Icon: typeof CheckCircle2,
  ) => (
    <div>
      <h4 className={cls}>
        {title} ({analysis.evidenceCounts[kind === 'support' ? 'support' : kind === 'conflict' ? 'conflict' : 'missing']})
      </h4>
      {rows.map((e) => (
        <p key={e.title + e.tf}>
          <Icon /> {e.title}
        </p>
      ))}
    </div>
  );

  return (
    <div className="evidenceColumns">
      {block('support', support, 'Supporting Evidence', 'good', CheckCircle2)}
      {block('conflict', conflict, 'Conflicting Evidence', 'bad', AlertTriangle)}
      {block('missing', missing, 'Missing Evidence', 'warn', CircleDashed)}
      {extraTotal > 0 && onViewRaw && (
        <button type="button" className="evidenceMore evidenceMoreRow" onClick={onViewRaw}>
          View {extraTotal} additional observations (Engines tab)
        </button>
      )}
    </div>
  );
}

/** Library detail — compact synthesized evidence (not full raw dump). */
export function EvidenceGrid({ analysis }: { analysis: AnalysisView }) {
  return (
    <div className="evidenceGrid">
      {(['support', 'conflict', 'missing'] as const).map((k) => {
        const rows = analysis.evidence.filter((e) => e.kind === k);
        const count = analysis.evidenceCounts[k === 'support' ? 'support' : k === 'conflict' ? 'conflict' : 'missing'];
        return (
          <section className="panel evidence" key={k}>
            <div className="panelTitle">
              <span>{k === 'support' ? 'Supporting Evidence' : k === 'conflict' ? 'Conflicting Evidence' : 'Missing Evidence'}</span>
              <Pill tone={k === 'support' ? 'green' : k === 'conflict' ? 'amber' : 'red'}>{count}</Pill>
            </div>
            {rows.map((e) => (
              <div className="ev" key={e.title + e.tf}>
                <Pill>{e.tf}</Pill>
                <div>
                  <b>{e.title}</b>
                  <p>{e.detail}</p>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function RawEvidencePanel({ analysis }: { analysis: AnalysisView }) {
  return (
    <div className="rawEvidenceList">
      <p>Full deterministic evidence returned by engines (not shown in main reasoning).</p>
      {analysis.rawEvidence.map((e) => (
        <div className="ev" key={e.title + e.tf + e.kind}>
          <Pill tone={e.kind === 'support' ? 'green' : e.kind === 'conflict' ? 'amber' : 'red'}>{e.tf}</Pill>
          <div>
            <b>{e.title}</b>
            <p>{e.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
