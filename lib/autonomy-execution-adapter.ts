import { randomUUID } from 'node:crypto';
import { getAutonomyThresholdProfile } from '@/lib/autonomy-account-profiles';
import {
  hasValidStopTargets,
  isStopLossRequired,
  resolveAutonomousStopTargets,
  type AutonomousStopTargetResult,
  type AutonomousTradeSide,
} from '@/lib/autonomous-stop-targets';
import { resolveAutonomousVolumeLots } from '@/lib/autonomy-lot-sizing';
import type { AutonomousDecisionOutput, AutonomyConfig, AutonomyMode } from '@/lib/autonomy-types';
import { dispatchExecutionCommand, ExecutionPolicyBlockedError, ExecutionRiskBlockedError } from '@/lib/execution-dispatch';
import { liveExecutionBlockReason, resolveExecutionAccountContext } from '@/lib/execution-account-context';
import { isContinuousTradingEnabled } from '@/lib/execution-risk-limits';
import { shouldBypassNewsBlackout } from '@/lib/trading-session-policy';
import { getExecutionKillSwitchStatus } from '@/lib/execution-kill-switch';
import { getExecutionPolicyStatus, isExecutionEnabled } from '@/lib/execution-policy';
import { listTerminalSnapshots } from '@/lib/mt5-heartbeat-store';
import { getLatestPairSelection } from '@/lib/pair-selector';
import { queryPostgres } from '@/lib/postgres';
import { evaluateAutonomySafetyLock } from '@/lib/autonomy-safety-lock';
import { evaluateGoldExecutionQuality, resolveGoldLivePrice } from '@/lib/gold-execution-quality';
import { evaluateGoldInstitutionalQuality } from '@/lib/gold-institutional-quality';
import { evaluateGoldPositionScaling } from '@/lib/gold-position-scaling';
import { evaluateGoldExecutionRewardRisk } from '@/lib/gold-trade-context';
import { buildBatchLegVolumes, goldLegLotsPerPosition, totalBatchExposureLots } from '@/lib/gold-batch-entry';
import { isGoldSymbol, goldBatchEntryEnabled, goldEntryLegCount } from '@/lib/gold-trading-engine';
import { evaluateStrategyGovernance, resolveStrategyIdFromDecision } from '@/lib/strategy-governance';
import { logAutonomyDirectionAudit } from '@/lib/autonomy-direction-monitor';
import { isRetracementEntryEnabled, planAutonomousRetracementEntry } from '@/lib/autonomous-entry-planner';

export type AutonomyExecutionChecklist = {
  ready: boolean;
  blockers: string[];
  mode: AutonomyMode;
  terminalId: string | null;
  sandboxOnly: boolean;
  accountClass: string;
  environment: string;
};

export type AutonomyExecutionDispatchResult = {
  ok: boolean;
  status: 'blocked' | 'dispatched' | 'failed' | 'already_dispatched';
  decisionLogId: string;
  commandId?: string;
  terminalId?: string;
  blockers: string[];
  error?: string;
};

function isAutonomyExecutionEnabled(): boolean {
  return envBool('CACSMS_ENABLE_AUTONOMY_EXECUTION', false) || isContinuousTradingEnabled();
}

function envBool(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function executionModeAllowsAutoDispatch(mode: AutonomyMode): boolean {
  return mode === 'full_auto';
}

function executionModeAllowsManualDispatch(mode: AutonomyMode): boolean {
  return mode === 'full_auto' || mode === 'assisted_trade';
}

export async function resolveConnectedTerminalId(): Promise<string | null> {
  const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
  try {
    const response = await fetch(`${bridgeUrl}/terminal-operations`, { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      const terminals = Array.isArray(payload.terminals) ? payload.terminals : [];
      const connected = terminals.filter((terminal: { connectionStatus?: string }) => terminal.connectionStatus === 'connected');
      const withExecution = connected.find((terminal: { enableExecution?: boolean }) => terminal.enableExecution);
      const chosen = withExecution ?? connected[0];
      if (chosen?.terminalId) return String(chosen.terminalId);
    }
  } catch {
    // fall through to postgres snapshots
  }

  const terminals = await listTerminalSnapshots();
  const connected = terminals.filter((terminal) => terminal.status === 'connected');
  return connected[0]?.terminalId ?? null;
}

export async function evaluateAutonomyExecutionChecklist(input: {
  decision: Pick<
    AutonomousDecisionOutput,
    | 'symbol'
    | 'decision'
    | 'confidenceScore'
    | 'setupReadinessScore'
    | 'riskScore'
    | 'stopLoss'
    | 'takeProfitLevels'
    | 'macroRiskWarning'
    | 'liquidityWarning'
    | 'tradingStyle'
    | 'timeframe'
    | 'setupType'
    | 'selectedStrategyId'
    | 'strategyBookScore'
    | 'institutionalPlan'
    | 'capitalAllocation'
    | 'signalScore'
    | 'finalBias'
    | 'reasonForDecision'
    | 'regimeClassification'
  >;
  config: Pick<AutonomyConfig, 'tradeExecutionMode' | 'confidenceThreshold' | 'riskThreshold'>;
  manual?: boolean;
}): Promise<AutonomyExecutionChecklist> {
  const blockers: string[] = [];
  const mode = input.config.tradeExecutionMode;
  const manual = Boolean(input.manual);

  if (!isExecutionEnabled()) {
    blockers.push('CACSMS_ENABLE_EXECUTION is false.');
  }

  if (!isAutonomyExecutionEnabled() && !manual) {
    blockers.push('Autonomous execution is disabled. Set CACSMS_ENABLE_AUTONOMY_EXECUTION=true or enable continuous trading.');
  }

  if (manual && !executionModeAllowsManualDispatch(mode)) {
    blockers.push(`tradeExecutionMode=${mode} does not allow manual execution dispatch.`);
  }

  if (!manual && !executionModeAllowsAutoDispatch(mode)) {
    blockers.push(`tradeExecutionMode=${mode} does not allow automatic execution dispatch.`);
  }

  if (!['BUY', 'SELL'].includes(input.decision.decision)) {
    blockers.push(`Decision ${input.decision.decision} is not executable.`);
  }

  if (!manual && ['BUY', 'SELL'].includes(input.decision.decision)) {
    const strategyId = resolveStrategyIdFromDecision(input.decision);
    const governance = await evaluateStrategyGovernance({
      strategyId,
      tradingStyle: input.decision.tradingStyle ?? null,
      decision: input.decision.decision,
      symbol: input.decision.symbol,
      timeframe: input.decision.timeframe,
    });
    blockers.push(...governance.blockers);

    const latestSelection = await getLatestPairSelection().catch(() => null);
    const candidate = latestSelection?.candidates.find(
      (item) => item.symbol.toUpperCase() === input.decision.symbol.toUpperCase(),
    );
    const continuousMode = isContinuousTradingEnabled();
    if (candidate && (!candidate.tradable || candidate.blocked || (!continuousMode && !candidate.eligibleForNewEntry))) {
      const reason = candidate.blockReason || candidate.reasons.join('; ') || 'latest pair selection marked the symbol as not tradable';
      blockers.push(`${input.decision.symbol} is not eligible for autonomous execution: ${reason}.`);
    }
  }

  const account = await resolveExecutionAccountContext();
  const { shouldRelaxContinuousTradingLimits } = await import('@/lib/autonomy-pipeline-throttle');
  const { getContinuousRefillDecisionThresholds } = await import('@/lib/autonomy-account-profiles');
  const relaxed = await shouldRelaxContinuousTradingLimits().catch(() => false);
  const refillThresholds = getContinuousRefillDecisionThresholds(account?.accountClass ?? 'demo');
  const confidenceThreshold = relaxed
    ? Math.min(input.config.confidenceThreshold, refillThresholds.confidence)
    : input.config.confidenceThreshold;
  const readinessThreshold = relaxed
    ? Math.min(getAutonomyThresholdProfile(account?.accountClass ?? 'demo').decisionReadinessThreshold, refillThresholds.readiness)
    : getAutonomyThresholdProfile(account?.accountClass ?? 'demo').decisionReadinessThreshold;

  if (input.decision.confidenceScore < confidenceThreshold) {
    blockers.push(`Confidence ${input.decision.confidenceScore}% is below threshold ${confidenceThreshold}%.`);
  }

  if (input.decision.setupReadinessScore < readinessThreshold) {
    blockers.push(`Setup readiness ${input.decision.setupReadinessScore}% is below minimum ${readinessThreshold}%.`);
  }

  if (input.decision.riskScore > input.config.riskThreshold) {
    blockers.push(`Risk score ${input.decision.riskScore}% exceeds threshold ${input.config.riskThreshold}%.`);
  }

  const killSwitch = await getExecutionKillSwitchStatus();
  if (killSwitch.active) {
    blockers.push(killSwitch.reason ?? 'Execution kill switch is active.');
  }

  const policy = await getExecutionPolicyStatus();
  if (policy.killSwitchActive) {
    blockers.push('Execution policy kill switch is active.');
  }

  const emergency = await queryPostgres(
    `SELECT emergency_stopped FROM autonomous_system_health WHERE health_key = 'autonomy' LIMIT 1`,
  ).catch(() => ({ rows: [] as Array<{ emergency_stopped?: boolean }> }));
  if (Boolean(emergency.rows[0]?.emergency_stopped)) {
    blockers.push('Autonomy emergency stop is active.');
  }

  const terminalId = account?.terminalId ?? await resolveConnectedTerminalId();
  if (!terminalId) {
    blockers.push('No connected MT5 terminal is available.');
  }
  if (account) {
    const liveBlock = liveExecutionBlockReason(account);
    if (liveBlock) blockers.push(liveBlock);
  }

  if (!manual && ['BUY', 'SELL'].includes(input.decision.decision)) {
    const safety = await evaluateAutonomySafetyLock({
      symbol: input.decision.symbol,
      terminalId,
      accountNumber: account?.accountNumber ?? null,
      autoActivateKillSwitch: true,
    });
    blockers.push(...safety.blockers);

    if (isGoldSymbol(input.decision.symbol)) {
      const goldQuality = await evaluateGoldExecutionQuality(input.decision.symbol);
      blockers.push(...goldQuality.blockers);
      const institutional = evaluateGoldInstitutionalQuality(input.decision);
      blockers.push(...institutional.blockers);
      const goldStack = await evaluateGoldPositionScaling({
        decision: input.decision,
        terminalId,
      });
      blockers.push(...goldStack.blockers);
    }
  }

  if (!shouldBypassNewsBlackout()) {
    const highImpact = await queryPostgres(
      `
        SELECT COUNT(*)::int AS count
        FROM economic_events
        WHERE impact = 'High'
          AND event_time BETWEEN now() - interval '30 minutes' AND now() + interval '30 minutes'
      `,
    ).catch(() => ({ rows: [{ count: 0 }] }));
    if (Number(highImpact.rows[0]?.count ?? 0) > 0) {
      blockers.push('High-impact economic event blackout window is active.');
    }

    if (input.decision.macroRiskWarning && /blackout|blocked|avoid/i.test(input.decision.macroRiskWarning)) {
      blockers.push(input.decision.macroRiskWarning);
    }
  }

  if (isStopLossRequired() && ['BUY', 'SELL'].includes(input.decision.decision)) {
    const takeProfit = input.decision.takeProfitLevels?.[0] ?? null;
    const valid = hasValidStopTargets({
      side: input.decision.decision,
      stopLoss: input.decision.stopLoss,
      takeProfit,
    });
    if (!valid) {
      blockers.push('Stop loss and take profit must be resolved before execution dispatch.');
    } else if (isGoldSymbol(input.decision.symbol)) {
      const livePrice = await resolveGoldLivePrice(input.decision.symbol);
      const rewardRisk = await evaluateGoldExecutionRewardRisk(input.decision, livePrice);
      blockers.push(...rewardRisk.blockers);
    }
  }

  const uniqueBlockers = dedupeMessages(blockers);
  return {
    ready: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    mode,
    terminalId,
    sandboxOnly: account?.sandboxMode ?? true,
    accountClass: account?.accountClass ?? 'demo',
    environment: account?.environment ?? 'DEMO',
  };
}

async function persistDispatchRecord(input: {
  decisionLogId: string;
  commandId?: string | null;
  terminalId?: string | null;
  symbol: string;
  side: string;
  status: 'blocked' | 'queued' | 'dispatched' | 'failed';
  blockers: string[];
  payload?: Record<string, unknown>;
}): Promise<void> {
  await queryPostgres(
    `
      INSERT INTO autonomy_execution_dispatches (
        id,
        decision_log_id,
        command_id,
        terminal_id,
        symbol,
        side,
        status,
        blockers_json,
        payload_json,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,now())
      ON CONFLICT (decision_log_id) DO UPDATE SET
        command_id = COALESCE(EXCLUDED.command_id, autonomy_execution_dispatches.command_id),
        terminal_id = COALESCE(EXCLUDED.terminal_id, autonomy_execution_dispatches.terminal_id),
        status = EXCLUDED.status,
        blockers_json = EXCLUDED.blockers_json,
        payload_json = EXCLUDED.payload_json,
        updated_at = now()
    `,
    [
      randomUUID(),
      input.decisionLogId,
      input.commandId ?? null,
      input.terminalId ?? null,
      input.symbol,
      input.side,
      input.status,
      JSON.stringify(dedupeMessages(input.blockers)),
      JSON.stringify(input.payload ?? {}),
    ],
  ).catch(() => null);
}

function dedupeMessages(messages: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const message of messages) {
    const normalized = String(message ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function splitHybridLots(totalLots: number, marketFraction: number): { marketLots: number; limitLots: number } {
  const total = normalizeLots(totalLots);
  if (total < 0.02 || marketFraction <= 0) return { marketLots: 0, limitLots: total };
  const marketLots = normalizeLots(total * Math.min(0.5, Math.max(0, marketFraction)));
  if (marketLots < 0.01 || total - marketLots < 0.01) return { marketLots: 0, limitLots: total };
  return {
    marketLots,
    limitLots: normalizeLots(total - marketLots),
  };
}

function normalizeLots(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(Math.max(0, Math.floor(value * 100 + 1e-9) / 100).toFixed(2));
}

function buildExecutionPayload(input: {
  sourceDecision: { decisionLogId: string };
  executableDecision: AutonomousDecisionOutput;
  account: {
    environment: string;
    accountClass: string;
    accountNumber: string | null;
    equity: number;
  };
  side: 'BUY' | 'SELL';
  executionMode: string;
  volumeLots: number;
  stopLoss: number;
  takeProfit: number;
  entryPrice: number;
  rewardRiskRatio: number;
  stopTargetMethod: string;
  sized: { method: string; riskAmount: number; stopPips: number };
  strategyId: string;
  orderType: string;
  comment: string;
  leg: string;
  entryPlan?: Record<string, unknown> | null;
  setupGroupId?: string;
  legIndex?: number;
  legCount?: number;
  batchEntry?: boolean;
  rewardRiskPlan?: Record<string, unknown> | null;
  takeProfitLevels?: number[];
  targetRewardRiskRatio?: number;
  extendedRewardRiskRatio?: number;
}) {
  return {
    source: 'AUTONOMY_EXECUTION_ADAPTER',
    decisionLogId: input.sourceDecision.decisionLogId,
    intentId: input.sourceDecision.decisionLogId,
    setupGroupId: input.setupGroupId ?? input.sourceDecision.decisionLogId,
    legIndex: input.legIndex ?? 1,
    legCount: input.legCount ?? 1,
    batchEntry: Boolean(input.batchEntry),
    symbol: input.executableDecision.symbol,
    side: input.side,
    orderType: input.orderType,
    orderKind: input.orderType,
    volume: input.volumeLots,
    volumeLots: input.volumeLots,
    sl: input.stopLoss,
    tp: input.takeProfit,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    takeProfitLevels: input.takeProfitLevels ?? [input.takeProfit],
    price: input.entryPrice,
    entryPrice: input.entryPrice,
    pendingEntryPrice: input.orderType.includes('LIMIT') ? input.entryPrice : null,
    rewardRiskRatio: input.rewardRiskRatio,
    targetRewardRiskRatio: input.targetRewardRiskRatio ?? input.rewardRiskRatio,
    extendedRewardRiskRatio: input.extendedRewardRiskRatio ?? input.rewardRiskRatio,
    rewardRiskPlan: input.rewardRiskPlan ?? null,
    stopTargetMethod: input.stopTargetMethod,
    comment: input.comment,
    mode: input.executionMode,
    environment: input.account.environment,
    accountClass: input.account.accountClass,
    accountNumber: input.account.accountNumber,
    equity: input.account.equity,
    sizingMethod: input.sized.method,
    riskAmount: input.sized.riskAmount,
    stopPips: input.sized.stopPips,
    timeframe: input.executableDecision.timeframe,
    tradingStyle: input.executableDecision.tradingStyle ?? null,
    setupType: input.executableDecision.setupType,
    strategyId: input.strategyId,
    confidenceScore: input.executableDecision.confidenceScore,
    setupReadinessScore: input.executableDecision.setupReadinessScore,
    entryModel: input.orderType.includes('LIMIT') ? 'retracement_limit' : 'market',
    entryLeg: input.leg,
    continuationConfirmationRequired: input.entryPlan?.confirmationRequired ?? [],
    requiresContinuationConfirmation: input.orderType.includes('LIMIT'),
    cancelIfPriceBeyond: input.entryPlan?.cancelIfPriceBeyond ?? null,
    maxRetracementPrice: input.entryPlan?.maxRetracementPrice ?? null,
    retracementZone: input.entryPlan
      ? { low: input.entryPlan.zoneLow ?? null, high: input.entryPlan.zoneHigh ?? null }
      : null,
    entryPlan: input.entryPlan ?? null,
  };
}

async function hasExistingDispatch(decisionLogId: string): Promise<boolean> {
  const result = await queryPostgres(
    `
      SELECT status
      FROM autonomy_execution_dispatches
      WHERE decision_log_id = $1
        AND status IN ('queued', 'dispatched')
      LIMIT 1
    `,
    [decisionLogId],
  ).catch(() => ({ rows: [] as Array<{ status?: string }> }));
  return result.rows.length > 0;
}

export async function resolveExecutableAutonomyDecision(
  decision: AutonomousDecisionOutput,
): Promise<{ decision: AutonomousDecisionOutput; stopTargets: AutonomousStopTargetResult | null }> {
  if (!['BUY', 'SELL'].includes(decision.decision)) {
    return { decision, stopTargets: null };
  }
  const side = decision.decision as AutonomousTradeSide;
  const stopTargets = await resolveAutonomousStopTargets({
    symbol: decision.symbol,
    timeframe: decision.timeframe,
    side,
    tradingStyle: decision.tradingStyle,
    decision,
  });
  if (!stopTargets) {
    const storedStop = Number(decision.stopLoss ?? 0);
    const storedTp = Number(decision.takeProfitLevels?.[0] ?? 0);
    if (hasValidStopTargets({ side, stopLoss: storedStop, takeProfit: storedTp })) {
      return {
        decision,
        stopTargets: {
          entryPrice: 0,
          stopLoss: storedStop,
          takeProfit: storedTp,
          takeProfitLevels: decision.takeProfitLevels ?? [storedTp],
          invalidationLevel: Number(decision.invalidationLevel ?? storedStop),
          stopPips: 0,
          rewardRiskRatio: 0,
          method: 'pip_default',
        },
      };
    }
    return { decision, stopTargets: null };
  }
  return {
    decision: {
      ...decision,
      stopLoss: stopTargets.stopLoss,
      takeProfitLevels: stopTargets.takeProfitLevels,
      invalidationLevel: stopTargets.invalidationLevel,
    },
    stopTargets,
  };
}

export async function dispatchAutonomyDecision(input: {
  decisionLogId: string;
  decision: AutonomousDecisionOutput;
  config: AutonomyConfig;
  manual?: boolean;
  volumeLots?: number;
}): Promise<AutonomyExecutionDispatchResult> {
  if (await hasExistingDispatch(input.decisionLogId)) {
    return {
      ok: false,
      status: 'already_dispatched',
      decisionLogId: input.decisionLogId,
      blockers: ['Decision was already dispatched to execution.'],
    };
  }

  let { decision: executableDecision, stopTargets } = await resolveExecutableAutonomyDecision(input.decision);
  if (!stopTargets && ['BUY', 'SELL'].includes(input.decision.decision)) {
    stopTargets = await resolveAutonomousStopTargets({
      symbol: input.decision.symbol,
      timeframe: input.decision.timeframe,
      side: input.decision.decision as AutonomousTradeSide,
      tradingStyle: input.decision.tradingStyle,
      decision: input.decision,
    });
    if (stopTargets) {
      executableDecision = {
        ...executableDecision,
        stopLoss: stopTargets.stopLoss,
        takeProfitLevels: stopTargets.takeProfitLevels,
        invalidationLevel: stopTargets.invalidationLevel,
      };
    }
  }
  const strategyId = resolveStrategyIdFromDecision(executableDecision);
  const strategyMetadata = {
    strategyId,
    tradingStyle: executableDecision.tradingStyle ?? null,
    timeframe: executableDecision.timeframe,
    setupType: executableDecision.setupType,
  };
  const checklist = await evaluateAutonomyExecutionChecklist({
    decision: executableDecision,
    config: input.config,
    manual: input.manual,
  });

  if (!checklist.ready || !checklist.terminalId) {
    await persistDispatchRecord({
      decisionLogId: input.decisionLogId,
      terminalId: checklist.terminalId,
      symbol: input.decision.symbol,
      side: input.decision.decision,
      status: 'blocked',
      blockers: checklist.blockers,
      payload: { manual: Boolean(input.manual), mode: checklist.mode, strategy: strategyMetadata },
    });
    await logAutonomyDirectionAudit({
      decisionLogId: input.decisionLogId,
      symbol: executableDecision.symbol,
      timeframe: executableDecision.timeframe,
      stage: 'execution_blocked',
      baseDecision: executableDecision.decision,
      finalDecision: executableDecision.decision,
      finalBias: executableDecision.finalBias,
      side: executableDecision.decision,
      accepted: false,
      reasons: checklist.blockers,
      metrics: {
        mode: checklist.mode,
        terminalId: checklist.terminalId,
        strategy: strategyMetadata,
        confidenceScore: executableDecision.confidenceScore,
        setupReadinessScore: executableDecision.setupReadinessScore,
        riskScore: executableDecision.riskScore,
      },
    });
    return {
      ok: false,
      status: 'blocked',
      decisionLogId: input.decisionLogId,
      blockers: checklist.blockers,
    };
  }

  if (!stopTargets) {
    const blockers = ['Unable to resolve structural stop loss and take profit for this signal.'];
    await persistDispatchRecord({
      decisionLogId: input.decisionLogId,
      terminalId: checklist.terminalId,
      symbol: executableDecision.symbol,
      side: executableDecision.decision,
      status: 'blocked',
      blockers,
      payload: { manual: Boolean(input.manual), mode: checklist.mode, strategy: strategyMetadata },
    });
    await logAutonomyDirectionAudit({
      decisionLogId: input.decisionLogId,
      symbol: executableDecision.symbol,
      timeframe: executableDecision.timeframe,
      stage: 'execution_blocked',
      baseDecision: executableDecision.decision,
      finalDecision: executableDecision.decision,
      finalBias: executableDecision.finalBias,
      side: executableDecision.decision,
      accepted: false,
      reasons: blockers,
      metrics: { mode: checklist.mode, strategy: strategyMetadata, blockerType: 'missing_stop_targets' },
    });
    return {
      ok: false,
      status: 'blocked',
      decisionLogId: input.decisionLogId,
      blockers,
    };
  }

  const side = executableDecision.decision === 'SELL' ? 'SELL' : 'BUY';
  const account = await resolveExecutionAccountContext(checklist.terminalId);
  if (!account) {
    return {
      ok: false,
      status: 'blocked',
      decisionLogId: input.decisionLogId,
      blockers: ['Unable to resolve execution account context for the connected terminal.'],
    };
  }

  const sized = input.volumeLots != null
    ? { lots: Number(input.volumeLots), riskAmount: 0, stopPips: stopTargets.stopPips, method: 'fixed' as const }
    : resolveAutonomousVolumeLots({
      decision: executableDecision,
      account,
      entryPrice: stopTargets.entryPrice,
      tradingStyle: executableDecision.tradingStyle,
    });
  const volumeLots = sized.lots;
  const stopLoss = stopTargets.stopLoss;
  const takeProfit = stopTargets.takeProfit;
  const entryPlan = await planAutonomousRetracementEntry({
    symbol: executableDecision.symbol,
    timeframe: executableDecision.timeframe,
    side,
    currentPrice: stopTargets.entryPrice,
    stopLoss,
    rewardRiskRatio: stopTargets.extendedRewardRiskRatio ?? stopTargets.rewardRiskRatio,
  }).catch(() => null);
  const useBatchEntry = isGoldSymbol(executableDecision.symbol) && goldBatchEntryEnabled() && !input.manual;
  const useRetracementEntry = !useBatchEntry && Boolean(entryPlan && isRetracementEntryEnabled());
  const split = splitHybridLots(volumeLots, entryPlan?.marketFraction ?? 0);
  const setupGroupId = input.decisionLogId;
  const batchLegCount = useBatchEntry ? goldEntryLegCount() : 1;
  const batchLegLots = useBatchEntry ? buildBatchLegVolumes(volumeLots, batchLegCount) : [volumeLots];
  const batchTotalLots = useBatchEntry ? totalBatchExposureLots(batchLegLots) : volumeLots;
  const commandId = `autonomy-${input.decisionLogId.slice(0, 8)}-${randomUUID()}`;
  const pendingCommandId = useRetracementEntry ? `autonomy-${input.decisionLogId.slice(0, 8)}-limit-${randomUUID()}` : commandId;
  const executionMode = account.sandboxMode ? 'SANDBOX' : 'LIVE';
  const rewardRiskExtras = {
    takeProfitLevels: stopTargets.takeProfitLevels,
    targetRewardRiskRatio: stopTargets.targetRewardRiskRatio ?? stopTargets.rewardRiskRatio,
    extendedRewardRiskRatio: stopTargets.extendedRewardRiskRatio ?? stopTargets.rewardRiskRatio,
    rewardRiskPlan: stopTargets.rewardRiskPlan ?? null,
  };

  try {
    const dispatchedCommands: Array<{ commandId: string; orderType: string; volumeLots: number }> = [];
    if (useRetracementEntry && entryPlan && split.marketLots > 0) {
      const marketResult = await dispatchExecutionCommand({
        commandId,
        terminalId: checklist.terminalId,
        type: 'place_order',
        payload: buildExecutionPayload({
          sourceDecision: input,
          executableDecision,
          account,
          side,
          executionMode,
          volumeLots: split.marketLots,
          stopLoss,
          takeProfit,
          entryPrice: stopTargets.entryPrice,
          rewardRiskRatio: stopTargets.rewardRiskRatio,
          stopTargetMethod: stopTargets.method,
          sized,
          strategyId,
          orderType: 'MARKET',
          comment: `Cacsms autonomy ${side} market scout ${executableDecision.symbol}`,
          entryPlan,
          leg: 'market_scout',
          ...rewardRiskExtras,
        }),
        environment: account.environment,
        sandboxMode: account.sandboxMode,
        dedupeKey: `AUTONOMY:${input.decisionLogId}:${input.decision.symbol}:${side}:MARKET:${split.marketLots}`,
        intentId: `${input.decisionLogId}:market`,
        source: 'AUTONOMY_EXECUTION_ADAPTER',
      });
      dispatchedCommands.push({ commandId: marketResult.command.commandId, orderType: 'MARKET', volumeLots: split.marketLots });
    }

    let result: Awaited<ReturnType<typeof dispatchExecutionCommand>> | null = null;
    let finalStopLoss = stopLoss;
    let finalTakeProfit = takeProfit;
    let finalEntryPrice = stopTargets.entryPrice;

    if (useBatchEntry) {
      for (let index = 0; index < batchLegLots.length; index += 1) {
        const legLots = batchLegLots[index];
        const legCommandId = `${commandId}-leg-${index + 1}-${randomUUID().slice(0, 8)}`;
        const legResult = await dispatchExecutionCommand({
          commandId: legCommandId,
          terminalId: checklist.terminalId,
          type: 'place_order',
          payload: buildExecutionPayload({
            sourceDecision: input,
            executableDecision,
            account,
            side,
            executionMode,
            volumeLots: legLots,
            stopLoss,
            takeProfit,
            entryPrice: stopTargets.entryPrice,
            rewardRiskRatio: stopTargets.rewardRiskRatio,
            stopTargetMethod: stopTargets.method,
            sized,
            strategyId,
            orderType: 'MARKET',
            comment: `Cacsms autonomy ${side} batch leg ${index + 1}/${batchLegLots.length} ${executableDecision.symbol}`,
            leg: `batch_leg_${index + 1}`,
            setupGroupId,
            legIndex: index + 1,
            legCount: batchLegCount,
            batchEntry: true,
            ...rewardRiskExtras,
          }),
          environment: account.environment,
          sandboxMode: account.sandboxMode,
          dedupeKey: `AUTONOMY:${input.decisionLogId}:${input.decision.symbol}:${side}:BATCH:${index + 1}:${legLots}`,
          intentId: `${input.decisionLogId}:leg:${index + 1}`,
          source: 'AUTONOMY_EXECUTION_ADAPTER',
        });
        result = legResult;
        dispatchedCommands.push({ commandId: legResult.command.commandId, orderType: 'MARKET', volumeLots: legLots });
      }
      if (!result) {
        throw new Error('Batch entry dispatch produced no commands.');
      }
    } else {
      const finalOrderType = useRetracementEntry ? (side === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT') : 'MARKET';
      const finalVolumeLots = useRetracementEntry ? split.limitLots : volumeLots;
      finalEntryPrice = useRetracementEntry && entryPlan ? entryPlan.pendingEntryPrice : stopTargets.entryPrice;
      finalStopLoss = useRetracementEntry && entryPlan ? entryPlan.stopLoss : stopLoss;
      finalTakeProfit = useRetracementEntry && entryPlan ? entryPlan.takeProfit : takeProfit;
      result = await dispatchExecutionCommand({
        commandId: pendingCommandId,
        terminalId: checklist.terminalId,
        type: 'place_order',
        payload: buildExecutionPayload({
          sourceDecision: input,
          executableDecision,
          account,
          side,
          executionMode,
          volumeLots: finalVolumeLots,
          stopLoss: finalStopLoss,
          takeProfit: finalTakeProfit,
          entryPrice: finalEntryPrice,
          rewardRiskRatio: stopTargets.rewardRiskRatio,
          stopTargetMethod: useRetracementEntry ? 'retracement_entry' : stopTargets.method,
          sized,
          strategyId,
          orderType: finalOrderType,
          comment: useRetracementEntry
            ? `Cacsms autonomy ${side} retracement ${executableDecision.symbol}`
            : `Cacsms autonomy ${side} ${executableDecision.symbol}`,
          entryPlan: entryPlan ?? undefined,
          leg: useRetracementEntry ? 'retracement_limit' : 'market_full',
          setupGroupId,
          legIndex: 1,
          legCount: 1,
          batchEntry: false,
          ...rewardRiskExtras,
        }),
        environment: account.environment,
        sandboxMode: account.sandboxMode,
        dedupeKey: `AUTONOMY:${input.decisionLogId}:${input.decision.symbol}:${side}:${finalOrderType}:${finalVolumeLots}:${finalEntryPrice}`,
        intentId: useRetracementEntry ? `${input.decisionLogId}:limit` : input.decisionLogId,
        source: 'AUTONOMY_EXECUTION_ADAPTER',
      });
      dispatchedCommands.push({ commandId: result.command.commandId, orderType: finalOrderType, volumeLots: finalVolumeLots });
    }

    await persistDispatchRecord({
      decisionLogId: input.decisionLogId,
      commandId: result.command.commandId,
      terminalId: checklist.terminalId,
      symbol: executableDecision.symbol,
      side,
      status: 'dispatched',
      blockers: [],
      payload: {
        manual: Boolean(input.manual),
        lifecycleState: result.command.lifecycleState,
        deduped: result.deduped ?? false,
        accountClass: account.accountClass,
        environment: account.environment,
        volumeLots: batchTotalLots,
        perLegLots: batchLegLots[0] ?? volumeLots,
        sizingMethod: sized.method,
        stopLoss: finalStopLoss,
        takeProfit: finalTakeProfit,
        entryPrice: finalEntryPrice,
        stopTargetMethod: useBatchEntry ? 'batch_entry' : useRetracementEntry ? 'retracement_entry' : stopTargets.method,
        rewardRiskRatio: stopTargets.rewardRiskRatio,
        strategy: strategyMetadata,
        entryPlan: useBatchEntry ? null : entryPlan ?? null,
        batchEntry: useBatchEntry,
        legCount: batchLegLots.length,
        setupGroupId,
        commands: dispatchedCommands,
      },
    });
    await logAutonomyDirectionAudit({
      decisionLogId: input.decisionLogId,
      symbol: executableDecision.symbol,
      timeframe: executableDecision.timeframe,
      stage: 'execution_dispatched',
      baseDecision: executableDecision.decision,
      finalDecision: executableDecision.decision,
      finalBias: executableDecision.finalBias,
      side,
      accepted: true,
      reasons: [
        useBatchEntry
          ? `${side} batch entry dispatched ${batchLegLots.length} leg(s) to execution bridge.`
          : `${side} ${useRetracementEntry ? 'retracement entry plan' : 'market order'} dispatched to execution bridge.`,
      ],
      metrics: {
        commandId: result.command.commandId,
        terminalId: checklist.terminalId,
        strategy: strategyMetadata,
        volumeLots,
        stopLoss: finalStopLoss,
        takeProfit: finalTakeProfit,
        entryPlan: useBatchEntry ? null : entryPlan ?? null,
        batchEntry: useBatchEntry,
        legCount: batchLegLots.length,
        setupGroupId,
        rewardRiskRatio: stopTargets.rewardRiskRatio,
      },
    });

    return {
      ok: true,
      status: 'dispatched',
      decisionLogId: input.decisionLogId,
      commandId: result.command.commandId,
      terminalId: checklist.terminalId,
      blockers: [],
    };
  } catch (error) {
    const blockers = [
      error instanceof ExecutionPolicyBlockedError || error instanceof ExecutionRiskBlockedError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Autonomy execution dispatch failed.',
    ];
    await persistDispatchRecord({
      decisionLogId: input.decisionLogId,
      terminalId: checklist.terminalId,
      symbol: input.decision.symbol,
      side,
      status: 'failed',
      blockers,
      payload: { manual: Boolean(input.manual), strategy: strategyMetadata },
    });
    await logAutonomyDirectionAudit({
      decisionLogId: input.decisionLogId,
      symbol: executableDecision.symbol,
      timeframe: executableDecision.timeframe,
      stage: 'execution_failed',
      baseDecision: executableDecision.decision,
      finalDecision: executableDecision.decision,
      finalBias: executableDecision.finalBias,
      side,
      accepted: false,
      reasons: blockers,
      metrics: { terminalId: checklist.terminalId, strategy: strategyMetadata },
    });
    return {
      ok: false,
      status: 'failed',
      decisionLogId: input.decisionLogId,
      terminalId: checklist.terminalId,
      blockers,
      error: blockers[0],
    };
  }
}

export async function maybeAutoDispatchAutonomyDecision(input: {
  decisionLogId: string;
  decision: AutonomousDecisionOutput;
  config: AutonomyConfig;
}): Promise<AutonomyExecutionDispatchResult | null> {
  if (!['BUY', 'SELL'].includes(input.decision.decision)) return null;
  if (!executionModeAllowsAutoDispatch(input.config.tradeExecutionMode)) return null;
  if (!isAutonomyExecutionEnabled()) return null;
  const account = await resolveExecutionAccountContext();
  const { shouldDispatchPipelineExecution } = await import('@/lib/autonomy-pipeline-throttle');
  if (!(await shouldDispatchPipelineExecution(input.decisionLogId, account?.accountClass ?? 'demo', input.decision.symbol))) {
    return null;
  }
  return dispatchAutonomyDecision({
    decisionLogId: input.decisionLogId,
    decision: input.decision,
    config: input.config,
    manual: false,
  });
}

export async function listAutonomyExecutionDispatches(limit = 50) {
  const result = await queryPostgres(
    `
      SELECT *
      FROM autonomy_execution_dispatches
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [Math.min(200, Math.max(1, limit))],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));

  return result.rows.map((row) => ({
    id: String(row.id),
    decisionLogId: String(row.decision_log_id),
    commandId: row.command_id ? String(row.command_id) : null,
    terminalId: row.terminal_id ? String(row.terminal_id) : null,
    symbol: String(row.symbol),
    side: String(row.side),
    status: String(row.status),
    blockers: Array.isArray(row.blockers_json) ? row.blockers_json : [],
    payload: (row.payload_json as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }));
}
