import { instruments } from '../../../data/market';
import { stage2Output } from '../../currency-strength/services/strengthStage';
import { stage9Output } from '../../execution/services/executionStage';
import { stage7Output } from '../../h1-confirmation/services/confirmStage';
import { getRegimeSnapshot } from '../../historical-regime/services/regimeStore';
import { getVisionSnapshot } from '../../htf-vision/services/visionStore';
import { stage5Output } from '../../htf-vision/services/visionStage';
import { getHistorySnapshot, getInstrumentHistoryGate, historyReadyCount } from '../../market-data/services/historyStore';
import { stage4Output } from '../../market-scanner/services/scannerStage';
import { stage8Output } from '../../opportunity-risk/services/riskStage';
import { stage6Output } from '../../structural-direction/services/directionStage';
import type { StageRuntime } from '../types/workflow';
import { human } from '../utils/format';

const brief = (s: string | null | undefined, max = 110) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};

const n1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));

/** Why this stage is not passing work on, in one readable line. */
function holdLine(stage: StageRuntime): string | null {
  if (stage.health === 'OFFLINE' || stage.health === 'ERROR') return brief(`${stage.health}: ${stage.healthReason}`);
  if (stage.blockedBy) return brief(`Held by S${stage.blockedBy.id} ${stage.blockedBy.name} — ${stage.blockedBy.detail}`);
  if (stage.state === 'READY' || stage.state === 'RUNNING' || stage.state === 'IDLE') return brief(stage.stateReason);
  return brief(stage.stateReason);
}

/** Short facts printed on the stage card. The first line is the Stage 4 leader, not the chart selection. */
export function stageCardLines(stage: StageRuntime, focus: string): string[] {
  const pair = focus || '—';
  const lines: string[] = [];
  switch (stage.id) {
    case 1: {
      const row = instruments.find((i) => i.symbol === pair);
      const live = row && row.bid > 0 && row.ask >= row.bid;
      const gate = getInstrumentHistoryGate(pair);
      const hs = getHistorySnapshot().status;
      const hr = historyReadyCount();
      lines.push(`${pair} · ${live ? 'live quote' : 'no live quote'} · history ${human(gate.code)}`);
      lines.push(`History ${hr.ready}/${hr.total || '—'} READY · quality ${hs?.summary.quality ?? '—'}% · market ${hs?.provider.marketOpen ? 'open' : 'closed'}`);
      break;
    }
    case 2: {
      const s2 = stage2Output();
      const p = s2.pairs.find((x) => x.symbol === pair);
      lines.push(`${pair} · ${p ? `${p.base} vs ${p.quote}` : 'pair'} · differential ${n1(p?.differential)}`);
      lines.push(s2.strongest && s2.weakest ? `Strongest ${s2.strongest} · weakest ${s2.weakest} · spread ${n1(s2.spread)}` : 'Strongest / weakest not published');
      lines.push(`Strength ${s2.assets.filter((a) => a.composite != null).length}/9 · ${human(s2.state)}`);
      break;
    }
    case 3: {
      const pairs = getRegimeSnapshot().state?.pairs ?? [];
      const assets = getRegimeSnapshot().state?.assets ?? [];
      const p = pairs.find((x) => x.symbol === pair);
      lines.push(
        p
          ? `${pair} · ${human(p.baseRegime)} / ${human(p.quoteRegime)} · ${human(p.bias)} · diff ${n1(p.differential)}`
          : `${pair} · regime not published`,
      );
      lines.push(`Classified ${assets.filter((a) => a.latest?.regime).length}/${assets.length || 9} · pairs ready ${pairs.filter((x) => x.status === 'READY').length}/${pairs.length || 0}`);
      if (p && p.status !== 'READY' && p.reason) lines.push(brief(p.reason));
      break;
    }
    case 4: {
      const s4 = stage4Output();
      const row = s4.instruments.find((i) => i.symbol === pair);
      const c = s4.counters;
      const threshold = row?.promotion.threshold;
      lines.push(
        row
          ? `${pair} · rank ${row.rank} · ${human(row.state)} · conviction ${n1(row.conviction)}${threshold != null ? ` vs ${threshold}` : ''}`
          : `${pair} · not ranked`,
      );
      lines.push(c ? `Promoted ${c.promoted} · qualified ${s4.qualified} · directional ${c.directional}/${c.universe}` : `Promoted ${s4.promoted.length}`);
      if (row && row.state !== 'PROMOTED') lines.push(brief(row.reason));
      break;
    }
    case 5: {
      const s5 = stage5Output();
      const summary = getVisionSnapshot().state?.run?.summary;
      const row = s5.instruments.find((i) => i.symbol === pair);
      lines.push(
        row
          ? `${pair} · ${human(row.status)} · D1 ${human(row.d1?.status)} · ${human(row.agreement)}`
          : `${pair} · not analysed`,
      );
      lines.push(`D1 channels ${summary?.confirmedD1 ?? s5.confirmedD1} · D1/H8 agree ${summary?.agree ?? s5.agree} · scanner-qualified ${summary?.qualified ?? s5.qualified}`);
      if (row?.reason) lines.push(brief(row.reason));
      break;
    }
    case 6: {
      const s6 = stage6Output();
      const row = s6.decisions.find((d) => d.symbol === pair);
      const c = s6.counters;
      lines.push(row ? `${pair} · ${human(row.state)} · ${human(row.direction)}` : `${pair} · no structural decision`);
      lines.push(c ? `Ready for H1 ${c.ready} · aligned ${c.aligned} · conflicts ${c.conflicts}` : `Ready for H1 ${s6.ready.length}`);
      if (row && !row.readyForH1) lines.push(brief(row.reason));
      break;
    }
    case 7: {
      const s7 = stage7Output();
      const row = s7.decisions.find((d) => d.symbol === pair);
      const c = s7.counters;
      lines.push(row ? `${pair} · ${human(row.state)} · score ${n1(row.score)}` : `${pair} · no H1 evaluation`);
      lines.push(c ? `Confirmed ${c.confirmed} · monitoring ${c.monitoring} · rejected ${c.rejected}` : `Confirmed ${s7.confirmed.length}`);
      if (row && row.state !== 'CONFIRMED') lines.push(brief(row.reason));
      break;
    }
    case 8: {
      const s8 = stage8Output();
      const row = s8.opportunities.find((o) => o.symbol === pair);
      const c = s8.counters;
      lines.push(row ? `${pair} · ${human(row.state)} · score ${n1(row.score)} · ${row.authorizedAccounts} account path(s)` : `${pair} · no active setup`);
      lines.push(c ? `Authorized ${c.authorized} · qualified ${c.qualified} · blocked ${c.blocked}` : `Authorized ${s8.pending.length}`);
      lines.push(row?.reason ? brief(row.reason) : `New trades ${s8.auto ? 'running' : 'paused'}`);
      break;
    }
    case 9: {
      const s9 = stage9Output();
      const open = s9.open.find((x) => x.instrument === pair);
      lines.push(`Execution ${s9.executionEnabled ? 'ON' : 'OFF'} · new entries ${s9.newEntries ? 'open' : 'blocked'} · trading ${s9.tradingEnabled ? 'running' : 'paused'}`);
      lines.push(open ? `${pair} · ${human(open.positionState)} · ${human(open.direction)}` : `${pair} · no open position`);
      lines.push(`Open ${s9.open.length} · queue ${s9.queue.length} · findings ${s9.findings.length}`);
      break;
    }
    default: {
      const s9 = stage9Output();
      const published = s9.trades.filter((t) => t.stage10Status === 'PUBLISHED').length;
      const awaiting = s9.trades.length - published;
      const mine = s9.trades.filter((t) => t.symbol === pair);
      lines.push(mine.length ? `${pair} · ${mine.length} closed trade record(s)` : `${pair} · no closed trade`);
      lines.push(`Published ${published} · awaiting publication ${awaiting}`);
      break;
    }
  }
  const hold = lines.length >= 3 ? null : holdLine(stage);
  if (hold && !lines.some((l) => l === hold)) lines.push(hold);
  return lines.filter(Boolean).slice(0, 4);
}
