import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import { isNonDirectionalBias } from '@/lib/gold-trade-context';
import { isGoldSymbol } from '@/lib/gold-trading-engine';
import {
  GOLD_TOP_DOWN_EXECUTION,
  GOLD_TOP_DOWN_HTF,
  GOLD_TOP_DOWN_INTERMEDIATE,
} from '@/lib/gold-top-down-timeframes';
import { queryPostgres } from '@/lib/postgres';

export type GoldTopDownGateResult = {
  ok: boolean;
  blockers: string[];
  coverage: Record<string, boolean>;
  htfBias: string;
  alignedWithHtf: boolean;
  reversalConfirmed: boolean;
};

function sideMatchesBias(side: string, bias: string): boolean {
  if (isNonDirectionalBias(bias)) return true;
  const s = side.toUpperCase();
  const b = bias.toLowerCase();
  if (s === 'BUY') return b.includes('bull');
  if (s === 'SELL') return b.includes('bear');
  return false;
}

async function loadCaptureCoverage(symbol: string): Promise<Record<string, boolean>> {
  const result = await queryPostgres(
    `
      SELECT upper(timeframe) AS timeframe, MAX(captured_at) AS last_capture
      FROM chart_captures
      WHERE upper(symbol) = $1
        AND captured_at > now() - interval '6 hours'
      GROUP BY upper(timeframe)
    `,
    [symbol.toUpperCase()],
  ).catch(() => ({ rows: [] }));

  const coverage: Record<string, boolean> = {};
  for (const row of result.rows) {
    coverage[String(row.timeframe ?? '').toUpperCase()] = true;
  }
  return coverage;
}

function planStageBias(
  plan: NonNullable<AutonomousDecisionOutput['institutionalPlan']>,
  timeframes: readonly string[],
): string {
  for (const tf of timeframes) {
    const stage = plan.sequence.find((item) => String(item.timeframe ?? '').toUpperCase() === tf);
    if (stage?.bias && !isNonDirectionalBias(stage.bias)) return stage.bias;
  }
  return plan.htfBias ?? 'neutral';
}

function hasStrongReversalStructure(reason: string, setupType: string): boolean {
  return /choch|change of character|reversal|sweep.*reclaim|displacement/i.test(`${reason} ${setupType}`);
}

export async function evaluateGoldMandatoryTopDown(
  decision: Pick<
    AutonomousDecisionOutput,
    'symbol' | 'decision' | 'institutionalPlan' | 'reasonForDecision' | 'setupType' | 'finalBias'
  >,
): Promise<GoldTopDownGateResult> {
  if (!isGoldSymbol(decision.symbol)) {
    return {
      ok: true,
      blockers: [],
      coverage: {},
      htfBias: 'neutral',
      alignedWithHtf: true,
      reversalConfirmed: false,
    };
  }

  if (decision.decision !== 'BUY' && decision.decision !== 'SELL') {
    return {
      ok: true,
      blockers: [],
      coverage: {},
      htfBias: 'neutral',
      alignedWithHtf: true,
      reversalConfirmed: false,
    };
  }

  const blockers: string[] = [];
  const coverage = await loadCaptureCoverage(decision.symbol);
  const plan = decision.institutionalPlan;

  const requiredTfs = [...GOLD_TOP_DOWN_HTF, ...GOLD_TOP_DOWN_INTERMEDIATE, 'M15'];
  const missing = requiredTfs.filter((tf) => !coverage[tf]);
  if (missing.length > 0) {
    blockers.push(`Mandatory Gold top-down incomplete — missing fresh captures: ${missing.join(', ')}.`);
  }

  if (!plan) {
    blockers.push('Institutional top-down plan missing — trade blocked until MTF analysis completes.');
    return {
      ok: false,
      blockers,
      coverage,
      htfBias: 'unknown',
      alignedWithHtf: false,
      reversalConfirmed: false,
    };
  }

  const htfBias = planStageBias(plan, GOLD_TOP_DOWN_HTF);
  const intermediateBias = planStageBias(plan, GOLD_TOP_DOWN_INTERMEDIATE);
  const executionBias = planStageBias(plan, GOLD_TOP_DOWN_EXECUTION);
  const reversalConfirmed = hasStrongReversalStructure(decision.reasonForDecision, decision.setupType)
    && (plan.countertrendAllowed || /choch|reversal/i.test(plan.conflictPolicy ?? ''));

  const alignedWithHtf = sideMatchesBias(decision.decision, htfBias)
    || plan.rangingContextActive
    || reversalConfirmed;

  if (!alignedWithHtf && plan.conflict && !plan.countertrendAllowed) {
    blockers.push(`Trade ${decision.decision} conflicts with HTF bias ${htfBias} — no confirmed reversal structure.`);
  } else if (!alignedWithHtf && !reversalConfirmed) {
    blockers.push(`Trade ${decision.decision} not aligned with HTF bias ${htfBias}.`);
  }

  const htfConflict = plan.sequence.some(
    (stage) => (GOLD_TOP_DOWN_HTF as readonly string[]).includes(String(stage.timeframe ?? '').toUpperCase())
      && stage.status === 'conflict',
  );
  if (htfConflict && !reversalConfirmed && !plan.rangingContextActive) {
    blockers.push('HTF structure conflict — D/H4 disagree; wait for alignment or confirmed CHoCH reversal.');
  }

  const intermediateReady = plan.sequence.some(
    (stage) => (GOLD_TOP_DOWN_INTERMEDIATE as readonly string[]).includes(String(stage.timeframe ?? '').toUpperCase())
      && (stage.status === 'aligned' || stage.status === 'confirmed'),
  );
  if (!intermediateReady && !plan.rangingContextActive) {
    blockers.push('Intermediate setup (H1/M30) not confirmed — waiting for institutional setup formation.');
  }

  const m15Ready = plan.sequence.find((stage) => String(stage.timeframe ?? '').toUpperCase() === 'M15');
  if (m15Ready && m15Ready.status === 'conflict' && !reversalConfirmed) {
    blockers.push('M15 execution trigger conflicts with intermediate structure.');
  }

  if (
    !sideMatchesBias(decision.decision, intermediateBias)
    && !sideMatchesBias(decision.decision, executionBias)
    && !plan.rangingContextActive
    && !reversalConfirmed
  ) {
    blockers.push(`Execution timeframes (M15/M5/M1) do not confirm ${decision.decision} side.`);
  }

  return {
    ok: blockers.length === 0,
    blockers,
    coverage,
    htfBias,
    alignedWithHtf,
    reversalConfirmed,
  };
}
