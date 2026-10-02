import type { AiChartAnalysisPayload, EvidenceItem, TimeframeStripRow } from '../types';
import type { Direction, EvidenceRow, TF } from './types';

const MACRO: TF[] = ['YTD', 'Q'];
const PRIMARY: TF[] = ['MN', 'W'];
const OPERATIONAL: TF[] = ['D1', 'H8'];
const SETUP: TF[] = ['H1'];
const ENTRY: TF[] = ['M15', 'M5'];

const DISPLAY_LIMIT = 8;

function asTf(v: string | undefined): TF {
  const u = (v || 'H1').toUpperCase() as TF;
  return u;
}

function isEventSpam(text: string): boolean {
  return /\b(BOS|CHOCH)\b/i.test(text) && /closed bar/i.test(text);
}

function dedupeRows(rows: EvidenceRow[]): EvidenceRow[] {
  const seen = new Set<string>();
  const out: EvidenceRow[] = [];
  for (const r of rows) {
    const key = `${r.kind}|${r.title}|${r.tf}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function rowFromItem(kind: EvidenceRow['kind'], e: EvidenceItem): EvidenceRow {
  const text = e.text || '';
  return {
    kind,
    title: text,
    detail: e.source || 'Engine',
    tf: asTf(e.timeframe),
  };
}

function synthesizeTfGroup(label: string, rows: TimeframeStripRow[], tradeDir: Direction): EvidenceRow | null {
  if (!rows.length) return null;
  const dirs = rows.map((r) => r.direction).filter((d) => d && d !== 'UNKNOWN' && d !== 'NEUTRAL');
  if (!dirs.length) {
    return { kind: 'support', title: `${label}: context unclear`, detail: 'Insufficient closed-bar alignment', tf: rows[0].timeframe as TF };
  }
  const bull = dirs.filter((d) => d === 'BULLISH').length;
  const bear = dirs.filter((d) => d === 'BEARISH').length;
  let dir: Direction = 'NEUTRAL';
  if (bull > bear) dir = 'BULLISH';
  else if (bear > bull) dir = 'BEARISH';
  else dir = 'MIXED';

  const tfLabel = rows.map((r) => r.timeframe).join('/');
  if (dir === tradeDir || dir === 'MIXED') {
    const ms = rows.map((r) => r.marketState?.replace(/_/g, ' ')).find(Boolean) || 'aligned';
    return {
      kind: 'support',
      title: `${tfLabel}: ${dir.toLowerCase()} ${ms.toLowerCase()}`,
      detail: 'Top-down structural context',
      tf: rows[0].timeframe as TF,
    };
  }
  if (label.includes('Entry') && dir !== tradeDir) {
    return {
      kind: 'conflict',
      title: `${tfLabel}: ${dir.toLowerCase()} vs ${tradeDir.toLowerCase()} operational bias`,
      detail: 'Entry timeframe not aligned — may be pullback or conflict',
      tf: rows[0].timeframe as TF,
    };
  }
  return {
    kind: 'conflict',
    title: `${tfLabel}: ${dir.toLowerCase()} vs higher-timeframe ${tradeDir.toLowerCase()}`,
    detail: 'Hierarchy tension',
    tf: rows[0].timeframe as TF,
  };
}

function collapseRawEvents(items: EvidenceItem[]): EvidenceRow[] {
  const byTf = new Map<string, EvidenceItem[]>();
  for (const e of items) {
    if (!isEventSpam(e.text || '')) continue;
    const tf = (e.timeframe || '?').toUpperCase();
    const list = byTf.get(tf) || [];
    list.push(e);
    byTf.set(tf, list);
  }
  const out: EvidenceRow[] = [];
  for (const [tf, list] of byTf) {
    const last = list[list.length - 1];
    const m = (last.text || '').match(/(BULLISH|BEARISH)?\s*(BOS|CHOCH)/i);
    const event = m?.[2]?.toUpperCase() || 'STRUCTURE';
    const dir = m?.[1]?.toLowerCase() || 'structural';
    out.push({
      kind: 'support',
      title: `${tf}: ${dir} structure — latest ${event} on closed bar`,
      detail: `${list.length} raw events collapsed`,
      tf: asTf(tf),
    });
  }
  return out;
}

export type SynthesizedEvidence = {
  supporting: EvidenceRow[];
  conflicting: EvidenceRow[];
  missing: EvidenceRow[];
  raw: EvidenceRow[];
  extra: { support: number; conflict: number; missing: number };
  counts: { support: number; conflict: number; missing: number };
};

export function synthesizeEvidence(payload: AiChartAnalysisPayload): SynthesizedEvidence {
  const strip = payload.timeframeStrip || [];
  const tradeDir = (payload.direction || 'NEUTRAL') as Direction;
  const pick = (tfs: TF[]) => strip.filter((r) => tfs.includes(r.timeframe as TF));

  const synthesized: EvidenceRow[] = [];
  for (const [label, tfs] of [
    ['Macro context', MACRO],
    ['Primary structure', PRIMARY],
    ['Operational alignment', OPERATIONAL],
    ['Setup timeframe', SETUP],
    ['Entry refinement', ENTRY],
  ] as const) {
    const row = synthesizeTfGroup(label, pick(tfs), tradeDir);
    if (row) synthesized.push(row);
  }

  const rawSupport = (payload.supportingEvidence || []).map((e) => rowFromItem('support', e));
  const rawConflict = (payload.conflictingEvidence || []).map((e) => rowFromItem('conflict', e));
  const rawMissing = (payload.missingEvidence || []).map((e) => rowFromItem('missing', e));

  const nonSpamSupport = rawSupport.filter((r) => !isEventSpam(r.title));
  const collapsed = collapseRawEvents(payload.supportingEvidence || []);

  let supporting = dedupeRows([
    ...synthesized.filter((r) => r.kind === 'support'),
    ...nonSpamSupport,
    ...collapsed,
  ]).filter((r) => r.kind === 'support');

  let conflicting = dedupeRows([
    ...synthesized.filter((r) => r.kind === 'conflict'),
    ...rawConflict,
  ]).filter((r) => r.kind === 'conflict');

  let missing = dedupeRows(rawMissing);

  if (tradeDir === 'BULLISH' || tradeDir === 'BEARISH') {
    const m15 = strip.find((r) => r.timeframe === 'M15');
    if (m15 && m15.direction !== tradeDir && m15.direction !== 'UNKNOWN') {
      if (!conflicting.some((c) => c.title.includes('M15'))) {
        conflicting.push({
          kind: 'conflict',
          title: `M15 remains structurally ${m15.direction.toLowerCase()}`,
          detail: 'ChannelEngine',
          tf: 'M15',
        });
      }
    }
    const hasM15Bos = missing.some((m) => /M15.*BOS/i.test(m.title)) || supporting.some((s) => /M15.*BOS/i.test(s.title));
    if (!hasM15Bos && !payload.tradable) {
      missing.push({
        kind: 'missing',
        title: tradeDir === 'BULLISH' ? 'M15 bullish BOS (closed bar)' : 'M15 bearish BOS (closed bar)',
        detail: 'ConfirmationEngine',
        tf: 'M15',
      });
    }
  }

  missing = dedupeRows(missing);

  const raw = dedupeRows([...rawSupport, ...rawConflict, ...rawMissing]);

  const extra = {
    support: Math.max(0, supporting.length - DISPLAY_LIMIT),
    conflict: Math.max(0, conflicting.length - DISPLAY_LIMIT),
    missing: Math.max(0, missing.length - DISPLAY_LIMIT),
  };

  const counts = {
    support: supporting.length,
    conflict: conflicting.length,
    missing: missing.length,
  };

  supporting = supporting.slice(0, DISPLAY_LIMIT);
  conflicting = conflicting.slice(0, DISPLAY_LIMIT);
  missing = missing.slice(0, DISPLAY_LIMIT);

  return { supporting, conflicting, missing, raw, extra, counts };
}

export function formatThesis(payload: AiChartAnalysisPayload): string {
  const title = payload.direction === 'BULLISH' ? 'Bullish' : payload.direction === 'BEARISH' ? 'Bearish' : 'Neutral';
  const ms = (payload.marketState || 'unclear').replace(/_/g, ' ').toLowerCase();
  const strip = payload.timeframeStrip || [];
  const d1 = strip.find((r) => r.timeframe === 'D1');
  const h8 = strip.find((r) => r.timeframe === 'H8');
  const h1 = strip.find((r) => r.timeframe === 'H1');
  const lines: string[] = [];
  if (ms.includes('breakout')) lines.push(`${title} breakout developing`);
  else if (ms.includes('pullback')) lines.push(`${title} continuation (pullback)`);
  else lines.push(`${title} ${ms}`);

  if (d1?.direction === 'BULLISH' || h8?.direction === 'BULLISH') lines.push('D1 and H8 remain structurally bullish.');
  else if (d1?.direction === 'BEARISH' || h8?.direction === 'BEARISH') lines.push('D1 and H8 remain structurally bearish.');

  if (h1?.marketState?.includes('PULLBACK')) {
    lines.push('H1 is in a counter-trend pullback within the higher-timeframe structure.');
  } else if (ms.includes('breakout')) {
    lines.push('H1 has broken through its active structural range.');
  }

  const m15Missing = (payload.missingEvidence || []).some((m) => /M15/i.test(m.text || '') && /BOS/i.test(m.text || ''));
  if (m15Missing || !payload.tradable) {
    lines.push('M15 structural confirmation is still absent.');
  }

  lines.push(
    payload.tradable
      ? 'Deterministic gates are progressing; Stage 8 authorization remains required before execution.'
      : 'The thesis may remain valid, but the setup is not yet tradable.',
  );
  return lines.join('\n\n');
}

/** Short narrative for the thesis hero (reference design — one compact paragraph). */
export function thesisBrief(payload: AiChartAnalysisPayload): string {
  const strip = payload.timeframeStrip || [];
  const macro = strip.filter((r) => ['YTD', 'Q', 'D1', 'H8'].includes(r.timeframe));
  const macroDir = payload.direction === 'BULLISH' ? 'bullish' : payload.direction === 'BEARISH' ? 'bearish' : 'mixed';
  const aligned = macro.filter((r) => r.direction === payload.direction).map((r) => r.timeframe);
  const h1 = strip.find((r) => r.timeframe === 'H1');
  const m15 = strip.find((r) => r.timeframe === 'M15');
  const ms = (payload.marketState || '').replace(/_/g, ' ').toLowerCase();

  const parts: string[] = [];
  if (aligned.length) {
    parts.push(`Structure remains ${macroDir} on ${aligned.join(', ')}.`);
  } else {
    parts.push(`Higher-timeframe context is ${macroDir} with mixed alignment across YTD→H8.`);
  }

  if (h1) {
    const h1Ms = (h1.marketState || '').replace(/_/g, ' ').toLowerCase();
    if (ms.includes('pullback') || h1Ms.includes('pullback') || h1Ms.includes('correction')) {
      parts.push(
        `${h1.timeframe} is in a ${h1.direction?.toLowerCase() || 'counter-trend'} ${h1Ms || 'pullback'} against that bias; price is approaching the ${h1.timeframe} reaction zone.`,
      );
    } else if (ms.includes('breakout')) {
      parts.push(`${h1.timeframe} shows ${ms}; continuation depends on closed-bar confirmation.`);
    }
  }

  if (m15 && m15.direction !== payload.direction && m15.direction !== 'UNKNOWN') {
    parts.push(`${m15.timeframe} remains structurally ${m15.direction.toLowerCase()} — entry confirmation still required.`);
  } else if (!payload.tradable) {
    parts.push('M15 structural confirmation is still absent before the setup becomes tradable.');
  }

  return parts.join(' ');
}

export function priceLocationCopy(payload: AiChartAnalysisPayload): { title: string; detail: string } {
  const h1 = payload.timeframeStrip?.find((r) => r.timeframe === 'H1');
  const loc = (h1?.priceLocation || h1?.structure || '').replace(/_/g, ' ');
  const ms = (h1?.marketState || payload.marketState || '').replace(/_/g, ' ').toLowerCase();
  if (loc && loc !== '—') {
    return {
      title: loc,
      detail: ms.includes('pullback') ? `Approaching ${h1?.timeframe || 'H1'} ERZ` : 'Channel / ERZ context from engines',
    };
  }
  if (ms.includes('pullback')) {
    return { title: 'Lower half of active channel', detail: `Approaching ${h1?.timeframe || 'H1'} ERZ` };
  }
  return { title: payload.marketState?.replace(/_/g, ' ') || '—', detail: 'Channel / ERZ context from engines' };
}

export function structureLabel(payload: AiChartAnalysisPayload): string {
  const h1 = payload.timeframeStrip?.find((r) => r.timeframe === 'H1');
  const s = h1?.structure || '';
  if (/HH|HL/i.test(s)) return 'HH → HL';
  if (/LH|LL/i.test(s)) return 'LH → LL';
  if (payload.direction === 'BULLISH') return 'HH → HL';
  if (payload.direction === 'BEARISH') return 'LH → LL';
  return s.replace(/_/g, ' ') || '—';
}

export type PathStep = { label: string; state: 'done' | 'active' | 'pending' };

export function expectedPath(payload: AiChartAnalysisPayload): PathStep[] {
  const labels = ['ERZ', 'Reaction', 'BOS', 'Retest', 'T1', 'T2'] as const;
  const chain = payload.tradabilityChain || [];
  const stateOf = (stage: string) => chain.find((c) => c.stage === stage)?.state;

  const doneFlags = [
    stateOf('LOCATION') === 'COMPLETE' || stateOf('MACRO_CONTEXT') === 'COMPLETE',
    stateOf('REACTION') === 'COMPLETE',
    stateOf('STRUCTURAL_CONFIRMATION') === 'COMPLETE',
    stateOf('RETEST') === 'COMPLETE',
    false,
    false,
  ];

  let activeIdx = doneFlags.findIndex((d) => !d);
  if (activeIdx < 0) activeIdx = labels.length - 1;

  return labels.map((label, i) => {
    if (doneFlags[i]) return { label, state: 'done' as const };
    if (i === activeIdx) return { label, state: 'active' as const };
    return { label, state: 'pending' as const };
  });
}

export function formatTfScore(confidence: number, direction: string): string {
  if (direction === 'UNKNOWN' || direction === 'NEUTRAL') return '—';
  if (confidence <= 0) return '—';
  return `${Math.round(confidence)}%`;
}
