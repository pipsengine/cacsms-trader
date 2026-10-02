import { ArrowUpRight } from 'lucide-react';
import type { TimeframeState } from '../types/analysis';

export default function TimeframeStrip({
  items,
  active,
  onSelect,
}: {
  items: TimeframeState[];
  active?: string;
  onSelect?: (tf: string) => void;
}) {
  return (
    <section className="tf-strip">
      {items.map((x) => (
        <article
          key={x.tf}
          className={`tf-card ${x.tf === active ? 'selected' : ''}`}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          onClick={onSelect ? () => onSelect(x.tf) : undefined}
          onKeyDown={
            onSelect
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect(x.tf);
                }
              : undefined
          }
        >
          <div className="tf-title">
            {x.tf}
            <ArrowUpRight size={17} className={x.tone === 'bear' ? 'red' : 'green'} />
          </div>
          <strong className={x.tone === 'bear' ? 'red' : 'green'}>{x.direction}</strong>
          <span>{x.state}</span>
          <b>{x.score}%</b>
        </article>
      ))}
    </section>
  );
}
