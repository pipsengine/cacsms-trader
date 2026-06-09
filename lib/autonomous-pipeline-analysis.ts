import { AUTONOMY_TIMEFRAME_SEQUENCE } from './autonomous-pipeline';
import { AUTONOMY_TIMEFRAMES } from './autonomy-types';
import { generateAutonomousSignal } from './autonomy-store';
import {
  shouldGeneratePipelineSignal,
  shouldRefreshPipelineInterpretation,
  shouldRefreshPipelineMtf,
} from './autonomy-pipeline-throttle';
import { resolveExecutionAccountContext } from './execution-account-context';
import { ensureCaptureAnalysesForSymbol } from './capture-analysis-bootstrap';
import { advanceMacroIntelligence } from './macro-intelligence-store';
import { startCacsmsVisionScan } from './cacsms-vision-store';
import { analyzeSymbolMultiTimeframe } from './multi-timeframe-analysis-store';
import { queryPostgres } from './postgres';
import { advancePipelineRiskAndExecution } from './autonomous-pipeline-risk-execution';
import { analyzeVisualMarketInterpretation } from './visual-market-interpretation-store';
import { completePipelineStage, getLatestPipelineSession } from './top-down-orchestrator';

export interface PipelineAnalysisSummary {
  visualDetection: 'skipped' | 'completed';
  mtfFusion: 'skipped' | 'completed' | 'failed';
  cacsmsVision: 'skipped' | 'completed' | 'failed';
  macroIntelligence: 'skipped' | 'completed' | 'failed' | 'in_progress';
  signalGeneration: 'skipped' | 'completed' | 'in_progress' | 'failed';
  riskGate: 'skipped' | 'completed' | 'blocked' | 'failed';
  execution: 'skipped' | 'dispatched' | 'blocked' | 'failed' | 'not_actionable';
  errors: string[];
}

const SIGNAL_TIMEFRAME = 'M15';

async function hasFullCaptureCoverage(symbol: string): Promise<boolean> {
  const result = await queryPostgres(
    `SELECT COUNT(DISTINCT upper(timeframe))::int AS count
     FROM chart_captures
     WHERE upper(symbol) = $1`,
    [symbol],
  );
  return Number(result.rows[0]?.count ?? 0) >= AUTONOMY_TIMEFRAME_SEQUENCE.length;
}

async function countMtfSnapshots(symbol: string): Promise<number> {
  const result = await queryPostgres(
    'SELECT COUNT(*)::int AS snapshots FROM timeframe_analysis_snapshots WHERE upper(symbol) = $1',
    [symbol],
  );
  return Number(result.rows[0]?.snapshots ?? 0);
}

async function shouldRefreshMtf(symbol: string): Promise<boolean> {
  const result = await queryPostgres(
    `SELECT
       (SELECT MAX(captured_at) FROM chart_captures WHERE upper(symbol) = $1) AS capture_at,
       (SELECT MAX(created_at) FROM timeframe_analysis_snapshots WHERE upper(symbol) = $1) AS mtf_at`,
    [symbol],
  );
  const captureAt = result.rows[0]?.capture_at ? new Date(String(result.rows[0].capture_at)).getTime() : 0;
  const mtfAt = result.rows[0]?.mtf_at ? new Date(String(result.rows[0].mtf_at)).getTime() : 0;
  return captureAt > mtfAt;
}

async function countRecentVisionAnalyses(symbol: string): Promise<number> {
  const result = await queryPostgres(
    `SELECT COUNT(*)::int AS count
     FROM cacsms_vision_analysis
     WHERE upper(symbol) = $1 AND created_at > now() - interval '24 hours'`,
    [symbol],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function advancePipelineAnalysis(symbol: string): Promise<PipelineAnalysisSummary> {
  const normalized = symbol.toUpperCase();
  const summary: PipelineAnalysisSummary = {
    visualDetection: 'skipped',
    mtfFusion: 'skipped',
    cacsmsVision: 'skipped',
    macroIntelligence: 'skipped',
    signalGeneration: 'skipped',
    riskGate: 'skipped',
    execution: 'skipped',
    errors: [],
  };

  if (!(await hasFullCaptureCoverage(normalized))) {
    return summary;
  }

  const session = await getLatestPipelineSession(normalized);
  const sessionId = session?.id ? String(session.id) : null;

  if (sessionId) {
    try {
      const bootstrap = await ensureCaptureAnalysesForSymbol(normalized);
      const completed = await completePipelineStage(sessionId, 'visual-detection', bootstrap.bootstrapped >= AUTONOMY_TIMEFRAME_SEQUENCE.length ? 100 : 75, {
        eventType: 'visual_detection.completed',
        message: `Capture-derived visual analyses bootstrapped for ${bootstrap.bootstrapped}/${bootstrap.timeframes} timeframes.`,
      });
      if (completed) summary.visualDetection = 'completed';
      summary.errors.push(...bootstrap.errors);
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : 'Visual detection stage update failed.');
    }
  }

  const snapshots = await countMtfSnapshots(normalized);
  const refreshMtf = snapshots < AUTONOMY_TIMEFRAME_SEQUENCE.length || await shouldRefreshMtf(normalized);
  if (refreshMtf) {
    try {
      await analyzeSymbolMultiTimeframe({ symbol: normalized });
      summary.mtfFusion = 'completed';
      if (sessionId) {
        await completePipelineStage(sessionId, 'mtf-fusion', 100, {
          eventType: 'mtf.fusion.completed',
          message: 'Multi-timeframe fusion complete.',
        });
      }
    } catch (error) {
      summary.mtfFusion = 'failed';
      summary.errors.push(error instanceof Error ? error.message : 'MTF fusion failed.');
      return summary;
    }
  } else {
    summary.mtfFusion = 'completed';
    if (sessionId) {
      await completePipelineStage(sessionId, 'mtf-fusion', 100).catch(() => null);
    }
  }

  const visionAnalyses = await countRecentVisionAnalyses(normalized);
  if (visionAnalyses === 0) {
    try {
      await startCacsmsVisionScan({
        symbols: [normalized],
        timeframes: [...AUTONOMY_TIMEFRAMES],
        triggerSource: 'autonomous_pipeline',
      });
      summary.cacsmsVision = 'completed';
      if (sessionId) {
        await completePipelineStage(sessionId, 'cacsms-vision', 100, {
          eventType: 'cacsms.vision.completed',
          message: 'Cacsms Vision analysis completed for active symbol.',
        });
      }
    } catch (error) {
      summary.cacsmsVision = 'failed';
      summary.errors.push(error instanceof Error ? error.message : 'Cacsms Vision scan failed.');
    }
  } else {
    summary.cacsmsVision = 'completed';
    if (sessionId) {
      await completePipelineStage(sessionId, 'cacsms-vision', 100).catch(() => null);
    }
  }

  let macroCompleted = false;
  try {
    const fusion = await advanceMacroIntelligence(normalized);
    summary.macroIntelligence = fusion.status === 'completed' ? 'completed' : 'in_progress';
    macroCompleted = fusion.status === 'completed';
  } catch (error) {
    summary.macroIntelligence = 'failed';
    summary.errors.push(error instanceof Error ? error.message : 'Macro intelligence fusion failed.');
  }

  if (!macroCompleted) {
    return summary;
  }

  try {
    const account = await resolveExecutionAccountContext();
    const accountClass = account?.accountClass ?? 'demo';
    await ensureCaptureAnalysesForSymbol(normalized);
    if (await shouldRefreshPipelineMtf(normalized, accountClass)) {
      await analyzeSymbolMultiTimeframe({ symbol: normalized });
    }
    if (await shouldRefreshPipelineInterpretation(normalized, SIGNAL_TIMEFRAME, accountClass)) {
      await analyzeVisualMarketInterpretation({ symbol: normalized, timeframe: SIGNAL_TIMEFRAME });
    }

    if (await shouldGeneratePipelineSignal(normalized, accountClass)) {
      const signal = await generateAutonomousSignal(normalized, SIGNAL_TIMEFRAME);
      const actionable = signal.decision === 'BUY' || signal.decision === 'SELL';
      summary.signalGeneration = actionable ? 'completed' : 'in_progress';
      if (sessionId) {
        await completePipelineStage(sessionId, 'signal-generation', actionable ? 100 : 60, {
          eventType: 'signal.generation.completed',
          message: `Autonomous signal ${signal.decision} at ${signal.confidenceScore}% confidence.`,
          payload: {
            decision: signal.decision,
            confidenceScore: signal.confidenceScore,
            setupReadinessScore: signal.setupReadinessScore,
            reasonAgainstDecision: signal.reasonAgainstDecision,
          },
        });
      }
    } else {
      summary.signalGeneration = 'in_progress';
    }
  } catch (error) {
    summary.signalGeneration = 'failed';
    summary.errors.push(error instanceof Error ? error.message : 'Autonomous signal generation failed.');
    return summary;
  }

  try {
    const downstream = await advancePipelineRiskAndExecution(normalized, sessionId);
    summary.riskGate = downstream.riskGate;
    summary.execution = downstream.execution;
    summary.errors.push(...downstream.errors);
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : 'Risk/execution pipeline advance failed.');
  }

  return summary;
}
