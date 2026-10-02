export function EvidenceScoreRing({ score }: { score: number }) {
  const v = Math.max(0, Math.min(100, score));
  const r = 18;
  const c = 2 * Math.PI * r;
  const dash = (v / 100) * c;
  return (
    <div className="evidenceScoreRing" aria-label={`Evidence score ${v} out of 100`}>
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#1a3348" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="#3dd6a8"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <b>{v}</b>
      <small>/ 100</small>
    </div>
  );
}
