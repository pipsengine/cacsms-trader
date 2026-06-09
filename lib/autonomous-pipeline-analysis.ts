import { AUTONOMY_TIMEFRAME_SEQUENCE } from './autonomous-pipeline';
import { AUTONOMY_TIMEFRAMES } from './autonomy-types';
import { startCacsmsVisionScan } from './cacsms-vision-store';
import { analyzeSymbolMultiTimeframe } from './multi-timeframe-analysis-store';
import { queryPostgres } from './postgres';
import { completePipelineStage, getLatestPipelineSession } from './top-down-orchestrator';

export interface PipelineAnalysisSummary {
  visualDetection: 'skipped' | 'completed';
  mtfFusion: 'skipped' | 'completed' | 'failed';
  cacsmsVision: 'skipped' | 'completed' | 'failed';
  errors: string[];
}

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
    errors: [],
  };

  if (!(await hasFullCaptureCoverage(normalized))) {
    return summary;
  }

  const session = await getLatestPipelineSession(normalized);
  const sessionId = session?.id ? String(session.id) : null;

  if (sessionId) {
    try {
      const completed = await completePipelineStage(sessionId, 'visual-detection', 100, {
        eventType: 'visual_detection.completed',
        message: 'Visual detection available across captured charts.',
      });
      if (completed) summary.visualDetection = 'completed';
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : 'Visual detection stage update failed.');
    }
  }

  const snapshots = await countMtfSnapshots(normalized);
  if (snapshots < AUTONOMY_TIMEFRAME_SEQUENCE.length) {
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

  return summary;
}
