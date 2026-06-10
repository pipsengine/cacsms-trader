import { AUTONOMY_TIMEFRAME_SEQUENCE } from './autonomous-pipeline';
import { analyzeAiVisualInterpretation } from './ai-visual-interpretation-store';
import { analyzeCaptureCandles } from './candle-detection-store';
import { ensureChartSegmentationForCapture } from './chart-segmentation-store';
import { analyzeCaptureLiquidity } from './liquidity-zone-store';
import { analyzeCaptureOrderBlocks } from './order-block-detection-store';
import { analyzeCapturePatterns } from './pattern-recognition-store';
import { queryPostgres } from './postgres';
import { analyzeCaptureStructure } from './structure-analysis-store';
import { analyzeCaptureSupportResistance } from './support-resistance-store';
import { ensureVisualAnomalyForCapture } from './visual-anomaly-detection-store';

export interface CaptureAnalysisBootstrapSummary {
  timeframes: number;
  bootstrapped: number;
  errors: string[];
}

export async function resolveLatestCaptureId(symbol: string, timeframe: string): Promise<string | null> {
  const result = await queryPostgres(
    `SELECT id
     FROM chart_captures
     WHERE upper(symbol) = $1 AND upper(timeframe) = $2
     ORDER BY captured_at DESC
     LIMIT 1`,
    [symbol.toUpperCase(), timeframe.toUpperCase()],
  );
  return result.rows[0]?.id ? String(result.rows[0].id) : null;
}

async function hasStructureAnalysis(captureId: string): Promise<boolean> {
  const result = await queryPostgres(
    'SELECT 1 FROM structure_analysis_outputs WHERE chart_capture_id = $1 LIMIT 1',
    [captureId],
  );
  return result.rows.length > 0;
}

async function hasAiVisualInterpretation(captureId: string): Promise<boolean> {
  const result = await queryPostgres(
    'SELECT 1 FROM ai_visual_interpretations WHERE chart_capture_id = $1 LIMIT 1',
    [captureId],
  );
  return result.rows.length > 0;
}

export async function ensureCaptureDerivedAnalyses(
  symbol: string,
  timeframe: string,
  captureId: string,
): Promise<void> {
  const normalizedSymbol = symbol.toUpperCase();
  const normalizedTimeframe = timeframe.toUpperCase();
  const input = { symbol: normalizedSymbol, timeframe: normalizedTimeframe, captureId };

  if (!(await hasStructureAnalysis(captureId))) {
    await analyzeCaptureStructure(input);
  }

  await Promise.all([
    analyzeCaptureLiquidity(input).catch(() => null),
    analyzeCaptureOrderBlocks(input).catch(() => null),
    analyzeCaptureSupportResistance(input).catch(() => null),
    analyzeCaptureCandles(input).catch(() => null),
    analyzeCapturePatterns(input).catch(() => null),
    ensureChartSegmentationForCapture({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }).catch(() => null),
    ensureVisualAnomalyForCapture({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }).catch(() => null),
  ]);

  if (!(await hasAiVisualInterpretation(captureId))) {
    await analyzeAiVisualInterpretation({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }).catch(() => null);
  }
}

export async function ensureCaptureAnalysesForSymbol(symbol: string): Promise<CaptureAnalysisBootstrapSummary> {
  const normalized = symbol.toUpperCase();
  const summary: CaptureAnalysisBootstrapSummary = {
    timeframes: AUTONOMY_TIMEFRAME_SEQUENCE.length,
    bootstrapped: 0,
    errors: [],
  };

  for (const timeframe of AUTONOMY_TIMEFRAME_SEQUENCE) {
    const captureId = await resolveLatestCaptureId(normalized, timeframe);
    if (!captureId) {
      summary.errors.push(`No chart capture for ${normalized} ${timeframe}.`);
      continue;
    }
    try {
      await ensureCaptureDerivedAnalyses(normalized, timeframe, captureId);
      summary.bootstrapped += 1;
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : `Capture analysis failed for ${timeframe}.`);
    }
  }

  return summary;
}
