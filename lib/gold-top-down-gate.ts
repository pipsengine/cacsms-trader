import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import { detectGoldLtfScalpContext } from '@/lib/gold-ltf-scalp-mode';
import {
  directionalBiasText,
  isGoldMacroTrendFollowerEnabled,
  isGoldScalpCounterTrendAllowed,
  macroTrendBlocksDecision,
  macroTrendGateSummary,
  planStageBiasForTimeframes,
  sideAlignedWithMacroBias,
} from '@/lib/gold-macro-trend';
import { isNonDirectionalBias, isRangeOrientedContext } from '@/lib/gold-trade-context';
import { isGoldSymbol } from '@/lib/gold-trading-engine';
import {
  GOLD_TOP_DOWN_DIRECTIONAL_HTF,
  GOLD_TOP_DOWN_EXECUTION,
  GOLD_TOP_DOWN_INTERMEDIATE,
  GOLD_TOP_DOWN_MACRO,
  GOLD_TOP_DOWN_STRUCTURE_HTF,
  goldMandatoryCaptureTimeframes,
} from '@/lib/gold-top-down-timeframes';
import { normalizeInstitutionalTimeframe } from '@/lib/institutional-timeframe-normalize';
import { queryPostgres } from '@/lib/postgres';

export type GoldTopDownGateResult = {
  ok: boolean;
  blockers: string[];
  coverage: Record<string, boolean>;
  htfBias: string;
  macroBias: string;
  alignedWithHtf: boolean;
  reversalConfirmed: boolean;
  trendFollowerActive: boolean;
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
    const tf = normalizeInstitutionalTimeframe(String(row.timeframe ?? ''));
    coverage[tf] = true;
  }
  return coverage;
}

function planStageBias(
  plan: NonNullable<AutonomousDecisionOutput['institutionalPlan']>,
  timeframes: readonly string[],
): string {
  return planStageBiasForTimeframes(plan, timeframes);
}

function hasStrongReversalStructure(reason: string, setupType: string): boolean {
  return /choch|change of character|reversal|sweep.*reclaim|displacement/i.test(`${reason} ${setupType}`);
}

export async function evaluateGoldMandatoryTopDown(
  decision: Pick<
    AutonomousDecisionOutput,
    | 'symbol'
    | 'decision'
    | 'institutionalPlan'
    | 'reasonForDecision'
    | 'setupType'
    | 'finalBias'
    | 'strategyBookScore'
    | 'setupReadinessScore'
    | 'regimeClassification'
    | 'selectedStrategyId'
  >,
): Promise<GoldTopDownGateResult> {
  const trendFollowerActive = isGoldMacroTrendFollowerEnabled();

  if (!isGoldSymbol(decision.symbol)) {
    return {
      ok: true,
      blockers: [],
      coverage: {},
      htfBias: 'neutral',
      macroBias: 'neutral',
      alignedWithHtf: true,
      reversalConfirmed: false,
      trendFollowerActive,
    };
  }

  if (decision.decision !== 'BUY' && decision.decision !== 'SELL') {
    return {
      ok: true,
      blockers: [],
      coverage: {},
      htfBias: 'neutral',
      macroBias: 'neutral',
      alignedWithHtf: true,
      reversalConfirmed: false,
      trendFollowerActive,
    };
  }

  const blockers: string[] = [];
  const coverage = await loadCaptureCoverage(decision.symbol);
  const plan = decision.institutionalPlan;

  if (!plan) {
    blockers.push('Institutional top-down plan missing — trade blocked until MTF analysis completes.');
    return {
      ok: false,
      blockers,
      coverage,
      htfBias: 'unknown',
      macroBias: 'unknown',
      alignedWithHtf: false,
      reversalConfirmed: false,
      trendFollowerActive,
    };
  }

  const scalpContext = detectGoldLtfScalpContext({
    institutionalPlan: plan,
    regimeClassification: decision.regimeClassification ?? null,
  });

  const requiredTfs = goldMandatoryCaptureTimeframes(
    scalpContext.active,
    scalpContext.ltfEntryTimeframe,
  );
  const missing = requiredTfs.filter((tf) => !coverage[tf]);
  if (missing.length > 0) {
    blockers.push(`Mandatory Gold top-down incomplete — missing fresh captures: ${missing.join(', ')}.`);
  }

  const macroSummary = macroTrendGateSummary(plan);
  const macroBias = planStageBias(plan, GOLD_TOP_DOWN_MACRO);
  const structureBias = planStageBias(plan, GOLD_TOP_DOWN_STRUCTURE_HTF);
  const directionalBias = planStageBias(plan, GOLD_TOP_DOWN_DIRECTIONAL_HTF);
  const intermediateBias = planStageBias(plan, GOLD_TOP_DOWN_INTERMEDIATE);
  const executionBias = planStageBias(plan, GOLD_TOP_DOWN_EXECUTION);

  const reversalConfirmed = hasStrongReversalStructure(decision.reasonForDecision, decision.setupType)
    && (plan.countertrendAllowed || /choch|reversal/i.test(plan.conflictPolicy ?? ''));

  const rangingContext = Boolean(
    plan.rangingContextActive
    || isRangeOrientedContext(decision)
    || isNonDirectionalBias(directionalBias),
  );

  const alignedWithDirectional = sideMatchesBias(decision.decision, directionalBias);
  const alignedWithMacro = sideAlignedWithMacroBias(decision.decision, macroSummary.macroBias);

  const strongStrategyBook = Number(decision.strategyBookScore ?? 0) >= 85;
  const highReadiness = Number(decision.setupReadinessScore ?? 0) >= 90;

  const institutionalDeskOverride = (strongStrategyBook || highReadiness)
    && (
      sideMatchesBias(decision.decision, plan.htfBias)
      || sideMatchesBias(decision.decision, directionalBias)
      || sideMatchesBias(decision.decision, decision.finalBias)
    );

  const trendContinuationOverride = trendFollowerActive
    && macroSummary.macroBias !== 'neutral'
    && alignedWithMacro
    && alignedWithDirectional
    && (strongStrategyBook || highReadiness);

  const scalpOverrideAllowed = isGoldScalpCounterTrendAllowed() && scalpContext.active;
  const ltfConflictOverride = trendFollowerActive
    ? (rangingContext && scalpOverrideAllowed) || trendContinuationOverride || institutionalDeskOverride
    : rangingContext || scalpContext.active || strongStrategyBook || highReadiness || institutionalDeskOverride;

  if (trendFollowerActive && macroSummary.macroBias !== 'neutral' && !alignedWithMacro && !reversalConfirmed) {
    blockers.push(
      `Macro trend follower: ${decision.decision} conflicts with MN/W ${macroSummary.macroBias} bias — trend is your friend.`,
    );
  }

  if (trendFollowerActive && macroSummary.macroBias !== 'neutral' && !sideMatchesBias(decision.decision, structureBias) && !reversalConfirmed && !rangingContext) {
    blockers.push(`D/H4 structure (${structureBias}) does not support ${decision.decision} under macro ${macroSummary.macroBias} control.`);
  }

  if (!trendFollowerActive) {
    if (!alignedWithDirectional && plan.conflict && !plan.countertrendAllowed) {
      blockers.push(`Trade ${decision.decision} conflicts with HTF bias ${directionalBias} — no confirmed reversal structure.`);
    } else if (!alignedWithDirectional && !reversalConfirmed) {
      blockers.push(`Trade ${decision.decision} not aligned with HTF bias ${directionalBias}.`);
    }
  } else if (!alignedWithDirectional && !reversalConfirmed && !ltfConflictOverride) {
    blockers.push(`Trade ${decision.decision} not aligned with MN/W/D/H4 directional bias ${directionalBias}.`);
  }

  const macroStages = plan.sequence.filter((stage) =>
    (GOLD_TOP_DOWN_MACRO as readonly string[]).includes(String(stage.timeframe ?? '').toUpperCase()),
  );
  const mnBias = directionalBiasText(macroStages.find((stage) => String(stage.timeframe ?? '').toUpperCase() === 'MN')?.bias ?? '');
  const wBias = directionalBiasText(macroStages.find((stage) => String(stage.timeframe ?? '').toUpperCase() === 'W')?.bias ?? '');
  const mnWDisagree = mnBias !== 'neutral' && wBias !== 'neutral' && mnBias !== wBias;
  if (trendFollowerActive && mnWDisagree && !reversalConfirmed) {
    blockers.push(`MN/W macro conflict — monthly (${mnBias}) and weekly (${wBias}) disagree; wait for alignment.`);
  }

  const structureConflict = plan.sequence.some(
    (stage) => (GOLD_TOP_DOWN_STRUCTURE_HTF as readonly string[]).includes(String(stage.timeframe ?? '').toUpperCase())
      && stage.status === 'conflict',
  );
  if (structureConflict && !reversalConfirmed && !rangingContext && !scalpOverrideAllowed && !ltfConflictOverride) {
    blockers.push('D/H4 structure conflict — wait for alignment or confirmed CHoCH reversal on W+D.');
  }

  const intermediateReady = plan.sequence.some(
    (stage) => (GOLD_TOP_DOWN_INTERMEDIATE as readonly string[]).includes(String(stage.timeframe ?? '').toUpperCase())
      && (stage.status === 'aligned' || stage.status === 'confirmed'),
  );
  if (!intermediateReady && !rangingContext && !scalpOverrideAllowed && !ltfConflictOverride) {
    blockers.push('Intermediate setup (H1/M30) not confirmed — waiting for institutional setup formation.');
  }

  const m15Ready = plan.sequence.find((stage) => String(stage.timeframe ?? '').toUpperCase() === 'M15');
  const m5Ready = plan.sequence.find((stage) => String(stage.timeframe ?? '').toUpperCase() === 'M5');
  if (scalpOverrideAllowed) {
    const ltfReady = [m15Ready, m5Ready].some((stage) => stage && (stage.status === 'aligned' || stage.status === 'confirmed' || sideMatchesBias(decision.decision, stage.bias)));
    if (!ltfReady && !reversalConfirmed) {
      blockers.push('LTF scalp mode active but neither M15 nor M5 confirms the execution side.');
    }
  } else if (m15Ready && m15Ready.status === 'conflict' && !reversalConfirmed && !ltfConflictOverride) {
    blockers.push('M15 execution trigger conflicts with intermediate structure.');
  }

  if (
    !sideMatchesBias(decision.decision, intermediateBias)
    && !sideMatchesBias(decision.decision, executionBias)
    && !rangingContext
    && !scalpOverrideAllowed
    && !reversalConfirmed
    && !ltfConflictOverride
  ) {
    blockers.push(`Execution timeframes (M15/M5/M1) do not confirm ${decision.decision} side.`);
  }

  const macroBlock = macroTrendBlocksDecision({
    symbol: decision.symbol,
    decision: decision.decision,
    institutionalPlan: plan,
    reversalConfirmed,
    rangingContext,
    scalpActive: scalpContext.active,
  });
  if (macroBlock) blockers.push(macroBlock);

  return {
    ok: blockers.length === 0,
    blockers,
    coverage,
    htfBias: directionalBias,
    macroBias: macroSummary.macroBias,
    alignedWithHtf: alignedWithDirectional || alignedWithMacro,
    reversalConfirmed,
    trendFollowerActive,
  };
}
