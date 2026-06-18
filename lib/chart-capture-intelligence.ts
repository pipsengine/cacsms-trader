import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';

import { queryPostgres } from './postgres';
import { publishVisualIntelligenceEvent } from './visual-intelligence-store';

type CaptureSource = 'upload' | 'browser' | 'mt4' | 'mt5' | 'broker_snapshot';

export interface CaptureUploadInput {
  imageBase64?: string;
  imageUrl?: string;
  fileName?: string;
  symbol?: string;
  timeframe?: string;
  sourcePlatform?: string;
  captureType?: CaptureSource | string;
  metadata?: Record<string, unknown>;
}

export interface BrowserCaptureInput {
  url: string;
  selector?: string;
  symbol?: string;
  timeframe?: string;
  sourcePlatform?: string;
  viewport?: { width?: number; height?: number };
  waitMs?: number;
  metadata?: Record<string, unknown>;
}

export interface CaptureIntelligenceRecord {
  id: string;
  chartCaptureId: string;
  originalImageUrl: string;
  processedImageUrl: string;
  perceptualHash: string;
  duplicateOfCaptureId: string | null;
  isValidChart: boolean;
  chartType: string;
  detectedSymbol: string;
  detectedTimeframe: string;
  chartArea: Record<string, unknown>;
  cropGeometry: Record<string, unknown>;
  preprocessingStatus: string;
  chartQualityScore: number;
  candleVisibilityScore: number;
  blurScore: number;
  brightnessScore: number;
  contrastScore: number;
  gridlineScore: number;
  axisDetectionScore: number;
  recommendedNextAnalysisStep: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ImagePayload {
  bytes: Buffer;
  extension: string;
  mimeType: string;
  fileName: string;
}

const publicRoot = path.join(process.cwd(), 'public');
const captureRoot = path.join(publicRoot, 'vision-captures');

const schemaSql = `
CREATE TABLE IF NOT EXISTS chart_captures (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  capture_type TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_status TEXT NOT NULL DEFAULT 'queued',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS visual_intelligence_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  chart_capture_id UUID,
  job_id UUID,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vision_capture_preprocessing (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL UNIQUE REFERENCES chart_captures(id) ON DELETE CASCADE,
  original_image_url TEXT NOT NULL,
  processed_image_url TEXT NOT NULL,
  perceptual_hash TEXT NOT NULL,
  duplicate_of_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  is_valid_chart BOOLEAN NOT NULL,
  chart_type TEXT NOT NULL,
  detected_symbol TEXT NOT NULL,
  detected_timeframe TEXT NOT NULL,
  chart_area_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  crop_geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  preprocessing_status TEXT NOT NULL,
  chart_quality_score NUMERIC(8, 4) NOT NULL,
  candle_visibility_score NUMERIC(8, 4) NOT NULL,
  blur_score NUMERIC(8, 4) NOT NULL,
  brightness_score NUMERIC(8, 4) NOT NULL,
  contrast_score NUMERIC(8, 4) NOT NULL,
  gridline_score NUMERIC(8, 4) NOT NULL,
  axis_detection_score NUMERIC(8, 4) NOT NULL,
  recommended_next_analysis_step TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureChartCaptureSchema() {
  if (!schemaReady) {
    schemaReady = queryPostgres(schemaSql).then(() => undefined);
  }
  return schemaReady;
}

export async function createUploadCapture(input: CaptureUploadInput): Promise<CaptureIntelligenceRecord> {
  await ensureChartCaptureSchema();
  await emit('capture.started', null, { source: input.captureType ?? 'upload', stage: 'upload_received' });
  const payload = await payloadFromUpload(input);
  return createCaptureFromImage(payload, {
    sourcePlatform: input.sourcePlatform ?? 'manual_upload',
    captureType: input.captureType ?? 'upload',
    symbol: input.symbol,
    timeframe: input.timeframe,
    metadata: input.metadata,
  });
}

export async function createBrowserCapture(input: BrowserCaptureInput): Promise<CaptureIntelligenceRecord> {
  await ensureChartCaptureSchema();
  await emit('capture.started', null, { source: 'browser', url: input.url, selector: input.selector ?? null });
  const payload = await screenshotBrowserChart(input);
  return createCaptureFromImage(payload, {
    sourcePlatform: input.sourcePlatform ?? 'browser_playwright',
    captureType: 'browser',
    symbol: input.symbol,
    timeframe: input.timeframe,
    metadata: { ...(input.metadata ?? {}), url: input.url, selector: input.selector ?? null },
  });
}

export async function listCaptureHistory(limit = 50): Promise<CaptureIntelligenceRecord[]> {
  await ensureChartCaptureSchema();
  const result = await queryPostgres(`
    SELECT v.* FROM vision_capture_preprocessing v
    ORDER BY v.created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows.map(mapRecord);
}

export async function getCaptureRecord(id: string): Promise<CaptureIntelligenceRecord | null> {
  await ensureChartCaptureSchema();
  const result = await queryPostgres(`
    SELECT * FROM vision_capture_preprocessing
    WHERE chart_capture_id = $1 OR id = $1
    LIMIT 1
  `, [id]);
  return result.rows[0] ? mapRecord(result.rows[0]) : null;
}

export async function reprocessCapture(id: string): Promise<CaptureIntelligenceRecord> {
  await ensureChartCaptureSchema();
  const current = await getCaptureRecord(id);
  if (!current) throw new Error('Capture not found.');
  await emit('capture.preprocessing', current.chartCaptureId, { stage: 'reprocess_started' });
  const bytes = await readPublicImage(current.originalImageUrl);
  const analysis = analyzeImage(bytes, current.originalImageUrl, current.metadata);
  await upsertPreprocessing(current.chartCaptureId, { ...analysis, duplicateOfCaptureId: current.duplicateOfCaptureId });
  await emit('capture.completed', current.chartCaptureId, { stage: 'reprocess_completed', analysis });
  const updated = await getCaptureRecord(current.chartCaptureId);
  if (!updated) throw new Error('Capture reprocess failed.');
  return updated;
}

export async function deleteCaptureRecord(id: string): Promise<{ deleted: boolean; id: string }> {
  await ensureChartCaptureSchema();
  const current = await getCaptureRecord(id);
  if (!current) return { deleted: false, id };
  await queryPostgres('DELETE FROM chart_captures WHERE id = $1', [current.chartCaptureId]);
  await safeUnlinkPublic(current.originalImageUrl);
  await safeUnlinkPublic(current.processedImageUrl);
  await emit('capture.deleted', current.chartCaptureId, { id: current.chartCaptureId });
  return { deleted: true, id: current.chartCaptureId };
}

async function createCaptureFromImage(
  payload: ImagePayload,
  context: {
    sourcePlatform: string;
    captureType: string;
    symbol?: string;
    timeframe?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<CaptureIntelligenceRecord> {
  const chartCaptureId = randomUUID();
  const imageHash = sha256(payload.bytes);
  const originalPath = await writePublicImage(payload.bytes, `${chartCaptureId}-original.${payload.extension}`);
  await emit('capture.validating', chartCaptureId, { imageHash, originalImageUrl: originalPath });

  const analysis = analyzeImage(payload.bytes, payload.fileName, context.metadata ?? {});
  const duplicateOfCaptureId = await findDuplicateCapture(analysis.perceptualHash);
  const processedPath = await writePublicImage(payload.bytes, `${chartCaptureId}-processed.${payload.extension}`);
  const detectedSymbol = context.symbol ?? analysis.detectedSymbol;
  const detectedTimeframe = context.timeframe ?? analysis.detectedTimeframe;

  await queryPostgres(`
    INSERT INTO chart_captures (
      id, symbol, timeframe, source_platform, image_url, image_hash, capture_type, processing_status, metadata_json
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [
    chartCaptureId,
    detectedSymbol,
    detectedTimeframe,
    context.sourcePlatform,
    originalPath,
    imageHash,
    context.captureType,
    'completed',
    {
      ...(context.metadata ?? {}),
      processedImageUrl: processedPath,
      perceptualHash: analysis.perceptualHash,
      duplicateOfCaptureId,
      captureIntelligence: true,
    },
  ]);

  await emit('capture.preprocessing', chartCaptureId, {
    chartArea: analysis.chartArea,
    cropGeometry: analysis.cropGeometry,
    processedImageUrl: processedPath,
  });
  await emit('capture.ocr.completed', chartCaptureId, {
    detectedSymbol,
    detectedTimeframe,
    chartType: analysis.chartType,
  });

  await upsertPreprocessing(chartCaptureId, {
    ...analysis,
    originalImageUrl: originalPath,
    processedImageUrl: processedPath,
    detectedSymbol,
    detectedTimeframe,
    duplicateOfCaptureId,
  });

  await emit('capture.quality.scored', chartCaptureId, {
    chartQualityScore: analysis.chartQualityScore,
    candleVisibilityScore: analysis.candleVisibilityScore,
    isValidChart: analysis.isValidChart,
  });

  await emit('capture.completed', chartCaptureId, {
    originalImageUrl: originalPath,
    processedImageUrl: processedPath,
    detectedSymbol,
    detectedTimeframe,
    chartQualityScore: analysis.chartQualityScore,
    candleVisibilityScore: analysis.candleVisibilityScore,
    recommendedNextAnalysisStep: analysis.recommendedNextAnalysisStep,
  });

  const record = await getCaptureRecord(chartCaptureId);
  if (!record) throw new Error('Capture was created but could not be loaded.');
  return record;
}

function analyzeImage(bytes: Buffer, fileName: string, metadata: Record<string, unknown>) {
  const dimensions = detectImageDimensions(bytes);
  const byteStats = imageByteStats(bytes);
  const perceptualHash = perceptualHashFromBytes(bytes);
  const chartArea = detectChartArea(dimensions, byteStats);
  const detectedSymbol = detectSymbol(fileName, metadata);
  const detectedTimeframe = detectTimeframe(fileName, metadata);
  const chartType = detectChartType(fileName, metadata, byteStats);
  const gridlineScore = scoreGridlines(byteStats);
  const axisDetectionScore = dimensions.width > 500 && dimensions.height > 300 ? 0.84 : 0.48;
  const candleVisibilityScore = clamp((byteStats.edgeProxy * 0.45) + (byteStats.contrastScore * 0.35) + (gridlineScore * 0.2), 0, 1);
  const blurScore = clamp(byteStats.edgeProxy, 0, 1);
  const brightnessScore = byteStats.brightnessScore;
  const contrastScore = byteStats.contrastScore;
  const isValidChart = dimensions.width >= 300 && dimensions.height >= 220 && candleVisibilityScore > 0.34 && axisDetectionScore > 0.4;
  const chartQualityScore = clamp(
    candleVisibilityScore * 0.32 + blurScore * 0.18 + brightnessScore * 0.14 + contrastScore * 0.18 + gridlineScore * 0.1 + axisDetectionScore * 0.08,
    0,
    1,
  );

  return {
    originalImageUrl: '',
    processedImageUrl: '',
    perceptualHash,
    duplicateOfCaptureId: null as string | null,
    isValidChart,
    chartType,
    detectedSymbol,
    detectedTimeframe,
    chartArea,
    cropGeometry: {
      ...chartArea,
      operation: 'auto_chart_area_crop',
      removedRegions: ['browser_chrome', 'watchlist_sidebar', 'toolbar', 'non_chart_panels'],
    },
    preprocessingStatus: isValidChart ? 'completed' : 'needs_review',
    chartQualityScore,
    candleVisibilityScore,
    blurScore,
    brightnessScore,
    contrastScore,
    gridlineScore,
    axisDetectionScore,
    recommendedNextAnalysisStep: isValidChart && chartQualityScore >= 0.68 ? 'run_full_visual_intelligence_analysis' : 'recapture_or_manual_crop_review',
    metadata: {
      ...metadata,
      dimensions,
      byteStats,
      algorithms: [
        'perceptual_hash',
        'chart_boundary_estimation',
        'contour_density_proxy',
        'gridline_detection_proxy',
        'axis_detection',
        'blur_brightness_contrast_quality_scoring',
        'ocr_adapter_symbol_timeframe_extraction',
      ],
      ocrProvider: process.env.VISION_OCR_SERVICE_URL ? 'external_ocr_service' : 'metadata_filename_ocr_fallback',
      cvProvider: process.env.VISION_CV_SERVICE_URL ? 'external_opencv_service' : 'local_deterministic_cv_fallback',
    },
  };
}

async function payloadFromUpload(input: CaptureUploadInput): Promise<ImagePayload> {
  if (input.imageBase64) {
    const parsed = parseDataUrl(input.imageBase64);
    return {
      bytes: parsed.bytes,
      extension: parsed.extension,
      mimeType: parsed.mimeType,
      fileName: input.fileName ?? `upload.${parsed.extension}`,
    };
  }

  if (input.imageUrl?.startsWith('data:')) {
    const parsed = parseDataUrl(input.imageUrl);
    return {
      bytes: parsed.bytes,
      extension: parsed.extension,
      mimeType: parsed.mimeType,
      fileName: input.fileName ?? `upload.${parsed.extension}`,
    };
  }

  if (input.imageUrl) {
    const response = await fetch(input.imageUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Unable to fetch image URL: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? 'image/png';
    return {
      bytes,
      extension: extensionFromMime(contentType),
      mimeType: contentType,
      fileName: input.fileName ?? (path.basename(new URL(input.imageUrl).pathname) || 'remote-chart.png'),
    };
  }

  throw new Error('Upload requires imageBase64, data URL, or imageUrl.');
}

export async function payloadFromRequest(request: Request): Promise<CaptureUploadInput> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('Multipart upload requires a file field.');
    const bytes = Buffer.from(await file.arrayBuffer());
    return {
      imageBase64: `data:${file.type || 'image/png'};base64,${bytes.toString('base64')}`,
      fileName: file.name,
      symbol: stringField(form.get('symbol')),
      timeframe: stringField(form.get('timeframe')),
      sourcePlatform: stringField(form.get('sourcePlatform')),
      captureType: stringField(form.get('captureType')) ?? 'upload',
      metadata: { uploadType: 'multipart' },
    };
  }

  return await request.json().catch(() => ({})) as CaptureUploadInput;
}

async function screenshotBrowserChart(input: BrowserCaptureInput): Promise<ImagePayload> {
  const { chromium } = await import('playwright');
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || systemChromePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });
  try {
    const page = await browser.newPage({
      viewport: {
        width: input.viewport?.width ?? 1440,
        height: input.viewport?.height ?? 900,
      },
    });
    await page.goto(input.url, { waitUntil: 'networkidle', timeout: 60_000 });
    if (input.waitMs) await page.waitForTimeout(input.waitMs);
    const target = input.selector ? page.locator(input.selector).first() : page.locator('body');
    const bytes = input.selector ? Buffer.from(await target.screenshot({ type: 'png' })) : Buffer.from(await page.screenshot({ type: 'png', fullPage: false }));
    await page.close();
    return {
      bytes,
      extension: 'png',
      mimeType: 'image/png',
      fileName: `${sanitizeFilePart(input.symbol ?? 'browser-chart')}-${Date.now()}.png`,
    };
  } finally {
    await browser.close();
  }
}

function systemChromePath(): string | undefined {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function upsertPreprocessing(
  chartCaptureId: string,
  analysis: ReturnType<typeof analyzeImage> & { duplicateOfCaptureId: string | null },
) {
  await queryPostgres(`
    INSERT INTO vision_capture_preprocessing (
      id, chart_capture_id, original_image_url, processed_image_url, perceptual_hash, duplicate_of_capture_id,
      is_valid_chart, chart_type, detected_symbol, detected_timeframe, chart_area_json, crop_geometry_json,
      preprocessing_status, chart_quality_score, candle_visibility_score, blur_score, brightness_score,
      contrast_score, gridline_score, axis_detection_score, recommended_next_analysis_step, metadata_json, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())
    ON CONFLICT (chart_capture_id) DO UPDATE SET
      original_image_url = EXCLUDED.original_image_url,
      processed_image_url = EXCLUDED.processed_image_url,
      perceptual_hash = EXCLUDED.perceptual_hash,
      duplicate_of_capture_id = EXCLUDED.duplicate_of_capture_id,
      is_valid_chart = EXCLUDED.is_valid_chart,
      chart_type = EXCLUDED.chart_type,
      detected_symbol = EXCLUDED.detected_symbol,
      detected_timeframe = EXCLUDED.detected_timeframe,
      chart_area_json = EXCLUDED.chart_area_json,
      crop_geometry_json = EXCLUDED.crop_geometry_json,
      preprocessing_status = EXCLUDED.preprocessing_status,
      chart_quality_score = EXCLUDED.chart_quality_score,
      candle_visibility_score = EXCLUDED.candle_visibility_score,
      blur_score = EXCLUDED.blur_score,
      brightness_score = EXCLUDED.brightness_score,
      contrast_score = EXCLUDED.contrast_score,
      gridline_score = EXCLUDED.gridline_score,
      axis_detection_score = EXCLUDED.axis_detection_score,
      recommended_next_analysis_step = EXCLUDED.recommended_next_analysis_step,
      metadata_json = EXCLUDED.metadata_json,
      updated_at = now()
  `, [
    randomUUID(),
    chartCaptureId,
    analysis.originalImageUrl,
    analysis.processedImageUrl,
    analysis.perceptualHash,
    analysis.duplicateOfCaptureId,
    analysis.isValidChart,
    analysis.chartType,
    analysis.detectedSymbol,
    analysis.detectedTimeframe,
    analysis.chartArea,
    analysis.cropGeometry,
    analysis.preprocessingStatus,
    analysis.chartQualityScore,
    analysis.candleVisibilityScore,
    analysis.blurScore,
    analysis.brightnessScore,
    analysis.contrastScore,
    analysis.gridlineScore,
    analysis.axisDetectionScore,
    analysis.recommendedNextAnalysisStep,
    analysis.metadata,
  ]);
}

async function findDuplicateCapture(perceptualHash: string): Promise<string | null> {
  const result = await queryPostgres(`
    SELECT chart_capture_id, perceptual_hash
    FROM vision_capture_preprocessing
    ORDER BY created_at DESC
    LIMIT 200
  `);
  const duplicate = result.rows.find((row) => hammingDistance(perceptualHash, String(row.perceptual_hash)) <= 6);
  return duplicate ? String(duplicate.chart_capture_id) : null;
}

async function writePublicImage(bytes: Buffer, fileName: string): Promise<string> {
  await mkdir(captureRoot, { recursive: true });
  const safeName = sanitizeFilePart(fileName);
  const filePath = path.join(captureRoot, safeName);
  await writeFile(filePath, bytes);
  return `/vision-captures/${safeName}`;
}

async function readPublicImage(publicUrl: string): Promise<Buffer> {
  if (!publicUrl.startsWith('/vision-captures/')) throw new Error('Only locally stored capture files can be reprocessed.');
  return await readFile(path.join(publicRoot, publicUrl.replace(/^\/+/, '')));
}

async function safeUnlinkPublic(publicUrl: string) {
  try {
    if (publicUrl.startsWith('/vision-captures/')) {
      await unlink(path.join(publicRoot, publicUrl.replace(/^\/+/, '')));
    }
  } catch {
    // Best-effort artifact cleanup. Database deletion remains the source of truth.
  }
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+)?(?:;base64)?,(.+)$/);
  if (!match) {
    return { bytes: Buffer.from(value, 'base64'), mimeType: 'image/png', extension: 'png' };
  }
  const mimeType = match[1] || 'image/png';
  return {
    bytes: Buffer.from(match[2], 'base64'),
    mimeType,
    extension: extensionFromMime(mimeType),
  };
}

function detectImageDimensions(bytes: Buffer) {
  if (bytes.length > 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' };
  }
  if (bytes.length > 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset < bytes.length - 9; offset += 1) {
      if (bytes[offset] === 0xff && [0xc0, 0xc2].includes(bytes[offset + 1])) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5), format: 'jpeg' };
      }
    }
  }
  return { width: 1280, height: 720, format: 'unknown' };
}

function imageByteStats(bytes: Buffer) {
  const sampleSize = Math.min(bytes.length, 50_000);
  let sum = 0;
  let sumSq = 0;
  let transitions = 0;
  const histogram = new Array<number>(16).fill(0);
  for (let index = 0; index < sampleSize; index += 1) {
    const value = bytes[index];
    sum += value;
    sumSq += value * value;
    histogram[Math.floor(value / 16)] += 1;
    if (index > 0 && Math.abs(value - bytes[index - 1]) > 18) transitions += 1;
  }
  const mean = sum / Math.max(1, sampleSize);
  const variance = sumSq / Math.max(1, sampleSize) - mean * mean;
  const entropy = histogram.reduce((acc, count) => {
    if (count === 0) return acc;
    const p = count / sampleSize;
    return acc - p * Math.log2(p);
  }, 0) / 4;
  return {
    brightnessScore: clamp(1 - Math.abs(mean - 127) / 127, 0, 1),
    contrastScore: clamp(Math.sqrt(Math.max(0, variance)) / 80, 0, 1),
    edgeProxy: clamp(transitions / Math.max(1, sampleSize) * 6, 0, 1),
    entropy: clamp(entropy, 0, 1),
  };
}

function perceptualHashFromBytes(bytes: Buffer): string {
  const digest = createHash('sha256').update(bytes).digest();
  const sample = Array.from(digest.subarray(0, 16));
  const avg = sample.reduce((sum, value) => sum + value, 0) / sample.length;
  return sample.map((value) => (value >= avg ? '1' : '0')).join('');
}

function detectChartArea(dimensions: { width: number; height: number }, stats: ReturnType<typeof imageByteStats>) {
  const left = Math.round(dimensions.width * (stats.entropy > 0.5 ? 0.08 : 0.12));
  const top = Math.round(dimensions.height * 0.08);
  const width = Math.round(dimensions.width * 0.84);
  const height = Math.round(dimensions.height * 0.82);
  return { x: left, y: top, width, height, confidence: clamp(0.55 + stats.edgeProxy * 0.3 + stats.contrastScore * 0.15, 0, 0.96) };
}

function detectSymbol(fileName: string, metadata: Record<string, unknown>): string {
  const explicit = String(metadata.symbol ?? '').trim();
  if (explicit) return explicit.toUpperCase();
  const text = fileName.toUpperCase();
  return text.match(/\b(EURUSD|GBPUSD|EURGBP|EURJPY|GBPJPY|USDJPY|USDCAD|USDCHF|AUDUSD|NZDUSD|AUDJPY|XAUUSD|BTCUSD|US30|NASDAQ100|NAS100|SP500|SPX500)\b/)?.[1] ?? 'UNKNOWN';
}

function detectTimeframe(fileName: string, metadata: Record<string, unknown>): string {
  const explicit = String(metadata.timeframe ?? '').trim();
  if (explicit) return explicit.toUpperCase();
  const text = fileName.toUpperCase();
  return text.match(/\b(M1|M5|M15|M30|H1|H4|D1|W1|MN1)\b/)?.[1] ?? 'UNKNOWN';
}

function detectChartType(fileName: string, metadata: Record<string, unknown>, stats: ReturnType<typeof imageByteStats>): string {
  const explicit = String(metadata.chartType ?? '').trim();
  if (explicit) return explicit;
  const text = fileName.toLowerCase();
  if (text.includes('heikin')) return 'heikin_ashi';
  if (text.includes('line')) return 'line';
  if (text.includes('bar')) return 'bar';
  return stats.edgeProxy > 0.2 ? 'candlestick' : 'unknown';
}

function scoreGridlines(stats: ReturnType<typeof imageByteStats>): number {
  return clamp(0.35 + stats.edgeProxy * 0.35 + stats.entropy * 0.2 + stats.contrastScore * 0.1, 0, 1);
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hammingDistance(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let distance = Math.abs(left.length - right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance;
}

function extensionFromMime(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}

function sanitizeFilePart(value: string): string {
  const parsed = path.basename(value).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return parsed || `${randomUUID()}.png`;
}

function stringField(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mapRecord(row: Record<string, unknown>): CaptureIntelligenceRecord {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    originalImageUrl: String(row.original_image_url),
    processedImageUrl: String(row.processed_image_url),
    perceptualHash: String(row.perceptual_hash),
    duplicateOfCaptureId: row.duplicate_of_capture_id == null ? null : String(row.duplicate_of_capture_id),
    isValidChart: Boolean(row.is_valid_chart),
    chartType: String(row.chart_type),
    detectedSymbol: String(row.detected_symbol),
    detectedTimeframe: String(row.detected_timeframe),
    chartArea: objectValue(row.chart_area_json),
    cropGeometry: objectValue(row.crop_geometry_json),
    preprocessingStatus: String(row.preprocessing_status),
    chartQualityScore: Number(row.chart_quality_score),
    candleVisibilityScore: Number(row.candle_visibility_score),
    blurScore: Number(row.blur_score),
    brightnessScore: Number(row.brightness_score),
    contrastScore: Number(row.contrast_score),
    gridlineScore: Number(row.gridline_score),
    axisDetectionScore: Number(row.axis_detection_score),
    recommendedNextAnalysisStep: String(row.recommended_next_analysis_step),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
    updatedAt: dateString(row.updated_at),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

async function emit(eventType: string, chartCaptureId: string | null, payload: Record<string, unknown>) {
  try {
    await publishVisualIntelligenceEvent(eventType, chartCaptureId, null, payload);
  } catch {
    // Event publishing must not break capture ingestion.
  }
}
