import { existsSync } from 'fs';
import { readdir, stat, unlink } from 'fs/promises';
import path from 'path';

import { queryPostgres } from './postgres';

const publicRoot = path.join(process.cwd(), 'public');
const captureRoot = path.join(publicRoot, 'vision-captures');

export type ChartCaptureCleanupResult = {
  status: 'skipped' | 'completed';
  deletedCaptures: number;
  deletedFiles: number;
  deletedEvents: number;
  deletedInterpretations: number;
  deletedAnomalyJobs: number;
  deletedAnomalies: number;
  protectedCaptures: number;
  retentionHours: number;
  detail: string;
};

export type ChartCaptureCleanupOptions = {
  aggressive?: boolean;
};

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function retentionHours(): number {
  return Math.max(0.25, envNumber('CACSMS_CAPTURE_RETENTION_HOURS', 1));
}

function cleanupIntervalMs(): number {
  const minutes = Math.max(15, envNumber('CACSMS_CAPTURE_CLEANUP_INTERVAL_MINUTES', 60));
  return minutes * 60_000;
}

function keepLatestPerTimeframe(): number {
  return Math.max(1, Math.min(3, Math.round(envNumber('CACSMS_CAPTURE_KEEP_LATEST_PER_TIMEFRAME', 1))));
}

let lastCleanupAt = 0;

export function chartCaptureCleanupIntervalMs(): number {
  return cleanupIntervalMs();
}

async function unlinkPublicAsset(publicUrl: string | null | undefined): Promise<boolean> {
  const normalized = String(publicUrl ?? '').trim();
  if (!normalized.startsWith('/vision-captures/')) return false;
  try {
    const filePath = path.join(publicRoot, normalized.replace(/^\/+/, ''));
    if (!existsSync(filePath)) return false;
    await unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

function urlsFromMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const row = metadata as Record<string, unknown>;
  const urls = [row.processedImageUrl, row.originalImageUrl]
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.startsWith('/vision-captures/'));
  return urls;
}

async function collectProtectedCaptureIds(): Promise<Set<string>> {
  const protectedIds = new Set<string>();
  const keepLatest = keepLatestPerTimeframe();

  const latest = await queryPostgres(
    `
      SELECT id
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY upper(symbol), upper(timeframe)
                 ORDER BY captured_at DESC
               ) AS row_number
        FROM chart_captures
      ) ranked
      WHERE row_number <= $1
    `,
    [keepLatest],
  );
  for (const row of latest.rows) {
    protectedIds.add(String((row as { id: string }).id));
  }

  const recentMtf = await queryPostgres(
    `
      SELECT DISTINCT chart_capture_id
      FROM timeframe_analysis_snapshots
      WHERE chart_capture_id IS NOT NULL
        AND created_at > now() - interval '2 hours'
    `,
  ).catch(() => ({ rows: [] }));
  for (const row of recentMtf.rows) {
    const id = String((row as { chart_capture_id?: string }).chart_capture_id ?? '').trim();
    if (id) protectedIds.add(id);
  }

  return protectedIds;
}

async function listStaleCaptures(retention: number, protectedIds: Set<string>, aggressive = false) {
  const ageFilter = aggressive
    ? ''
    : 'WHERE c.captured_at < now() - ($1::text || \' hours\')::interval';
  const result = await queryPostgres(
    `
      SELECT
        c.id,
        c.image_url,
        c.metadata_json,
        p.original_image_url,
        p.processed_image_url
      FROM chart_captures c
      LEFT JOIN vision_capture_preprocessing p ON p.chart_capture_id = c.id
      ${ageFilter}
      ORDER BY c.captured_at ASC
      LIMIT 1000
    `,
    aggressive ? [] : [String(retention)],
  );

  return result.rows
    .map((row) => ({
      id: String((row as { id: string }).id),
      imageUrl: (row as { image_url?: string }).image_url ? String((row as { image_url?: string }).image_url) : null,
      metadata: (row as { metadata_json?: unknown }).metadata_json,
      originalImageUrl: (row as { original_image_url?: string }).original_image_url
        ? String((row as { original_image_url?: string }).original_image_url)
        : null,
      processedImageUrl: (row as { processed_image_url?: string }).processed_image_url
        ? String((row as { processed_image_url?: string }).processed_image_url)
        : null,
    }))
    .filter((row) => !protectedIds.has(row.id));
}

async function purgeOrphanCaptureFiles(retention: number): Promise<number> {
  if (!existsSync(captureRoot)) return 0;
  const deleteAll = retention <= 0;
  const cutoffMs = Date.now() - retention * 3_600_000;
  let deleted = 0;
  const entries = await readdir(captureRoot);
  for (const entry of entries) {
    const filePath = path.join(captureRoot, entry);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;
      if (!deleteAll && fileStat.mtimeMs > cutoffMs) continue;
      await unlink(filePath);
      deleted += 1;
    } catch {
      // continue sweep
    }
  }
  return deleted;
}

async function purgeVisualIntelligenceEvents(retention: number, maxBatches: number): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await queryPostgres(
      `
        DELETE FROM visual_intelligence_events
        WHERE id IN (
          SELECT id
          FROM visual_intelligence_events
          WHERE created_at < now() - ($1::text || ' hours')::interval
          ORDER BY id ASC
          LIMIT 50000
        )
        RETURNING id
      `,
      [String(retention)],
    );
    deleted += result.rows.length;
    if (result.rows.length === 0) break;
  }
  return deleted;
}

async function purgeStaleMarketInterpretations(retention: number): Promise<number> {
  const result = await queryPostgres(
    `
      WITH keep AS (
        SELECT id
        FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY upper(symbol), upper(timeframe)
                   ORDER BY created_at DESC
                 ) AS row_number
          FROM visual_market_interpretations
        ) ranked
        WHERE row_number <= 1
      )
      DELETE FROM visual_market_interpretations
      WHERE id NOT IN (SELECT id FROM keep)
        AND created_at < now() - ($1::text || ' hours')::interval
      RETURNING id
    `,
    [String(retention)],
  );
  return result.rows.length;
}

async function purgeStaleVisualAnomalyJobs(retention: number, protectedIds: Set<string>): Promise<number> {
  const protectedList = [...protectedIds];
  const result = await queryPostgres(
    `
      DELETE FROM visual_anomaly_jobs
      WHERE created_at < now() - ($1::text || ' hours')::interval
        AND (
          chart_capture_id IS NULL
          OR NOT (chart_capture_id = ANY($2::uuid[]))
        )
      RETURNING id
    `,
    [String(retention), protectedList],
  );
  return result.rows.length;
}

async function purgeStaleVisualAnomalies(retention: number, maxBatches: number): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await queryPostgres(
      `
        DELETE FROM visual_anomalies
        WHERE id IN (
          SELECT id
          FROM visual_anomalies
          WHERE created_at < now() - ($1::text || ' hours')::interval
          ORDER BY created_at ASC
          LIMIT 50000
        )
        RETURNING id
      `,
      [String(retention)],
    );
    deleted += result.rows.length;
    if (result.rows.length === 0) break;
  }
  return deleted;
}

async function persistCleanupSummary(payload: ChartCaptureCleanupResult): Promise<void> {
  await queryPostgres(
    `
      INSERT INTO mt5_bridge_settings (key, value, updated_at)
      VALUES ('chart_capture_cleanup_last_run', $1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [JSON.stringify({
      at: new Date().toISOString(),
      deletedCaptures: payload.deletedCaptures,
      deletedFiles: payload.deletedFiles,
      deletedEvents: payload.deletedEvents,
      deletedInterpretations: payload.deletedInterpretations,
      deletedAnomalyJobs: payload.deletedAnomalyJobs,
      deletedAnomalies: payload.deletedAnomalies,
      protectedCaptures: payload.protectedCaptures,
      retentionHours: payload.retentionHours,
      detail: payload.detail,
    })],
  ).catch(() => null);
}

async function deleteStaleCaptureBatch(
  stale: Awaited<ReturnType<typeof listStaleCaptures>>,
): Promise<{ deletedCaptures: number; deletedFiles: number }> {
  let deletedFiles = 0;
  for (const capture of stale) {
    const urls = new Set<string>([
      capture.imageUrl ?? '',
      capture.originalImageUrl ?? '',
      capture.processedImageUrl ?? '',
      ...urlsFromMetadata(capture.metadata),
    ].filter((url) => url.startsWith('/vision-captures/')));
    for (const url of urls) {
      if (await unlinkPublicAsset(url)) deletedFiles += 1;
    }
  }

  const ids = stale.map((row) => row.id);
  const deleted = await queryPostgres(
    'DELETE FROM chart_captures WHERE id = ANY($1::uuid[]) RETURNING id',
    [ids],
  );
  return { deletedCaptures: deleted.rows.length, deletedFiles };
}

export async function runChartCaptureCleanup(
  trigger = 'scheduler',
  options: ChartCaptureCleanupOptions = {},
): Promise<ChartCaptureCleanupResult> {
  const aggressive = options.aggressive === true;
  const retention = retentionHours();
  const protectedIds = await collectProtectedCaptureIds();
  const maxBatches = aggressive
    ? Math.max(20, Math.min(200, Math.round(envNumber('CACSMS_CAPTURE_CLEANUP_MAX_BATCHES', 20)) * 5))
    : Math.max(1, Math.min(50, Math.round(envNumber('CACSMS_CAPTURE_CLEANUP_MAX_BATCHES', 20))));

  let deletedCaptures = 0;
  let deletedFiles = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const stale = await listStaleCaptures(retention, protectedIds, aggressive);
    if (stale.length === 0) break;
    const removed = await deleteStaleCaptureBatch(stale);
    deletedCaptures += removed.deletedCaptures;
    deletedFiles += removed.deletedFiles;
  }

  const orphanDeleted = await purgeOrphanCaptureFiles(aggressive ? 0 : retention);
  deletedFiles += orphanDeleted;

  const deletedEvents = await purgeVisualIntelligenceEvents(retention, aggressive ? 200 : 5);
  const deletedInterpretations = await purgeStaleMarketInterpretations(retention);
  const deletedAnomalyJobs = await purgeStaleVisualAnomalyJobs(retention, protectedIds);
  const deletedAnomalies = await purgeStaleVisualAnomalies(retention, aggressive ? 200 : 10);

  const parts = [
    deletedCaptures > 0 ? `${deletedCaptures} capture(s)` : null,
    deletedEvents > 0 ? `${deletedEvents} event(s)` : null,
    deletedInterpretations > 0 ? `${deletedInterpretations} interpretation(s)` : null,
    deletedAnomalies > 0 ? `${deletedAnomalies} anomaly row(s)` : null,
    deletedAnomalyJobs > 0 ? `${deletedAnomalyJobs} anomaly job(s)` : null,
    orphanDeleted > 0 ? `${orphanDeleted} orphan file(s)` : null,
  ].filter(Boolean);

  const result: ChartCaptureCleanupResult = {
    status: 'completed',
    deletedCaptures,
    deletedFiles,
    deletedEvents,
    deletedInterpretations,
    deletedAnomalyJobs,
    deletedAnomalies,
    protectedCaptures: protectedIds.size,
    retentionHours: retention,
    detail: parts.length > 0
      ? `Removed ${parts.join(', ')} (${aggressive ? 'aggressive' : 'hourly'} ${trigger}).`
      : `No stale visual data to remove (${trigger}).`,
  };
  await persistCleanupSummary(result);
  return result;
}

export async function maybeRunChartCaptureCleanup(trigger = 'scheduler'): Promise<ChartCaptureCleanupResult | null> {
  if (Date.now() - lastCleanupAt < cleanupIntervalMs()) return null;
  lastCleanupAt = Date.now();
  try {
    return await runChartCaptureCleanup(trigger);
  } catch {
    return null;
  }
}
