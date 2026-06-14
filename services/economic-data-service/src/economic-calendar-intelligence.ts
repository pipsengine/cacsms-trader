import { queryPostgres } from '@/lib/postgres';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

export type EconomicImpactLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type EconomicEventStatus =
  | 'UPCOMING'
  | 'SCHEDULED'
  | 'PRE_MONITORING'
  | 'WATCHING'
  | 'RELEASED'
  | 'ANALYZED'
  | 'ARCHIVED'
  | 'FAILED'
  | 'CONFLICTED'
  | 'SOURCE_CONFLICT';
export type EconomicBias =
  | 'Strong Bullish'
  | 'Mild Bullish'
  | 'Neutral'
  | 'Mild Bearish'
  | 'Strong Bearish'
  | 'Conflicted'
  | 'Not Enough Data';

export type EconomicCalendarEventView = {
  id: string;
  sourceId: string | null;
  sourceName: string;
  sourceUrl: string | null;
  eventKey: string;
  eventName: string;
  normalizedEventName: string;
  country: string;
  currency: string;
  impactLevel: EconomicImpactLevel;
  eventDate: string;
  eventTime: string | null;
  sourceTimezone: string;
  localEventTime: string | null;
  utcEventTime: string | null;
  brokerEventTime: string | null;
  actualValue: string | null;
  actualSource: string | null;
  actualCaptureStatus: string | null;
  actualCapturedAt: string | null;
  websiteActualValue: string | null;
  xmlActualValue: string | null;
  sourcePriorityUsed: string | null;
  forecastValue: string | null;
  previousValue: string | null;
  revisedPreviousValue: string | null;
  unit: string | null;
  status: EconomicEventStatus;
  surpriseValue: number | null;
  surprisePercentage: number | null;
  surpriseDirection: string | null;
  bias: EconomicBias;
  biasStrength: number;
  affectedPairs: string[];
  tradeRestrictionRequired: boolean;
  restrictionStartTime: string | null;
  restrictionEndTime: string | null;
  aiSummary: string | null;
  aiReasoning: string | null;
  sourceReliabilityScore: number;
  validationStatus: string;
  conflictStatus: string;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type EconomicSourceView = {
  id: string;
  sourceName: string;
  sourceType: string;
  sourceUrl: string;
  priority: number;
  enabled: boolean;
  requiresCredentials: boolean;
  reliabilityScore: number;
  successfulFetchCount: number;
  failedFetchCount: number;
  conflictCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastCheckedAt: string | null;
  status: 'ok' | 'disabled' | 'degraded' | 'failed' | 'needs_review';
};

export type EconomicCalendarDashboard = {
  ok: boolean;
  generatedAt: string;
  events: EconomicCalendarEventView[];
  sources: EconomicSourceView[];
  summary: {
    todaysHighImpactEvents: number;
    upcomingNext24Hours: number;
    monitoringNow: number;
    releasedAwaitingAnalysis: number;
    activeTradeRestrictions: number;
    sourceCollectionHealth: number;
    strongestBullishCurrencyToday: string | null;
    strongestBearishCurrencyToday: string | null;
    calendarStale?: boolean;
    latestEventDate?: string | null;
    lastSyncAt?: string | null;
  };
  currencyBias: Array<{ currency: string; score: number; bias: EconomicBias; eventCount: number }>;
  conflicts: Array<{ id: string; eventId: string | null; conflictType: string; fieldName: string; sourceA: string; sourceB: string; valueA: string | null; valueB: string | null; createdAt: string }>;
  sourceLogs: Array<{ id: string; sourceName: string; jobType: string; status: string; message: string | null; fetchedAt: string }>;
  providerStatuses: Array<{ provider: string; status: 'ok' | 'disabled' | 'missing_table' | 'error' | 'degraded' | 'failed' | 'needs_review'; message: string }>;
};

type LifecycleReconciliation = {
  preMonitoring: number;
  watching: number;
  failed: number;
  watcherJobsQueued: number;
};

type CollectedEconomicEvent = {
  id: string;
  sourceName: string;
  sourceUrl: string;
  sourceType: 'json' | 'xml' | 'website' | 'fallback_html';
  eventKey: string;
  eventName: string;
  normalizedEventName: string;
  country: string;
  currency: string;
  impactLevel: EconomicImpactLevel;
  eventDate: string;
  eventTime: string | null;
  eventTimezone: string;
  utcEventTime: string | null;
  actualValue: string | null;
  actualSource: 'WEBSITE' | 'OFFICIAL' | 'MANUAL' | 'INVESTING' | 'NONE';
  actualCaptureStatus: 'PENDING' | 'CAPTURED' | 'NOT_RELEASED' | 'FAILED' | 'CONFLICTED';
  actualCapturedAt: string | null;
  websiteActualValue: string | null;
  xmlActualValue: string | null;
  sourcePriorityUsed: 'OFFICIAL' | 'WEBSITE' | 'XML' | 'INVESTING' | 'FOREXFACTORY' | 'UNKNOWN';
  forecastValue: string | null;
  previousValue: string | null;
  revisedPreviousValue: string | null;
  status: EconomicEventStatus;
  surpriseValue: number | null;
  surprisePercentage: number | null;
  surpriseDirection: string | null;
  bias: EconomicBias;
  biasStrength: number;
  affectedPairs: string[];
  tradeRestrictionRequired: boolean;
  restrictionStartTime: string | null;
  restrictionEndTime: string | null;
  aiSummary: string | null;
  aiReasoning: string | null;
};

const tableMissingCodes = new Set(['42P01', '42703']);
const REQUIRED_CURRENCIES = ['AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'NZD', 'USD'] as const;
const requiredCurrencySet = new Set<string>(REQUIRED_CURRENCIES);
const forexFactoryCalendarUrl = 'https://www.forexfactory.com/calendar?week=this';
const forexFactoryXmlUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
const forexFactoryJsonUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const investingCalendarUrl = 'https://www.investing.com/economic-calendar/';
const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const execFileAsync = promisify(execFile);

export class EconomicCalendarIntelligenceService {
  async getDashboard(): Promise<EconomicCalendarDashboard> {
    const generatedAt = new Date().toISOString();

    try {
      const [events, sources, conflicts, sourceLogs, activeRestrictionCount, freshness] = await Promise.all([
        this.listEvents(),
        this.listSources(),
        this.listConflicts(),
        this.listSourceLogs(),
        this.countActiveRestrictions(),
        this.getCalendarFreshness().catch(() => ({ stale: true, latestEventDate: null, lastSyncAt: null, upcomingFromToday: 0 })),
      ]);

      const currencyBias = this.computeCurrencyBias(events);
      const sourceCollectionHealth = sources.length
        ? Math.round(sources.reduce((sum, source) => sum + source.reliabilityScore, 0) / sources.length)
        : 0;
      const strongestBullishCurrencyToday = currencyBias.find((item) => item.score > 0)?.currency ?? null;
      const strongestBearishCurrencyToday = [...currencyBias].reverse().find((item) => item.score < 0)?.currency ?? null;

      return {
        ok: true,
        generatedAt,
        events,
        sources,
        summary: {
          todaysHighImpactEvents: events.filter((event) => isToday(event.utcEventTime) && ['High', 'Critical'].includes(event.impactLevel)).length,
          upcomingNext24Hours: events.filter((event) => isWithinHours(event.utcEventTime, 24)).length,
          monitoringNow: events.filter((event) => ['PRE_MONITORING', 'WATCHING'].includes(event.status)).length,
          releasedAwaitingAnalysis: events.filter((event) => event.status === 'RELEASED').length,
          activeTradeRestrictions: activeRestrictionCount,
          sourceCollectionHealth,
          strongestBullishCurrencyToday,
          strongestBearishCurrencyToday,
          calendarStale: freshness.stale,
          latestEventDate: freshness.latestEventDate,
          lastSyncAt: freshness.lastSyncAt,
        },
        currencyBias,
        conflicts,
        sourceLogs,
        providerStatuses: sources.map((source) => {
          const providerStatus = source.enabled ? source.status : 'disabled';
          return {
            provider: source.sourceName,
            status: providerStatus,
            message: source.enabled
              ? `${source.sourceName} is enabled for autonomous collection with ${source.reliabilityScore}/100 reliability.`
              : `${source.sourceName} is registered for autonomous policy checks but has no implemented collector enabled yet.`,
          };
        }),
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return {
          ok: false,
          generatedAt,
          events: [],
          sources: [],
          summary: emptySummary(),
          currencyBias: [],
          conflicts: [],
          sourceLogs: [],
          providerStatuses: [{
            provider: 'PostgreSQL',
            status: 'missing_table',
            message: 'Run database/migrations/008_economic_calendar_intelligence.sql to enable Economic Calendar Intelligence storage.',
          }],
        };
      }

      return {
        ok: false,
        generatedAt,
        events: [],
        sources: [],
        summary: emptySummary(),
        currencyBias: [],
        conflicts: [],
        sourceLogs: [],
        providerStatuses: [{
          provider: 'Economic Calendar',
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load economic calendar intelligence.',
        }],
      };
    }
  }

  async recordAction(action: string): Promise<{ ok: boolean; message: string }> {
    const knownActions: Record<string, { jobType: string; message: string }> = {
      discover: { jobType: 'weekly_calendar_discovery', message: 'Discovery job requested for this week and next week.' },
      refresh: { jobType: 'daily_calendar_refresh', message: 'Calendar refresh requested for this week and next week.' },
      'monitor/start': { jobType: 'monitoring_start', message: 'Monitoring start requested for eligible high-impact events.' },
      'monitor/stop': { jobType: 'monitoring_stop', message: 'Monitoring stop requested.' },
      analyze: { jobType: 'post_release_analyzer', message: 'Released-event analysis requested.' },
      archive: { jobType: 'historical_archive', message: 'Archive job requested for analyzed events.' },
      'sources/validate': { jobType: 'source_health_validation', message: 'Source validation requested.' },
      'failed/retry': { jobType: 'retry_failed_events', message: 'Retry requested for failed events.' },
    };

    const resolved = knownActions[action];
    if (!resolved) {
      return { ok: false, message: `Unknown economic calendar action: ${action}` };
    }

    try {
      if (action === 'discover' || action === 'refresh' || action === 'failed/retry' || action === 'monitor/start') {
        const collection = await this.collectForexFactoryThisWeek(resolved.jobType);
        if (collection.stored <= 0) {
          return {
            ok: false,
            message: `${resolved.message} No events were collected. If the app runs in Docker without outbound network access, run "npm run calendar:refresh" on the host (uses port ${process.env.POSTGRES_HOST_PORT ?? '5433'}). Last error: ${collection.error ?? 'investing_calendar_empty'}.`,
          };
        }
        return {
          ok: true,
          message: `${resolved.message} Investing.com calendar collector stored ${collection.stored} required-currency event(s) across ${collection.rangesSynced} week range(s). ${collection.lifecycle.watching} released event(s) without actual values are being watched, ${collection.lifecycle.failed} stale missing releases are marked failed for retry, and ${collection.lifecycle.watcherJobsQueued} watcher job(s) are queued.`,
        };
      }

      await queryPostgres(
        `INSERT INTO source_fetch_logs (source_name, job_type, status, message)
         VALUES ($1, $2, $3, $4)`,
        ['Cacsms Economic Calendar', resolved.jobType, 'REQUESTED', resolved.message],
      );
      return { ok: true, message: resolved.message };
    } catch (error) {
      if (isMissingTableError(error)) {
        return { ok: false, message: 'Economic calendar tables are not installed. Run migration 008 first.' };
      }
      return { ok: false, message: error instanceof Error ? error.message : 'Failed to record action.' };
    }
  }

  async forexFactoryXmlSync(jobType = 'forex_factory_xml_sync') {
    return this.runForexFactoryHybridSync({ jobType, mode: 'json' });
  }

  async forexFactoryBrowserSync(jobType = 'forex_factory_browser_sync') {
    return this.runForexFactoryHybridSync({ jobType, mode: 'browser' });
  }

  async forexFactoryHybridSync(jobType = 'forex_factory_hybrid_sync') {
    return this.runForexFactoryHybridSync({ jobType, mode: 'hybrid' });
  }

  async forexFactoryBrowserActualSync(jobType = 'forex_factory_browser_actual_sync') {
    const startedAt = Date.now();
    const sourceName = 'Investing.com';
    try {
      const result = await this.captureActualsForTodayFromInvesting();
      await this.logSourceFetch(
        sourceName,
        jobType,
        'SUCCESS',
        `Investing calendar actual sync matched=${result.matched} captured=${result.captured} pending=${result.pending} failed=${result.failed}.`,
        Date.now() - startedAt,
      );
      return { ok: true, message: `Investing calendar actual sync captured ${result.captured} actual value(s). Pending ${result.pending}. Failed ${result.failed}.`, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'browser_actual_sync_failed';
      await this.logSourceFetch(sourceName, jobType, 'FAILED', message, Date.now() - startedAt);
      return { ok: false, message };
    }
  }

  async captureActualFromWebsite(eventId: string) {
    const sourceName = 'Investing.com';
    const startedAt = Date.now();
    const event = await this.loadEventForActualCapture(eventId);
    if (!event) return { ok: false, message: 'Event not found.' };

    const range = weekRangeForIsoDate(event.eventDate);
    const investingEvents = await scrapeInvestingEconomicCalendarRange(range);
    const match = findBestInvestingCalendarMatch(
      { currency: event.currency, eventDate: event.eventDate, normalizedEventName: event.normalizedEventName, utcEventTime: event.utcEventTime, eventName: event.eventName },
      investingEvents,
    );
    if (!match) {
      try {
        await queryPostgres(
          `UPDATE economic_events
           SET actual_capture_status = 'FAILED',
               actual_source = 'NONE',
               last_checked_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [event.id],
        );
      } catch (error) {
        const pgError = error as { code?: string };
        if (!pgError || pgError.code !== '42703') throw error;
        await queryPostgres(
          `UPDATE economic_events
           SET last_checked_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [event.id],
        );
      }
      await queryPostgres(
        `INSERT INTO scrape_error_logs (source_name, error_type, message, url, raw_context)
         VALUES ($1, $2, $3, $4, $5)`,
        [sourceName, 'capture_actual_no_match', 'No matching Investing.com calendar row found for event.', investingCalendarUrl, JSON.stringify({ eventId: event.id, eventKey: event.eventKey, currency: event.currency, normalizedEventName: event.normalizedEventName, eventDate: event.eventDate, utcEventTime: event.utcEventTime })],
      );
      return { ok: false, message: 'No matching Investing.com calendar row found.', captured: false };
    }

    const actual = normalizeActualValue(cleanValue(match.actualValue ?? null));
    if (!actual) {
      try {
        await queryPostgres(
          `UPDATE economic_events
           SET actual_capture_status = 'PENDING',
               actual_source = 'NONE',
               forecast_value = COALESCE($2, forecast_value),
               previous_value = COALESCE($3, previous_value),
               last_checked_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [event.id, cleanValue(match.forecastValue ?? null), cleanValue(match.previousValue ?? null)],
        );
      } catch (error) {
        const pgError = error as { code?: string };
        if (!pgError || pgError.code !== '42703') throw error;
        await queryPostgres(
          `UPDATE economic_events
           SET forecast_value = COALESCE($2, forecast_value),
               previous_value = COALESCE($3, previous_value),
               last_checked_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [event.id, cleanValue(match.forecastValue ?? null), cleanValue(match.previousValue ?? null)],
        );
      }
      return { ok: true, message: 'Pending. Investing.com does not show actual yet.', captured: false, status: 'PENDING' };
    }

    try {
      await queryPostgres(
        `UPDATE economic_events
         SET actual_value = $2,
             actual_source = 'INVESTING',
             actual_capture_status = 'CAPTURED',
             actual_captured_at = now(),
             status = CASE WHEN status IN ('ARCHIVED','ANALYZED') THEN status ELSE 'RELEASED' END,
             forecast_value = COALESCE($3, forecast_value),
             previous_value = COALESCE($4, previous_value),
             source_priority_used = 'INVESTING',
             last_checked_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [event.id, actual, cleanValue(match.forecastValue ?? null), cleanValue(match.previousValue ?? null)],
      );
    } catch (error) {
      const pgError = error as { code?: string };
      if (!pgError || pgError.code !== '42703') throw error;
      await queryPostgres(
        `UPDATE economic_events
         SET actual_value = $2,
             status = CASE WHEN status IN ('ARCHIVED','ANALYZED') THEN status ELSE 'RELEASED' END,
             forecast_value = COALESCE($3, forecast_value),
             previous_value = COALESCE($4, previous_value),
             last_checked_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [event.id, actual, cleanValue(match.forecastValue ?? null), cleanValue(match.previousValue ?? null)],
      );
    }

    await this.recordReleaseSnapshot({
      id: event.id,
      actualValue: actual,
      forecastValue: cleanValue(match.forecastValue ?? null) ?? event.forecastValue,
      previousValue: cleanValue(match.previousValue ?? null) ?? event.previousValue,
      revisedPreviousValue: event.revisedPreviousValue,
      sourceUrl: investingCalendarUrl,
    });

    console.log('ECON_CAL_ACTUAL_CAPTURED', { eventId: event.id, actual, durationMs: Date.now() - startedAt });
    await this.logSourceFetch(sourceName, 'capture_actual', 'SUCCESS', `Captured actual for ${event.id}: ${actual}`, Date.now() - startedAt);
    return { ok: true, message: 'Captured.', captured: true, actualValue: actual, actualSource: 'INVESTING', actualCaptureStatus: 'CAPTURED' };
  }

  async isCalendarStale(): Promise<boolean> {
    const freshness = await this.getCalendarFreshness();
    return freshness.stale;
  }

  async getCalendarFreshness(): Promise<{ stale: boolean; latestEventDate: string | null; lastSyncAt: string | null; upcomingFromToday: number }> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const nextWeekEnd = shiftWeekRange(weekRangeForIsoDate(today), 1).toDate;
      const [stats, lastSync] = await Promise.all([
        queryPostgres(
          `
            SELECT
              MAX(event_date)::text AS latest_event_date,
              COUNT(*) FILTER (WHERE event_date >= $2::date AND event_date <= $3::date)::int AS upcoming_in_window
            FROM economic_events
            WHERE currency = ANY($1::text[])
              AND source_name <> 'ForexFactory'
          `,
          [[...REQUIRED_CURRENCIES], today, nextWeekEnd],
        ),
        queryPostgres(
          `
            SELECT fetched_at::text AS fetched_at
            FROM source_fetch_logs
            WHERE job_type IN ('weekly_calendar_discovery', 'daily_calendar_refresh', 'forex_factory_hybrid_sync')
              AND status = 'SUCCESS'
            ORDER BY fetched_at DESC
            LIMIT 1
          `,
        ),
      ]);

      const latestEventDate = nullableString((stats.rows[0] as { latest_event_date?: unknown })?.latest_event_date);
      const upcomingFromToday = Number((stats.rows[0] as { upcoming_in_window?: unknown })?.upcoming_in_window ?? 0);
      const lastSyncAt = nullableString((lastSync.rows[0] as { fetched_at?: unknown })?.fetched_at);
      const stale = upcomingFromToday <= 0 || !latestEventDate || latestEventDate < today;
      return { stale, latestEventDate, lastSyncAt, upcomingFromToday };
    } catch {
      return { stale: true, latestEventDate: null, lastSyncAt: null, upcomingFromToday: 0 };
    }
  }

  private async collectForexFactoryThisWeek(jobType: string): Promise<{ stored: number; lifecycle: LifecycleReconciliation; rangesSynced: number; error?: string }> {
    let stored = 0;
    let lifecycle: LifecycleReconciliation = { preMonitoring: 0, watching: 0, failed: 0, watcherJobsQueued: 0 };
    let lastError: string | undefined;
    const ranges = calendarSyncRangesForToday();
    for (const range of ranges) {
      const result = await this.runInvestingCalendarSync({ jobType, range });
      stored += result.stored;
      lifecycle = result.lifecycle;
      if (result.error) lastError = result.error;
    }
    return { stored, lifecycle, rangesSynced: ranges.length, error: stored > 0 ? undefined : lastError };
  }

  private async runForexFactoryHybridSync(props: { jobType: string; mode: 'json' | 'xml' | 'browser' | 'hybrid' }) {
    let stored = 0;
    let lifecycle: LifecycleReconciliation = { preMonitoring: 0, watching: 0, failed: 0, watcherJobsQueued: 0 };
    let investingCount = 0;
    let capturedActuals = 0;
    for (const range of calendarSyncRangesForToday()) {
      const result = await this.runInvestingCalendarSync({ jobType: props.jobType, range });
      stored += result.stored;
      lifecycle = result.lifecycle;
      investingCount += result.investingCount;
      capturedActuals += result.capturedActuals;
    }
    return { stored, lifecycle, investingCount, capturedActuals };
  }

  private async runInvestingCalendarSync(props: { jobType: string; range: { fromDate: string; toDate: string } }): Promise<{ stored: number; lifecycle: LifecycleReconciliation; investingCount: number; capturedActuals: number; error?: string }> {
    const sourceName = 'Investing.com';
    const startedAt = Date.now();

    await queryPostgres(
      `UPDATE economic_sources
       SET enabled = true,
           source_url = $2,
           robots_policy = 'public_calendar_page',
           terms_policy = 'autonomous_collection_allowed',
           last_checked_at = now(),
           updated_at = now()
       WHERE source_name = $1`,
      [sourceName, investingCalendarUrl],
    );

    await queryPostgres(
      `UPDATE economic_sources
       SET enabled = false,
           last_checked_at = now(),
           updated_at = now()
       WHERE source_name = 'ForexFactory'`,
    );

    await queryPostgres(`DELETE FROM economic_events WHERE source_name = 'ForexFactory'`);

    try {
      const investingCalendar = await scrapeInvestingEconomicCalendarRange(props.range);
      if (!investingCalendar.length) {
        const message = 'investing_calendar_empty';
        await this.logSourceFetch(sourceName, props.jobType, 'FAILED', `${message} range=${props.range.fromDate}..${props.range.toDate}`, Date.now() - startedAt);
        return { stored: 0, lifecycle: await this.reconcileReleaseLifecycle(), investingCount: 0, capturedActuals: 0, error: message };
      }

      let stored = 0;
      let capturedActuals = 0;

      for (const item of investingCalendar) {
        const currency = cleanCurrency(item.currency);
        if (!isRequiredCurrency(currency)) continue;

        const actual = normalizeActualValue(cleanValue(item.actualValue ?? null));
        const forecast = cleanValue(item.forecastValue ?? null);
        const previous = cleanValue(item.previousValue ?? null);
        const expectsRelease = Boolean(forecast || previous);

        const scheduled = item.utcEventTime ? new Date(item.utcEventTime) : null;
        const status = lifecycleStatusForCollectedEvent(scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled : null, actual, expectsRelease);
        const surprise = computeSurprise(actual, forecast, item.eventName);
        const bias = classifyBias(item.eventName, surprise);
        const biasStrength = biasScore(bias);
        const restriction = restrictionWindowForImpact(item.impactLevel);
        const restrictionStartTime = scheduled && !Number.isNaN(scheduled.getTime()) && restriction.beforeMinutes > 0
          ? new Date(scheduled.getTime() - restriction.beforeMinutes * 60_000).toISOString()
          : null;
        const restrictionEndTime = scheduled && !Number.isNaN(scheduled.getTime()) && restriction.afterMinutes > 0
          ? new Date(scheduled.getTime() + restriction.afterMinutes * 60_000).toISOString()
          : null;

        const eventDate = item.eventDate;
        const eventTime = item.eventTime;
        const normalizedEventName = normalizeEventName(item.eventName, currency);
        const eventKey = deterministicEventKey(currency, normalizedEventName, eventDate, eventTime);

        const mergedEvent: CollectedEconomicEvent = {
          id: `evt_${eventKey}`,
          sourceName,
          sourceUrl: item.sourceUrl ?? investingCalendarUrl,
          sourceType: 'website',
          eventKey,
          eventName: item.eventName,
          normalizedEventName,
          country: countryForCurrency(currency),
          currency,
          impactLevel: item.impactLevel,
          eventDate,
          eventTime,
          eventTimezone: 'UTC',
          utcEventTime: item.utcEventTime,
          actualValue: actual,
          actualSource: actual ? ('INVESTING' as const) : ('NONE' as const),
          actualCaptureStatus: actual ? ('CAPTURED' as const) : expectsRelease ? ('PENDING' as const) : ('NOT_RELEASED' as const),
          actualCapturedAt: actual ? new Date().toISOString() : null,
          websiteActualValue: null,
          xmlActualValue: null,
          sourcePriorityUsed: 'INVESTING',
          forecastValue: forecast,
          previousValue: previous,
          revisedPreviousValue: null,
          status,
          surpriseValue: surprise,
          surprisePercentage: surprise,
          surpriseDirection: surprise == null ? null : surprise > 0 ? 'positive' : surprise < 0 ? 'negative' : 'neutral',
          bias,
          biasStrength,
          affectedPairs: affectedPairsForCurrency(currency),
          tradeRestrictionRequired: item.impactLevel === 'High' || item.impactLevel === 'Critical' || item.impactLevel === 'Medium',
          restrictionStartTime,
          restrictionEndTime,
          aiSummary: actual
            ? aiSummaryForEvent(item.eventName, currency, actual, forecast, previous, bias)
            : pendingSummaryForStatus(status),
          aiReasoning: actual ? 'Generated by deterministic economic surprise rule engine from real collected actual/forecast/previous values.' : null,
        };

        await this.upsertCollectedEvent(mergedEvent, { validationStatus: 'INVESTING_DIRECT', conflictStatus: 'NONE' });
        await this.insertSourceSnapshot(mergedEvent.id, 'Investing.com Calendar', mergedEvent.sourceUrl, {
          eventDate,
          utcEventTime: item.utcEventTime,
          currency,
          eventName: item.eventName,
          normalizedEventName,
          impactLevel: item.impactLevel,
          actualValue: actual,
          forecastValue: forecast,
          previousValue: previous,
        });

        if (actual) {
          capturedActuals += 1;
          await this.recordReleaseSnapshot({
            id: mergedEvent.id,
            actualValue: actual,
            forecastValue: forecast,
            previousValue: previous,
            revisedPreviousValue: null,
            sourceUrl: mergedEvent.sourceUrl,
          });
        }

        stored += 1;
      }

      const lifecycle = await this.reconcileReleaseLifecycle();
      await this.logSourceFetch(sourceName, props.jobType, 'SUCCESS', `Investing.com calendar sync stored=${stored} capturedActuals=${capturedActuals} range=${props.range.fromDate}..${props.range.toDate}.`, Date.now() - startedAt);
      return { stored, lifecycle, investingCount: investingCalendar.length, capturedActuals };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'investing_calendar_sync_failed';
      await this.logSourceFetch(sourceName, props.jobType, 'FAILED', message, Date.now() - startedAt);
      return { stored: 0, lifecycle: await this.reconcileReleaseLifecycle(), investingCount: 0, capturedActuals: 0, error: message };
    }
  }

  private async upsertCollectedEvent(event: CollectedEconomicEvent, meta: { validationStatus: string; conflictStatus: string }): Promise<void> {
    try {
      await queryPostgres(
        `INSERT INTO economic_events (
        id,
        source_name,
        source_url,
        event_key,
        event_name,
        normalized_event_name,
        country,
        currency,
        impact_level,
        event_date,
        event_time,
        event_timezone,
        local_event_time,
        utc_event_time,
        actual_value,
        actual_source,
        actual_capture_status,
        actual_captured_at,
        website_actual_value,
        xml_actual_value,
        source_priority_used,
        forecast_value,
        previous_value,
        revised_previous_value,
        status,
        surprise_value,
        surprise_percentage,
        surprise_direction,
        bias,
        bias_strength,
        affected_pairs,
        trade_restriction_required,
        restriction_start_time,
        restriction_end_time,
        ai_summary,
        ai_reasoning,
        source_reliability_score,
        validation_status,
        conflict_status,
        last_checked_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31::jsonb,$32,$33,$34,$35,$36,$37,$38,$39,now(),now()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        event_name = EXCLUDED.event_name,
        normalized_event_name = EXCLUDED.normalized_event_name,
        impact_level = EXCLUDED.impact_level,
        event_date = EXCLUDED.event_date,
        event_time = EXCLUDED.event_time,
        local_event_time = EXCLUDED.local_event_time,
        utc_event_time = EXCLUDED.utc_event_time,
        actual_value = COALESCE(EXCLUDED.actual_value, economic_events.actual_value),
        actual_source = CASE WHEN EXCLUDED.actual_value IS NOT NULL THEN EXCLUDED.actual_source ELSE economic_events.actual_source END,
        actual_capture_status = CASE
          WHEN economic_events.actual_value IS NOT NULL THEN economic_events.actual_capture_status
          WHEN EXCLUDED.actual_value IS NOT NULL THEN 'CAPTURED'
          ELSE EXCLUDED.actual_capture_status
        END,
        actual_captured_at = CASE WHEN EXCLUDED.actual_value IS NOT NULL THEN COALESCE(EXCLUDED.actual_captured_at, now()) ELSE economic_events.actual_captured_at END,
        website_actual_value = COALESCE(EXCLUDED.website_actual_value, economic_events.website_actual_value),
        xml_actual_value = COALESCE(EXCLUDED.xml_actual_value, economic_events.xml_actual_value),
        source_priority_used = COALESCE(EXCLUDED.source_priority_used, economic_events.source_priority_used),
        forecast_value = COALESCE(EXCLUDED.forecast_value, economic_events.forecast_value),
        previous_value = COALESCE(EXCLUDED.previous_value, economic_events.previous_value),
        revised_previous_value = COALESCE(EXCLUDED.revised_previous_value, economic_events.revised_previous_value),
        status = CASE
          WHEN economic_events.status IN ('ARCHIVED','ANALYZED') THEN economic_events.status
          ELSE EXCLUDED.status
        END,
        surprise_value = EXCLUDED.surprise_value,
        surprise_percentage = EXCLUDED.surprise_percentage,
        surprise_direction = EXCLUDED.surprise_direction,
        bias = EXCLUDED.bias,
        bias_strength = EXCLUDED.bias_strength,
        affected_pairs = EXCLUDED.affected_pairs,
        trade_restriction_required = EXCLUDED.trade_restriction_required,
        restriction_start_time = EXCLUDED.restriction_start_time,
        restriction_end_time = EXCLUDED.restriction_end_time,
        ai_summary = EXCLUDED.ai_summary,
        ai_reasoning = EXCLUDED.ai_reasoning,
        validation_status = EXCLUDED.validation_status,
        conflict_status = EXCLUDED.conflict_status,
        last_checked_at = now(),
        updated_at = now()`,
        [
        event.id,
        event.sourceName,
        event.sourceUrl,
        event.eventKey,
        event.eventName,
        event.normalizedEventName,
        event.country,
        event.currency,
        event.impactLevel,
        event.eventDate,
        event.eventTime,
        event.eventTimezone,
        event.utcEventTime,
        event.utcEventTime,
        event.actualValue,
        event.actualSource,
        event.actualCaptureStatus,
        event.actualCapturedAt,
        event.websiteActualValue,
        event.xmlActualValue,
        event.sourcePriorityUsed,
        event.forecastValue,
        event.previousValue,
        event.revisedPreviousValue,
        event.status,
        event.surpriseValue,
        event.surprisePercentage,
        event.surpriseDirection,
        event.bias,
        event.biasStrength,
        JSON.stringify(event.affectedPairs),
        event.tradeRestrictionRequired,
        event.restrictionStartTime,
        event.restrictionEndTime,
        event.aiSummary,
        event.aiReasoning,
        80,
        meta.validationStatus,
        meta.conflictStatus,
        ],
      );
    } catch (error) {
      const pgError = error as { code?: string };
      const status = String(event.status);
      const conflictStatus = String(meta.conflictStatus);
      if (pgError && pgError.code === '42703') {
        await queryPostgres(
          `INSERT INTO economic_events (
            id,
            source_name,
            source_url,
            event_key,
            event_name,
            normalized_event_name,
            country,
            currency,
            impact_level,
            event_date,
            event_time,
            event_timezone,
            local_event_time,
            utc_event_time,
            actual_value,
            forecast_value,
            previous_value,
            revised_previous_value,
            status,
            surprise_value,
            surprise_percentage,
            surprise_direction,
            bias,
            bias_strength,
            affected_pairs,
            trade_restriction_required,
            restriction_start_time,
            restriction_end_time,
            ai_summary,
            ai_reasoning,
            source_reliability_score,
            validation_status,
            conflict_status,
            last_checked_at,
            updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb,$26,$27,$28,$29,$30,$31,$32,$33,now(),now()
          )
          ON CONFLICT (id)
          DO UPDATE SET
            event_name = EXCLUDED.event_name,
            normalized_event_name = EXCLUDED.normalized_event_name,
            impact_level = EXCLUDED.impact_level,
            event_date = EXCLUDED.event_date,
            event_time = EXCLUDED.event_time,
            local_event_time = EXCLUDED.local_event_time,
            utc_event_time = EXCLUDED.utc_event_time,
            actual_value = COALESCE(EXCLUDED.actual_value, economic_events.actual_value),
            forecast_value = COALESCE(EXCLUDED.forecast_value, economic_events.forecast_value),
            previous_value = COALESCE(EXCLUDED.previous_value, economic_events.previous_value),
            revised_previous_value = COALESCE(EXCLUDED.revised_previous_value, economic_events.revised_previous_value),
            status = CASE
              WHEN economic_events.status IN ('ARCHIVED','ANALYZED') THEN economic_events.status
              ELSE EXCLUDED.status
            END,
            surprise_value = EXCLUDED.surprise_value,
            surprise_percentage = EXCLUDED.surprise_percentage,
            surprise_direction = EXCLUDED.surprise_direction,
            bias = EXCLUDED.bias,
            bias_strength = EXCLUDED.bias_strength,
            affected_pairs = EXCLUDED.affected_pairs,
            trade_restriction_required = EXCLUDED.trade_restriction_required,
            restriction_start_time = EXCLUDED.restriction_start_time,
            restriction_end_time = EXCLUDED.restriction_end_time,
            ai_summary = EXCLUDED.ai_summary,
            ai_reasoning = EXCLUDED.ai_reasoning,
            validation_status = EXCLUDED.validation_status,
            conflict_status = EXCLUDED.conflict_status,
            last_checked_at = now(),
            updated_at = now()`,
          [
            event.id,
            event.sourceName,
            event.sourceUrl,
            event.eventKey,
            event.eventName,
            event.normalizedEventName,
            event.country,
            event.currency,
            event.impactLevel,
            event.eventDate,
            event.eventTime,
            event.eventTimezone,
            event.utcEventTime,
            event.utcEventTime,
            event.actualValue,
            event.forecastValue,
            event.previousValue,
            event.revisedPreviousValue,
            event.status,
            event.surpriseValue,
            event.surprisePercentage,
            event.surpriseDirection,
            event.bias,
            event.biasStrength,
            JSON.stringify(event.affectedPairs),
            event.tradeRestrictionRequired,
            event.restrictionStartTime,
            event.restrictionEndTime,
            event.aiSummary,
            event.aiReasoning,
            80,
            meta.validationStatus,
            meta.conflictStatus,
          ],
        );
        return;
      }
      if (pgError && pgError.code === '23514' && (status === 'SOURCE_CONFLICT' || conflictStatus === 'SOURCE_CONFLICT')) {
        const fallbackEvent: CollectedEconomicEvent = { ...event, status: 'CONFLICTED' };
        const fallbackMeta = { ...meta, conflictStatus: 'CONFLICTED' };
        await this.upsertCollectedEvent(fallbackEvent, fallbackMeta);
        return;
      }
      throw error;
    }
  }

  private async insertSourceSnapshot(eventId: string, sourceName: string, sourceUrl: string, payload: Record<string, unknown>) {
    const snapshotHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    await queryPostgres(
      `INSERT INTO economic_event_source_snapshots (event_id, source_name, snapshot_hash, raw_payload)
       SELECT $1, $2, $3, $4::jsonb
       WHERE NOT EXISTS (
         SELECT 1
         FROM economic_event_source_snapshots
         WHERE event_id = $1 AND source_name = $2 AND snapshot_hash = $3
       )`,
      [eventId, sourceName, snapshotHash, JSON.stringify({ sourceUrl, ...payload })],
    );
  }

  private async insertConflict(eventId: string, fieldName: string, xmlValue: string | null, websiteValue: string | null) {
    await queryPostgres(
      `INSERT INTO economic_event_conflicts (event_id, conflict_type, field_name, source_a, value_a, source_b, value_b, preferred_source)
       SELECT $1, 'SOURCE_CONFLICT', $2, 'ForexFactory XML', $3, 'ForexFactory Website', $4, 'ForexFactory Website'
       WHERE ($3 IS DISTINCT FROM $4)
         AND NOT EXISTS (
           SELECT 1
           FROM economic_event_conflicts
           WHERE event_id = $1
             AND conflict_type = 'SOURCE_CONFLICT'
             AND field_name = $2
             AND value_a IS NOT DISTINCT FROM $3
             AND value_b IS NOT DISTINCT FROM $4
             AND resolution_status = 'OPEN'
         )`,
      [eventId, fieldName, xmlValue, websiteValue],
    );
  }

  private async dedupeForexFactoryDuplicates(): Promise<{ merged: number; deleted: number }> {
    const groups = await queryPostgres(
      `
      SELECT currency, normalized_event_name, event_date::text AS event_date, COALESCE(event_time::text, '') AS event_time, array_agg(id) AS ids
      FROM economic_events
      WHERE source_name = 'ForexFactory'
      GROUP BY currency, normalized_event_name, event_date, COALESCE(event_time::text, '')
      HAVING COUNT(*) > 1
      LIMIT 250
      `,
    );

    let merged = 0;
    let deleted = 0;

    for (const group of groups.rows) {
      const ids = Array.isArray(group.ids) ? group.ids.map(String) : [];
      if (ids.length < 2) continue;

      const rowsResult = await queryPostgres(
        `
        SELECT id, event_key, event_name, normalized_event_name, currency, event_date::text AS event_date, event_time::text AS event_time,
               utc_event_time::text AS utc_event_time,
               actual_value, forecast_value, previous_value, revised_previous_value,
               status, validation_status, conflict_status,
               updated_at::text AS updated_at
        FROM economic_events
        WHERE id = ANY($1::text[])
        `,
        [ids],
      );

      const rows = rowsResult.rows.map((row) => ({
        id: String(row.id),
        eventKey: String(row.event_key ?? ''),
        eventName: String(row.event_name ?? ''),
        normalizedEventName: String(row.normalized_event_name ?? ''),
        currency: String(row.currency ?? ''),
        eventDate: String(row.event_date ?? ''),
        eventTime: nullableString(row.event_time),
        utcEventTime: nullableString(row.utc_event_time),
        actualValue: nullableString(row.actual_value),
        forecastValue: nullableString(row.forecast_value),
        previousValue: nullableString(row.previous_value),
        revisedPreviousValue: nullableString(row.revised_previous_value),
        status: String(row.status ?? ''),
        validationStatus: String(row.validation_status ?? ''),
        conflictStatus: String(row.conflict_status ?? ''),
        updatedAt: String(row.updated_at ?? ''),
      }));

      const score = (row: (typeof rows)[number]) => {
        const hasActual = row.actualValue ? 1000 : 0;
        const isWebsite = row.validationStatus.toUpperCase().includes('WEBSITE') ? 100 : 0;
        const updated = Date.parse(row.updatedAt) || 0;
        return hasActual + isWebsite + Math.floor(updated / 1000);
      };

      rows.sort((a, b) => score(b) - score(a));
      const keep = rows[0];
      const drop = rows.slice(1);
      if (!keep || drop.length === 0) continue;

      const pick = (field: 'actualValue' | 'forecastValue' | 'previousValue' | 'revisedPreviousValue') => {
        for (const candidate of rows) {
          const value = candidate[field];
          if (value && String(value).trim() !== '') return String(value).trim();
        }
        return null;
      };

      const actual = pick('actualValue');
      const forecast = pick('forecastValue');
      const previous = pick('previousValue');
      const revised = pick('revisedPreviousValue');

      const mergedValidation = rows.some((r) => r.validationStatus.toUpperCase().includes('WEBSITE'))
        ? rows.some((r) => r.validationStatus.toUpperCase().includes('PROVISIONAL')) ? 'WEBSITE_PREFERRED' : 'WEBSITE_COLLECTED'
        : keep.validationStatus || 'PROVISIONAL';

      const mergedConflict = rows.some((r) => String(r.conflictStatus).toUpperCase().includes('CONFLICT')) ? 'SOURCE_CONFLICT' : 'NONE';

    const scheduled = keep.utcEventTime ? new Date(keep.utcEventTime) : null;
    const expectsRelease = Boolean(forecast || previous || revised);
      const nextStatus = keep.status === 'ARCHIVED' || keep.status === 'ANALYZED'
        ? keep.status
      : lifecycleStatusForCollectedEvent(scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled : null, actual, expectsRelease);

      await queryPostgres('BEGIN');
      try {
        await queryPostgres(
          `
          UPDATE economic_events
          SET actual_value = $2,
              forecast_value = $3,
              previous_value = $4,
              revised_previous_value = $5,
              validation_status = $6,
              conflict_status = $7,
              status = CASE WHEN status IN ('ARCHIVED','ANALYZED') THEN status ELSE $8 END,
              updated_at = now()
          WHERE id = $1
          `,
          [keep.id, actual, forecast, previous, revised, mergedValidation, mergedConflict, nextStatus],
        );

        for (const other of drop) {
          const otherId = other.id;
          await queryPostgres(`UPDATE economic_event_source_snapshots SET event_id = $1 WHERE event_id = $2`, [keep.id, otherId]);
          await queryPostgres(`UPDATE economic_event_conflicts SET event_id = $1 WHERE event_id = $2`, [keep.id, otherId]);
          await queryPostgres(`UPDATE economic_event_monitoring_jobs SET event_id = $1 WHERE event_id = $2`, [keep.id, otherId]);
          await queryPostgres(`UPDATE economic_trade_restriction_windows SET event_id = $1 WHERE event_id = $2`, [keep.id, otherId]);
          await queryPostgres(`UPDATE economic_event_releases SET event_id = $1 WHERE event_id = $2`, [keep.id, otherId]);
          await queryPostgres(`UPDATE economic_event_history SET event_id = $1 WHERE event_id = $2`, [keep.id, otherId]);

          await queryPostgres(`DELETE FROM economic_events WHERE id = $1`, [otherId]);
          deleted += 1;
        }

        merged += 1;
        await queryPostgres('COMMIT');
      } catch (error) {
        await queryPostgres('ROLLBACK');
        throw error;
      }
    }

    return { merged, deleted };
  }

  private async logSourceFetch(sourceName: string, jobType: string, status: string, message: string, durationMs: number, httpStatus?: number): Promise<void> {
    await queryPostgres(
      `INSERT INTO source_fetch_logs (source_name, job_type, status, http_status, message, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sourceName, jobType, status, httpStatus ?? null, message, durationMs],
    );
  }

  private async reconcileReleaseLifecycle(): Promise<LifecycleReconciliation> {
    const preMonitoring = await queryPostgres(`
      UPDATE economic_events
      SET status = 'PRE_MONITORING',
          ai_summary = COALESCE(ai_summary, 'Awaiting release. Cacsms Trader is preparing monitoring and trade protection for this event.'),
          updated_at = now()
      WHERE actual_value IS NULL
        AND utc_event_time IS NOT NULL
        AND utc_event_time > now()
        AND utc_event_time <= now() + interval '60 minutes'
        AND (forecast_value IS NOT NULL OR previous_value IS NOT NULL OR revised_previous_value IS NOT NULL)
        AND validation_status <> 'PROVISIONAL'
        AND status NOT IN ('ARCHIVED','ANALYZED','RELEASED','CONFLICTED','SOURCE_CONFLICT')
      RETURNING id
    `);

    const watching = await queryPostgres(`
      UPDATE economic_events
      SET status = 'WATCHING',
          ai_summary = 'Actual value is not captured yet. Cacsms Trader is actively watching enabled real data sources and will not invent a result.',
          ai_reasoning = NULL,
          updated_at = now()
      WHERE actual_value IS NULL
        AND utc_event_time IS NOT NULL
        AND utc_event_time <= now()
        AND utc_event_time >= now() - interval '24 hours'
        AND (forecast_value IS NOT NULL OR previous_value IS NOT NULL OR revised_previous_value IS NOT NULL)
        AND validation_status <> 'PROVISIONAL'
        AND status NOT IN ('ARCHIVED','ANALYZED','RELEASED','CONFLICTED','SOURCE_CONFLICT')
      RETURNING id
    `);

    const failed = await queryPostgres(`
      UPDATE economic_events
      SET status = 'FAILED',
          ai_summary = 'Release window passed but no actual value was captured from enabled real data sources. Retry collection or add a confirmed source.',
          ai_reasoning = NULL,
          updated_at = now()
      WHERE actual_value IS NULL
        AND utc_event_time IS NOT NULL
        AND utc_event_time < now() - interval '24 hours'
        AND (forecast_value IS NOT NULL OR previous_value IS NOT NULL OR revised_previous_value IS NOT NULL)
        AND validation_status <> 'PROVISIONAL'
        AND status NOT IN ('ARCHIVED','ANALYZED','RELEASED','CONFLICTED','SOURCE_CONFLICT')
      RETURNING id
    `);

    await queryPostgres(`
      UPDATE economic_events
      SET status = 'ARCHIVED',
          archived_at = COALESCE(archived_at, now()),
          ai_summary = 'This event does not publish a numerical actual/forecast/previous release on the primary calendar source. Cacsms Trader will not invent values and will archive the event after it passes.',
          ai_reasoning = NULL,
          updated_at = now()
      WHERE actual_value IS NULL
        AND utc_event_time IS NOT NULL
        AND utc_event_time < now() - interval '30 minutes'
        AND forecast_value IS NULL
        AND previous_value IS NULL
        AND revised_previous_value IS NULL
        AND status NOT IN ('ARCHIVED')
    `);

    const watcherJobs = await queryPostgres(`
      INSERT INTO economic_event_monitoring_jobs (event_id, job_type, status, run_after)
      SELECT
        event.id,
        'release_watcher',
        'QUEUED',
        GREATEST(now(), event.utc_event_time - interval '5 minutes')
      FROM economic_events event
      WHERE event.actual_value IS NULL
        AND event.utc_event_time IS NOT NULL
        AND event.utc_event_time >= now() - interval '6 hours'
        AND event.utc_event_time <= now() + interval '24 hours'
        AND (event.forecast_value IS NOT NULL OR event.previous_value IS NOT NULL OR event.revised_previous_value IS NOT NULL)
        AND event.validation_status <> 'PROVISIONAL'
        AND event.status NOT IN ('ARCHIVED','ANALYZED','RELEASED','CONFLICTED','SOURCE_CONFLICT')
        AND NOT EXISTS (
          SELECT 1
          FROM economic_event_monitoring_jobs job
          WHERE job.event_id = event.id
            AND job.job_type = 'release_watcher'
            AND job.status IN ('QUEUED','RUNNING')
        )
      RETURNING id
    `);

    await queryPostgres(`
      INSERT INTO scrape_error_logs (source_name, error_type, message, url, raw_context)
      SELECT source_name,
             'missing_actual_after_release',
             'Event release time has passed but actual value is still missing from enabled real data sources.',
             source_url,
             json_build_object('eventId', id, 'eventName', event_name, 'currency', currency, 'utcEventTime', utc_event_time, 'status', status)::text
      FROM economic_events
      WHERE actual_value IS NULL
        AND status IN ('WATCHING','FAILED')
        AND (forecast_value IS NOT NULL OR previous_value IS NOT NULL OR revised_previous_value IS NOT NULL)
        AND validation_status <> 'PROVISIONAL'
        AND utc_event_time >= now() - interval '7 days'
        AND last_checked_at >= now() - interval '10 minutes'
        AND NOT EXISTS (
          SELECT 1
          FROM scrape_error_logs log
          WHERE log.error_type = 'missing_actual_after_release'
            AND log.raw_context LIKE '%' || economic_events.id || '%'
            AND log.created_at >= now() - interval '6 hours'
        )
      LIMIT 25
    `);

    return {
      preMonitoring: preMonitoring.rows.length,
      watching: watching.rows.length,
      failed: failed.rows.length,
      watcherJobsQueued: watcherJobs.rows.length,
    };
  }

  async processDueMonitoringJobs(props: { maxJobs?: number } = {}) {
    const maxJobs = Math.max(1, Math.min(10, props.maxJobs ?? 1));

    const claimed = await queryPostgres(
      `
      WITH due AS (
        SELECT id
        FROM economic_event_monitoring_jobs
        WHERE status = 'QUEUED'
          AND run_after <= now()
        ORDER BY run_after ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE economic_event_monitoring_jobs job
      SET status = 'RUNNING',
          attempts = job.attempts + 1,
          updated_at = now()
      FROM due
      WHERE job.id = due.id
      RETURNING job.id::text AS id, job.event_id, job.job_type, job.attempts
      `,
      [maxJobs],
    );

    let processed = 0;
    let completed = 0;
    let rescheduled = 0;
    let analyzed = 0;
    let archived = 0;
    let restrictionsUpserted = 0;

    for (const row of claimed.rows) {
      processed += 1;
      const jobId = String(row.id);
      const eventId = String(row.event_id ?? '');
      const jobType = String(row.job_type ?? '');

      try {
        if (!eventId) {
          await this.failMonitoringJob(jobId, 'missing_event_id');
          continue;
        }

        const event = await this.loadEventForMonitoring(eventId);
        if (!event) {
          await this.failMonitoringJob(jobId, 'event_not_found');
          continue;
        }

        let refreshed = await this.loadEventForMonitoring(eventId);
        if (!refreshed) {
          await this.failMonitoringJob(jobId, 'event_not_found_after_refresh');
          continue;
        }

        restrictionsUpserted += await this.upsertTradeRestrictionWindow(refreshed);

        if (jobType === 'release_watcher') {
          try {
            await this.captureActualFromWebsite(eventId);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'release_watcher_capture_failed';
            await queryPostgres(
              `INSERT INTO scrape_error_logs (source_name, error_type, message)
               VALUES ($1, $2, $3)`,
              ['Economic Calendar Worker', 'release_watcher_capture_failed', message],
            );
          }
          const afterCapture = await this.loadEventForMonitoring(eventId);
          if (afterCapture) refreshed = afterCapture;
        }

        if (refreshed.actualValue) {
          await this.recordReleaseSnapshot(refreshed);
          const analyzeResult = await this.analyzeIfReady(refreshed);
          analyzed += analyzeResult.analyzed ? 1 : 0;
          if (analyzeResult.analyzed) {
            const analyzedEvent = await this.loadEventForMonitoring(eventId);
            if (analyzedEvent) {
              archived += (await this.archiveIfReady(analyzedEvent)) ? 1 : 0;
            }
          }
          await this.completeMonitoringJob(jobId);
          completed += 1;
          continue;
        }

        const nextRunAt = nextMonitoringRunAfter({
          now: new Date(),
          utcEventTime: refreshed.utcEventTime,
        });

        if (!nextRunAt) {
          await this.failMonitoringJob(jobId, 'stale_missing_actual');
          continue;
        }

        await queryPostgres(
          `UPDATE economic_event_monitoring_jobs
           SET status = 'QUEUED',
               run_after = $2,
               last_error = NULL,
               updated_at = now()
           WHERE id = $1::uuid`,
          [jobId, nextRunAt.toISOString()],
        );
        rescheduled += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'job_failed';
        await this.failMonitoringJob(jobId, message);
      }
    }

    return { processed, completed, rescheduled, analyzed, archived, restrictionsUpserted };
  }

  private async loadEventForMonitoring(eventId: string): Promise<{
    id: string;
    eventName: string;
    currency: string;
    impactLevel: EconomicImpactLevel;
    utcEventTime: string | null;
    actualValue: string | null;
    forecastValue: string | null;
    previousValue: string | null;
    revisedPreviousValue: string | null;
    bias: EconomicBias;
    biasStrength: number;
    tradeRestrictionRequired: boolean;
    restrictionStartTime: string | null;
    restrictionEndTime: string | null;
    status: EconomicEventStatus;
    sourceUrl: string | null;
  } | null> {
    const result = await queryPostgres(
      `
      SELECT
        id,
        event_name,
        currency,
        impact_level,
        utc_event_time::text AS utc_event_time,
        actual_value,
        forecast_value,
        previous_value,
        revised_previous_value,
        bias,
        bias_strength,
        trade_restriction_required,
        restriction_start_time::text AS restriction_start_time,
        restriction_end_time::text AS restriction_end_time,
        status,
        source_url
      FROM economic_events
      WHERE id = $1
      LIMIT 1
      `,
      [eventId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      eventName: String(row.event_name),
      currency: String(row.currency),
      impactLevel: String(row.impact_level) as EconomicImpactLevel,
      utcEventTime: nullableString(row.utc_event_time),
      actualValue: nullableString(row.actual_value),
      forecastValue: nullableString(row.forecast_value),
      previousValue: nullableString(row.previous_value),
      revisedPreviousValue: nullableString(row.revised_previous_value),
      bias: String(row.bias) as EconomicBias,
      biasStrength: Number(row.bias_strength ?? 0),
      tradeRestrictionRequired: Boolean(row.trade_restriction_required),
      restrictionStartTime: nullableString(row.restriction_start_time),
      restrictionEndTime: nullableString(row.restriction_end_time),
      status: String(row.status) as EconomicEventStatus,
      sourceUrl: nullableString(row.source_url),
    };
  }

  private async loadEventForActualCapture(eventId: string): Promise<{
    id: string;
    eventKey: string;
    eventDate: string;
    eventTime: string | null;
    utcEventTime: string | null;
    currency: string;
    eventName: string;
    normalizedEventName: string;
    forecastValue: string | null;
    previousValue: string | null;
    revisedPreviousValue: string | null;
  } | null> {
    const result = await queryPostgres(
      `
      SELECT
        id,
        event_key,
        event_date::text AS event_date,
        event_time::text AS event_time,
        utc_event_time::text AS utc_event_time,
        currency,
        event_name,
        normalized_event_name,
        forecast_value,
        previous_value,
        revised_previous_value
      FROM economic_events
      WHERE id = $1
      LIMIT 1
      `,
      [eventId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      eventKey: String(row.event_key),
      eventDate: String(row.event_date),
      eventTime: nullableString(row.event_time),
      utcEventTime: nullableString(row.utc_event_time),
      currency: String(row.currency),
      eventName: String(row.event_name),
      normalizedEventName: String(row.normalized_event_name),
      forecastValue: nullableString(row.forecast_value),
      previousValue: nullableString(row.previous_value),
      revisedPreviousValue: nullableString(row.revised_previous_value),
    };
  }

  private async completeMonitoringJob(jobId: string) {
    await queryPostgres(
      `UPDATE economic_event_monitoring_jobs
       SET status = 'DONE',
           updated_at = now()
       WHERE id = $1::uuid`,
      [jobId],
    );
  }

  private async failMonitoringJob(jobId: string, message: string) {
    await queryPostgres(
      `UPDATE economic_event_monitoring_jobs
       SET status = 'FAILED',
           last_error = $2,
           updated_at = now()
       WHERE id = $1::uuid`,
      [jobId, message],
    );
    await queryPostgres(
      `INSERT INTO scrape_error_logs (source_name, error_type, message)
       VALUES ($1, $2, $3)`,
      ['Economic Calendar Worker', 'monitoring_job_failed', message],
    );
  }

  private async upsertTradeRestrictionWindow(event: { id: string; currency: string; impactLevel: EconomicImpactLevel; utcEventTime: string | null; tradeRestrictionRequired: boolean }) {
    if (!event.tradeRestrictionRequired) return 0;
    if (!event.utcEventTime) return 0;
    if (event.impactLevel !== 'High' && event.impactLevel !== 'Critical') return 0;

    const restriction = restrictionWindowForImpact(event.impactLevel);
    if (restriction.beforeMinutes <= 0 && restriction.afterMinutes <= 0) return 0;

    const release = new Date(event.utcEventTime);
    if (Number.isNaN(release.getTime())) return 0;

    const startsAt = new Date(release.getTime() - restriction.beforeMinutes * 60_000);
    const endsAt = new Date(release.getTime() + restriction.afterMinutes * 60_000);
    const affectedPairs = affectedPairsForCurrency(event.currency);

    const inserted = await queryPostgres(
      `
      INSERT INTO economic_trade_restriction_windows (event_id, currency, affected_pairs, restriction_level, starts_at, ends_at, reason, active)
      SELECT $1, $2, $3::jsonb, $4, $5, $6, $7, true
      WHERE NOT EXISTS (
        SELECT 1
        FROM economic_trade_restriction_windows
        WHERE event_id = $1
          AND currency = $2
          AND starts_at = $5
          AND ends_at = $6
      )
      RETURNING id
      `,
      [event.id, event.currency, JSON.stringify(affectedPairs), event.impactLevel, startsAt.toISOString(), endsAt.toISOString(), `Autonomous protection window for ${event.impactLevel} impact release.`],
    );

    return inserted.rows.length;
  }

  private async recordReleaseSnapshot(event: { id: string; actualValue: string | null; forecastValue: string | null; previousValue: string | null; revisedPreviousValue: string | null; sourceUrl: string | null }) {
    if (!event.actualValue) return;
    await queryPostgres(
      `
      INSERT INTO economic_event_releases (event_id, actual_value, forecast_value, previous_value, revised_previous_value, source_name, raw_payload)
      SELECT $1, $2, $3, $4, $5, $6, $7::jsonb
      WHERE NOT EXISTS (
        SELECT 1
        FROM economic_event_releases
        WHERE event_id = $1
          AND actual_value IS NOT DISTINCT FROM $2
          AND forecast_value IS NOT DISTINCT FROM $3
          AND previous_value IS NOT DISTINCT FROM $4
          AND revised_previous_value IS NOT DISTINCT FROM $5
          AND collected_at >= now() - interval '2 hours'
      )
      `,
      [
        event.id,
        event.actualValue,
        event.forecastValue,
        event.previousValue,
        event.revisedPreviousValue,
        'Investing.com Calendar',
        JSON.stringify({ sourceUrl: event.sourceUrl ?? investingCalendarUrl }),
      ],
    );
  }

  private async captureActualsForTodayFromInvesting(): Promise<{ matched: number; captured: number; pending: number; failed: number }> {
    const targets = await queryPostgres(
      `
      SELECT
        id,
        event_key,
        event_date::text AS event_date,
        event_time::text AS event_time,
        utc_event_time::text AS utc_event_time,
        currency,
        event_name,
        normalized_event_name,
        forecast_value,
        previous_value,
        revised_previous_value
      FROM economic_events
      WHERE currency = ANY($1::text[])
        AND actual_value IS NULL
        AND utc_event_time IS NOT NULL
        AND utc_event_time >= now() - interval '6 hours'
        AND utc_event_time <= now() + interval '24 hours'
      ORDER BY utc_event_time ASC
      LIMIT 200
      `,
      [[...REQUIRED_CURRENCIES]],
    );

    const dates = targets.rows
      .map((row) => String(row.event_date))
      .filter((value) => value)
      .sort();
    const fromDate = dates[0] ?? new Date().toISOString().slice(0, 10);
    const toDate = dates[dates.length - 1] ?? fromDate;
    const investingEvents = await scrapeInvestingEconomicCalendarRange({ fromDate, toDate });

    let matched = 0;
    let captured = 0;
    let pending = 0;
    let failed = 0;

    for (const row of targets.rows) {
      const eventId = String(row.id);
      const eventName = String(row.event_name ?? '');
      const currency = String(row.currency ?? '');
      const eventDate = String(row.event_date ?? '');
      const normalizedEventName = String(row.normalized_event_name ?? '');
      const utcEventTime = nullableString(row.utc_event_time);

      const match = findBestInvestingCalendarMatch({ currency, eventDate, normalizedEventName, utcEventTime, eventName }, investingEvents);
      if (!match) {
        failed += 1;
        continue;
      }

      matched += 1;
      const actual = normalizeActualValue(cleanValue(match.actualValue ?? null));
      const forecast = cleanValue(match.forecastValue ?? null);
      const previous = cleanValue(match.previousValue ?? null);

      if (!actual) {
        pending += 1;
        try {
          await queryPostgres(
            `UPDATE economic_events
             SET actual_capture_status = 'PENDING',
                 actual_source = 'NONE',
                 forecast_value = COALESCE($2, forecast_value),
                 previous_value = COALESCE($3, previous_value),
                 last_checked_at = now(),
                 updated_at = now()
             WHERE id = $1`,
            [eventId, forecast, previous],
          );
        } catch (error) {
          const pgError = error as { code?: string };
          if (!pgError || pgError.code !== '42703') throw error;
          await queryPostgres(
            `UPDATE economic_events
             SET forecast_value = COALESCE($2, forecast_value),
                 previous_value = COALESCE($3, previous_value),
                 last_checked_at = now(),
                 updated_at = now()
             WHERE id = $1`,
            [eventId, forecast, previous],
          );
        }
        continue;
      }

      captured += 1;
      try {
        await queryPostgres(
          `UPDATE economic_events
           SET actual_value = $2,
               actual_source = 'INVESTING',
               actual_capture_status = 'CAPTURED',
               actual_captured_at = now(),
               status = CASE WHEN status IN ('ARCHIVED','ANALYZED') THEN status ELSE 'RELEASED' END,
               forecast_value = COALESCE($3, forecast_value),
               previous_value = COALESCE($4, previous_value),
               source_priority_used = 'INVESTING',
               last_checked_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [eventId, actual, forecast, previous],
        );
      } catch (error) {
        const pgError = error as { code?: string };
        if (!pgError || pgError.code !== '42703') throw error;
        await queryPostgres(
          `UPDATE economic_events
           SET actual_value = $2,
               status = CASE WHEN status IN ('ARCHIVED','ANALYZED') THEN status ELSE 'RELEASED' END,
               forecast_value = COALESCE($3, forecast_value),
               previous_value = COALESCE($4, previous_value),
               last_checked_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [eventId, actual, forecast, previous],
        );
      }

      await this.recordReleaseSnapshot({
        id: eventId,
        actualValue: actual,
        forecastValue: forecast,
        previousValue: previous,
        revisedPreviousValue: nullableString(row.revised_previous_value),
        sourceUrl: investingCalendarUrl,
      });
    }

    return { matched, captured, pending, failed };
  }

  private async analyzeIfReady(event: { id: string; eventName: string; currency: string; actualValue: string | null; forecastValue: string | null; previousValue: string | null; revisedPreviousValue: string | null }) {
    if (!event.actualValue) return { analyzed: false };
    const baseline = event.revisedPreviousValue ?? event.previousValue;
    const hasComparable = Boolean(event.forecastValue || baseline);
    if (!hasComparable) return { analyzed: false };

    const surprise = computeSurprise(event.actualValue, event.forecastValue, event.eventName);
    const bias = classifyBias(event.eventName, surprise);
    const biasStrength = biasScore(bias);

    await queryPostgres(
      `
      UPDATE economic_events
      SET status = 'ANALYZED',
          bias = $2,
          bias_strength = $3,
          surprise_value = $4,
          surprise_percentage = $4,
          surprise_direction = CASE WHEN $4 IS NULL THEN NULL WHEN $4 > 0 THEN 'positive' WHEN $4 < 0 THEN 'negative' ELSE 'neutral' END,
          ai_summary = $5,
          ai_reasoning = $6,
          updated_at = now()
      WHERE id = $1
        AND status NOT IN ('ARCHIVED')
      `,
      [
        event.id,
        bias,
        biasStrength,
        surprise,
        aiSummaryForEvent(event.eventName, event.currency, event.actualValue, event.forecastValue, baseline, bias),
        'Generated by deterministic economic surprise rule engine from real collected actual/forecast/previous values.',
      ],
    );

    return { analyzed: true };
  }

  private async archiveIfReady(event: { id: string; status: EconomicEventStatus; bias: EconomicBias; biasStrength: number; utcEventTime: string | null }) {
    const status = String(event.status);
    if (status !== 'ANALYZED') return false;

    await queryPostgres(
      `INSERT INTO economic_event_history (event_id, currency_bias, bias_score)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM economic_event_history WHERE event_id = $1
       )`,
      [event.id, event.bias, event.biasStrength],
    );

    await queryPostgres(
      `UPDATE economic_events
       SET status = 'ARCHIVED',
           archived_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [event.id],
    );

    return true;
  }

  private async listEvents(): Promise<EconomicCalendarEventView[]> {
    let result: { rows: any[] };
    try {
      result = await queryPostgres(`
        SELECT
          id,
          source_id::text AS source_id,
          source_name,
          source_url,
          event_key,
          event_name,
          normalized_event_name,
          country,
          currency,
          impact_level,
          event_date::text AS event_date,
          event_time::text AS event_time,
          event_timezone,
          local_event_time::text AS local_event_time,
          utc_event_time::text AS utc_event_time,
          broker_event_time::text AS broker_event_time,
          actual_value,
          actual_source,
          actual_capture_status,
          actual_captured_at::text AS actual_captured_at,
          website_actual_value,
          xml_actual_value,
          source_priority_used,
          forecast_value,
          previous_value,
          revised_previous_value,
          unit,
          status,
          surprise_value,
          surprise_percentage,
          surprise_direction,
          bias,
          bias_strength,
          affected_pairs,
          trade_restriction_required,
          restriction_start_time::text AS restriction_start_time,
          restriction_end_time::text AS restriction_end_time,
          ai_summary,
          ai_reasoning,
          source_reliability_score,
          validation_status,
          conflict_status,
          last_checked_at::text AS last_checked_at,
          created_at::text AS created_at,
          updated_at::text AS updated_at,
          archived_at::text AS archived_at
        FROM economic_events
        WHERE currency = ANY($1::text[])
          AND source_name <> 'ForexFactory'
          AND (utc_event_time IS NULL OR utc_event_time >= now() - interval '14 days')
        ORDER BY COALESCE(utc_event_time, created_at) ASC
        LIMIT 500
      `, [[...REQUIRED_CURRENCIES]]);
    } catch (error) {
      const pgError = error as { code?: string };
      if (pgError && pgError.code === '42703') {
        result = await queryPostgres(`
          SELECT
            id,
            source_id::text AS source_id,
            source_name,
            source_url,
            event_key,
            event_name,
            normalized_event_name,
            country,
            currency,
            impact_level,
            event_date::text AS event_date,
            event_time::text AS event_time,
            event_timezone,
            local_event_time::text AS local_event_time,
            utc_event_time::text AS utc_event_time,
            broker_event_time::text AS broker_event_time,
            actual_value,
            forecast_value,
            previous_value,
            revised_previous_value,
            unit,
            status,
            surprise_value,
            surprise_percentage,
            surprise_direction,
            bias,
            bias_strength,
            affected_pairs,
            trade_restriction_required,
            restriction_start_time::text AS restriction_start_time,
            restriction_end_time::text AS restriction_end_time,
            ai_summary,
            ai_reasoning,
            source_reliability_score,
            validation_status,
            conflict_status,
            last_checked_at::text AS last_checked_at,
            created_at::text AS created_at,
            updated_at::text AS updated_at,
            archived_at::text AS archived_at
          FROM economic_events
          WHERE currency = ANY($1::text[])
            AND source_name <> 'ForexFactory'
            AND (utc_event_time IS NULL OR utc_event_time >= now() - interval '14 days')
          ORDER BY COALESCE(utc_event_time, created_at) ASC
          LIMIT 500
        `, [[...REQUIRED_CURRENCIES]]);
      } else {
        throw error;
      }
    }

    return result.rows.map((row) => ({
      id: String(row.id),
      sourceId: nullableString(row.source_id),
      sourceName: String(row.source_name),
      sourceUrl: nullableString(row.source_url),
      eventKey: String(row.event_key),
      eventName: String(row.event_name),
      normalizedEventName: String(row.normalized_event_name),
      country: String(row.country),
      currency: String(row.currency),
      impactLevel: String(row.impact_level) as EconomicImpactLevel,
      eventDate: String(row.event_date),
      eventTime: nullableString(row.event_time),
      sourceTimezone: String(row.event_timezone),
      localEventTime: nullableString(row.local_event_time),
      utcEventTime: nullableString(row.utc_event_time),
      brokerEventTime: nullableString(row.broker_event_time),
      actualValue: nullableString(row.actual_value),
      actualSource: nullableString(row.actual_source),
      actualCaptureStatus: nullableString(row.actual_capture_status),
      actualCapturedAt: nullableString(row.actual_captured_at),
      websiteActualValue: nullableString(row.website_actual_value),
      xmlActualValue: nullableString(row.xml_actual_value),
      sourcePriorityUsed: nullableString(row.source_priority_used),
      forecastValue: nullableString(row.forecast_value),
      previousValue: nullableString(row.previous_value),
      revisedPreviousValue: nullableString(row.revised_previous_value),
      unit: nullableString(row.unit),
      status: String(row.status) as EconomicEventStatus,
      surpriseValue: nullableNumber(row.surprise_value),
      surprisePercentage: nullableNumber(row.surprise_percentage),
      surpriseDirection: nullableString(row.surprise_direction),
      bias: String(row.bias) as EconomicBias,
      biasStrength: Number(row.bias_strength ?? 0),
      affectedPairs: Array.isArray(row.affected_pairs) ? row.affected_pairs.map(String) : [],
      tradeRestrictionRequired: Boolean(row.trade_restriction_required),
      restrictionStartTime: nullableString(row.restriction_start_time),
      restrictionEndTime: nullableString(row.restriction_end_time),
      aiSummary: nullableString(row.ai_summary),
      aiReasoning: nullableString(row.ai_reasoning),
      sourceReliabilityScore: Number(row.source_reliability_score ?? 0),
      validationStatus: String(row.validation_status),
      conflictStatus: String(row.conflict_status),
      lastCheckedAt: nullableString(row.last_checked_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      archivedAt: nullableString(row.archived_at),
    }));
  }

  private async listSources(): Promise<EconomicSourceView[]> {
    const result = await queryPostgres(`
      SELECT
        id::text,
        source_name,
        source_type,
        source_url,
        priority,
        enabled,
        requires_credentials,
        reliability_score,
        successful_fetch_count,
        failed_fetch_count,
        conflict_count,
        last_success_at::text AS last_success_at,
        last_failure_at::text AS last_failure_at,
        last_checked_at::text AS last_checked_at,
        terms_policy
      FROM economic_sources
      ORDER BY priority ASC, source_name ASC
    `);

    return result.rows.map((row) => {
      const enabled = Boolean(row.enabled);
      const failed = Number(row.failed_fetch_count ?? 0);
      const reliabilityScore = Number(row.reliability_score ?? 0);
      const lastSuccessAt = nullableString(row.last_success_at);
      const lastFailureAt = nullableString(row.last_failure_at);
      const latestSuccessWins = lastSuccessAt && (!lastFailureAt || new Date(lastSuccessAt).getTime() >= new Date(lastFailureAt).getTime());
      return {
        id: String(row.id),
        sourceName: String(row.source_name),
        sourceType: String(row.source_type),
        sourceUrl: String(row.source_url),
        priority: Number(row.priority ?? 100),
        enabled,
        requiresCredentials: Boolean(row.requires_credentials),
        reliabilityScore,
        successfulFetchCount: Number(row.successful_fetch_count ?? 0),
        failedFetchCount: failed,
        conflictCount: Number(row.conflict_count ?? 0),
        lastSuccessAt,
        lastFailureAt,
        lastCheckedAt: nullableString(row.last_checked_at),
        status: !enabled ? 'disabled' : latestSuccessWins ? 'ok' : reliabilityScore >= 80 ? 'ok' : failed > 0 ? 'failed' : String(row.terms_policy) === 'review_required' ? 'needs_review' : 'degraded',
      };
    });
  }

  private async listConflicts() {
    const result = await queryPostgres(`
      SELECT id::text, event_id, conflict_type, field_name, source_a, value_a, source_b, value_b, created_at::text AS created_at
      FROM economic_event_conflicts
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return result.rows.map((row) => ({
      id: String(row.id),
      eventId: nullableString(row.event_id),
      conflictType: String(row.conflict_type),
      fieldName: String(row.field_name),
      sourceA: String(row.source_a),
      valueA: nullableString(row.value_a),
      sourceB: String(row.source_b),
      valueB: nullableString(row.value_b),
      createdAt: String(row.created_at),
    }));
  }

  private async listSourceLogs() {
    const result = await queryPostgres(`
      SELECT id::text, source_name, job_type, status, message, fetched_at::text AS fetched_at
      FROM source_fetch_logs
      ORDER BY fetched_at DESC
      LIMIT 100
    `);
    return result.rows.map((row) => ({
      id: String(row.id),
      sourceName: String(row.source_name),
      jobType: String(row.job_type),
      status: String(row.status),
      message: nullableString(row.message),
      fetchedAt: String(row.fetched_at),
    }));
  }

  private async countActiveRestrictions(): Promise<number> {
    const result = await queryPostgres(`
      SELECT COUNT(*)::int AS count
      FROM economic_trade_restriction_windows
      WHERE active = true AND now() BETWEEN starts_at AND ends_at
    `);
    return Number(result.rows[0]?.count ?? 0);
  }

  private computeCurrencyBias(events: EconomicCalendarEventView[]) {
    const grouped = new Map<string, { score: number; eventCount: number }>();
    for (const event of events) {
      if (!isToday(event.utcEventTime) && !isToday(event.localEventTime)) continue;
      const current = grouped.get(event.currency) ?? { score: 0, eventCount: 0 };
      current.score += event.biasStrength;
      current.eventCount += 1;
      grouped.set(event.currency, current);
    }

    return Array.from(grouped.entries())
      .map(([currency, value]) => ({
        currency,
        score: Math.max(-100, Math.min(100, value.score)),
        bias: biasFromScore(value.score),
        eventCount: value.eventCount,
      }))
      .sort((a, b) => b.score - a.score);
  }
}

type ForexFactoryMergeConflict = {
  fieldName: string;
  xmlValue: string | null;
  websiteValue: string | null;
  preferredValue: string | null;
};

type ForexFactoryMergedItem = {
  event: CollectedEconomicEvent;
  validationStatus: string;
  conflictStatus: string;
  xmlSnapshot?: Record<string, unknown>;
  websiteSnapshot?: Record<string, unknown>;
  conflicts: ForexFactoryMergeConflict[];
};

function mergeForexFactorySources(props: { xmlEvents: CollectedEconomicEvent[]; browserEvents: CollectedEconomicEvent[] }): { merged: ForexFactoryMergedItem[]; conflictCount: number } {
  const xmlMap = new Map<string, CollectedEconomicEvent>();
  const webMap = new Map<string, CollectedEconomicEvent>();

  for (const event of props.xmlEvents) xmlMap.set(event.eventKey, event);
  for (const event of props.browserEvents) webMap.set(event.eventKey, event);

  const keys = new Set<string>([...xmlMap.keys(), ...webMap.keys()]);
  let conflictCount = 0;

  const merged: ForexFactoryMergedItem[] = [];
  for (const key of keys) {
    const xml = xmlMap.get(key) ?? null;
    const web = webMap.get(key) ?? null;
    const base = web ?? xml;
    if (!base) continue;

    const conflicts: ForexFactoryMergeConflict[] = [];
    const compare = (fieldName: string, xmlValue: string | null, webValue: string | null) => {
      if (xmlValue == null || webValue == null) return;
      if (xmlValue.trim() === webValue.trim()) return;
      conflictCount += 1;
      conflicts.push({ fieldName, xmlValue, websiteValue: webValue, preferredValue: webValue });
    };

    compare('actual_value', xml?.xmlActualValue ?? null, web?.websiteActualValue ?? null);
    compare('forecast_value', xml?.forecastValue ?? null, web?.forecastValue ?? null);
    compare('previous_value', xml?.previousValue ?? null, web?.previousValue ?? null);
    compare('revised_previous_value', xml?.revisedPreviousValue ?? null, web?.revisedPreviousValue ?? null);

    const actualValue = normalizeActualValue(cleanValue(web?.websiteActualValue ?? null));
    const forecastValue = cleanValue(web?.forecastValue ?? null) ?? cleanValue(xml?.forecastValue ?? null);
    const previousValue = cleanValue(web?.previousValue ?? null) ?? cleanValue(xml?.previousValue ?? null);
    const revisedPreviousValue = cleanValue(web?.revisedPreviousValue ?? null) ?? cleanValue(xml?.revisedPreviousValue ?? null);

    const utcEventTime = web?.utcEventTime ?? xml?.utcEventTime ?? null;
    const scheduled = utcEventTime ? new Date(utcEventTime) : null;
    const impact = web?.impactLevel ?? xml?.impactLevel ?? base.impactLevel;
    const expectsRelease = Boolean(forecastValue || previousValue || revisedPreviousValue);
    const statusCore = lifecycleStatusForCollectedEvent(scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled : null, actualValue, expectsRelease);

    const conflictStatus = conflicts.length ? 'SOURCE_CONFLICT' : 'NONE';
    const status: EconomicEventStatus = conflicts.length ? 'SOURCE_CONFLICT' : statusCore;

    const normalizedEventName = base.normalizedEventName;
    const eventDate = base.eventDate;
    const eventTime = base.eventTime;
    const eventKey = deterministicEventKey(base.currency, normalizedEventName, eventDate, eventTime);

    const mergedEvent: CollectedEconomicEvent = {
      ...base,
      id: `evt_${eventKey}`,
      eventKey,
      sourceName: 'ForexFactory',
      sourceUrl: forexFactoryCalendarUrl,
      sourceType: web ? ('website' as const) : ('xml' as const),
      eventName: web?.eventName ?? xml?.eventName ?? base.eventName,
      country: web?.country ?? xml?.country ?? base.country,
      impactLevel: impact,
      utcEventTime,
      actualValue,
      actualSource: actualValue ? ('WEBSITE' as const) : ('NONE' as const),
      actualCaptureStatus: actualValue ? ('CAPTURED' as const) : expectsRelease ? ('PENDING' as const) : ('NOT_RELEASED' as const),
      actualCapturedAt: null,
      websiteActualValue: web?.websiteActualValue ?? null,
      xmlActualValue: xml?.xmlActualValue ?? null,
      sourcePriorityUsed: web ? ('WEBSITE' as const) : ('XML' as const),
      forecastValue,
      previousValue,
      revisedPreviousValue,
      status,
      aiSummary: actualValue
        ? aiSummaryForEvent(base.eventName, base.currency, actualValue, forecastValue, revisedPreviousValue ?? previousValue, classifyBias(base.eventName, computeSurprise(actualValue, forecastValue, base.eventName)))
        : pendingSummaryForStatus(status),
      aiReasoning: actualValue ? 'Generated by deterministic economic surprise rule engine from real collected actual/forecast/previous values.' : null,
    };

    const validationStatus = web
      ? xml
        ? 'WEBSITE_PREFERRED'
        : 'WEBSITE_COLLECTED'
      : 'PROVISIONAL';

    merged.push({
      event: mergedEvent,
      validationStatus,
      conflictStatus,
      xmlSnapshot: xml ? { type: 'xml', event: xml } : undefined,
      websiteSnapshot: web ? { type: 'website', event: web } : undefined,
      conflicts,
    });
  }

  return { merged, conflictCount };
}

type ForexFactoryBrowserRow = {
  dateText: string;
  timeText: string;
  currency: string;
  country: string;
  impactText: string;
  impactClass: string;
  eventName: string;
  actual: string;
  forecast: string;
  previous: string;
  revised: string;
  detailUrl: string;
  timestampSec: number | null;
};

async function scrapeForexFactoryCalendarWithPlaywright(url: string, reference?: Date): Promise<{ events: CollectedEconomicEvent[] }> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: browserUserAgent,
    timezoneId: 'UTC',
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector('table.calendar__table', { timeout: 45_000, state: 'attached' });
    await page.waitForSelector('table.calendar__table tr.calendar__row', { timeout: 45_000, state: 'attached' });
    const title = (await page.title()).toLowerCase();
    if (title.includes('just a moment') || title.includes('attention required')) {
      throw new Error('Cloudflare or bot protection page detected.');
    }

    const rows = await page.evaluate(() => {
      const normalize = (value: string | null | undefined) => String(value ?? '').replace(/\s+/g, ' ').trim();
      const safeHref = (href: string | null) => (href ? new URL(href, location.origin).toString() : '');

      const table = document.querySelector('table.calendar__table') ?? document.querySelector('#calendar__table');
      if (!table) return [];
      const bodyRows = Array.from(table.querySelectorAll('tr.calendar__row')).filter((row) => row.querySelector('td'));

      let currentDate = '';
      let currentTime = '';
      let currentCurrency = '';
      let currentCountry = '';

      return bodyRows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll('td'));
          const dateCell = row.querySelector('.calendar__date') ?? cells[0];
          const timeCell = row.querySelector('.calendar__time') ?? cells[1];
          const currencyCell = row.querySelector('.calendar__currency') ?? row.querySelector('td.calendar__currency') ?? cells.find((cell) => cell.className.includes('currency')) ?? cells[2];
          const impactCell = row.querySelector('.calendar__impact') ?? row.querySelector('td.calendar__impact') ?? cells.find((cell) => cell.className.includes('impact')) ?? null;
          const detailCell = row.querySelector('.calendar__event') ?? row.querySelector('td.calendar__event') ?? cells.find((cell) => cell.className.includes('event')) ?? null;
          const actualCell = row.querySelector('.calendar__actual') ?? row.querySelector('td.calendar__actual') ?? null;
          const forecastCell = row.querySelector('.calendar__forecast') ?? row.querySelector('td.calendar__forecast') ?? null;
          const previousCell = row.querySelector('.calendar__previous') ?? row.querySelector('td.calendar__previous') ?? null;

          const dateText = normalize(dateCell?.textContent);
          const timeText = normalize(timeCell?.textContent);
          const currencyText = normalize(currencyCell?.textContent);
          const countryText = normalize((row.querySelector('.calendar__country') ?? row.querySelector('td.calendar__country'))?.textContent);
          const impactText = normalize(impactCell?.getAttribute('title') || impactCell?.textContent);
          const impactIcon = impactCell?.querySelector('span') ?? null;
          const impactClass = impactIcon ? normalize(impactIcon.className) : normalize(impactCell?.className ?? '');
          const eventLink = detailCell?.querySelector('a') ?? null;
          const eventName = normalize(eventLink?.textContent || detailCell?.textContent);
          const actual = normalize(actualCell?.textContent);
          const forecast = normalize(forecastCell?.textContent);
          const previous = normalize(previousCell?.textContent);
          const revised = normalize((row.querySelector('.calendar__revision') ?? row.querySelector('td.calendar__revision'))?.textContent);
          const detailUrl = safeHref(eventLink?.getAttribute('href') ?? null);

          const timestampAttr = row.getAttribute('data-datetime') || row.getAttribute('data-timestamp') || (row as any).dataset?.datetime || (row as any).dataset?.timestamp;
          const timestampSec = timestampAttr && /^\d+$/.test(timestampAttr) ? Number(timestampAttr) : null;

          if (dateText) currentDate = dateText;
          if (timeText) currentTime = timeText;
          if (currencyText) currentCurrency = currencyText;
          if (countryText) currentCountry = countryText;

          return {
            dateText: dateText || currentDate,
            timeText: timeText || currentTime,
            currency: currencyText || currentCurrency,
            country: countryText || currentCountry,
            impactText,
            impactClass,
            eventName,
            actual,
            forecast,
            previous,
            revised,
            detailUrl,
            timestampSec,
          };
        })
        .filter((row) => row.eventName && row.currency);
    }) as ForexFactoryBrowserRow[];

    const ref = reference ?? new Date();
    const events = rows
      .map((row) => normalizeForexFactoryBrowserRow(row, ref))
      .filter((event): event is CollectedEconomicEvent => Boolean(event));

    return { events };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function normalizeForexFactoryBrowserRow(row: ForexFactoryBrowserRow, reference: Date): CollectedEconomicEvent | null {
  const sourceName = 'ForexFactory';
  const sourceUrl = forexFactoryCalendarUrl;
  const currency = cleanCurrency(row.currency);
  if (!row.eventName || !isRequiredCurrency(currency)) return null;

  const impact = normalizeImpact(row.impactText || row.impactClass);
  const scheduled = row.timestampSec != null
    ? new Date(row.timestampSec * 1000)
    : parseForexFactoryPrettyDateTime(row.dateText, row.timeText, reference);
  const dateOnly = scheduled ? null : parseForexFactoryPrettyDate(row.dateText, reference);

  const eventDate = (scheduled ?? dateOnly) ? (scheduled ?? dateOnly)!.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const eventTime = scheduled ? scheduled.toISOString().slice(11, 19) : null;
  const normalizedEventName = normalizeEventName(row.eventName, currency);
  const eventKey = deterministicEventKey(currency, normalizedEventName, eventDate, eventTime);

  const actual = normalizeActualValue(cleanValue(row.actual) ?? null);
  const forecast = cleanValue(row.forecast) ?? null;
  const previous = cleanValue(row.previous) ?? null;
  const revised = cleanValue(row.revised) ?? null;

  const expectsRelease = Boolean(forecast || previous || revised);
  const status = lifecycleStatusForCollectedEvent(scheduled, actual, expectsRelease);
  const surprise = computeSurprise(actual, forecast, row.eventName);
  const bias = classifyBias(row.eventName, surprise);
  const biasStrength = biasScore(bias);
  const restriction = restrictionWindowForImpact(impact);
  const restrictionStartTime = scheduled && restriction.beforeMinutes > 0
    ? new Date(scheduled.getTime() - restriction.beforeMinutes * 60_000).toISOString()
    : null;
  const restrictionEndTime = scheduled && restriction.afterMinutes > 0
    ? new Date(scheduled.getTime() + restriction.afterMinutes * 60_000).toISOString()
    : null;

  return {
    id: `evt_${eventKey}`,
    sourceName,
    sourceUrl: row.detailUrl || sourceUrl,
    sourceType: 'website' as const,
    eventKey,
    eventName: row.eventName,
    normalizedEventName,
    country: row.country || countryForCurrency(currency),
    currency,
    impactLevel: impact,
    eventDate,
    eventTime,
    eventTimezone: 'UTC',
    utcEventTime: scheduled?.toISOString() ?? null,
    actualValue: actual,
    actualSource: actual ? ('WEBSITE' as const) : ('NONE' as const),
    actualCaptureStatus: actual ? ('CAPTURED' as const) : expectsRelease ? ('PENDING' as const) : ('NOT_RELEASED' as const),
    actualCapturedAt: null,
    websiteActualValue: actual,
    xmlActualValue: null,
    sourcePriorityUsed: 'WEBSITE' as const,
    forecastValue: forecast,
    previousValue: previous,
    revisedPreviousValue: revised,
    status,
    surpriseValue: surprise,
    surprisePercentage: surprise,
    surpriseDirection: surprise == null ? null : surprise > 0 ? 'positive' : surprise < 0 ? 'negative' : 'neutral',
    bias,
    biasStrength,
    affectedPairs: affectedPairsForCurrency(currency),
    tradeRestrictionRequired: impact === 'High' || impact === 'Critical' || impact === 'Medium',
    restrictionStartTime,
    restrictionEndTime,
    aiSummary: actual ? aiSummaryForEvent(row.eventName, currency, actual, forecast, revised ?? previous, bias) : pendingSummaryForStatus(status),
    aiReasoning: actual ? 'Generated by deterministic economic surprise rule engine from real collected actual/forecast/previous values.' : null,
  };
}

function parseForexFactoryPrettyDateTime(dateText: string, timeText: string, reference: Date): Date | null {
  if (!dateText) return null;
  const trimmedTime = String(timeText ?? '').trim().toLowerCase();
  if (!trimmedTime || trimmedTime.includes('tentative') || trimmedTime.includes('all day')) return null;

  const parts = dateText.trim().split(/\s+/);
  const monthText = parts.length >= 2 ? parts[parts.length - 2] : '';
  const dayText = parts.length >= 1 ? parts[parts.length - 1] : '';
  const month = monthIndex(monthText);
  const day = Number(dayText);
  if (month < 0 || !Number.isFinite(day)) return null;

  const year = inferYear(reference, month);
  const match = trimmedTime.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = match[3];
  if (suffix === 'pm' && hour !== 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  const parsed = new Date(Date.UTC(year, month, day, hour, minute, 0));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseForexFactoryPrettyDate(dateText: string, reference: Date): Date | null {
  if (!dateText) return null;
  const parts = dateText.trim().split(/\s+/);
  const monthText = parts.length >= 2 ? parts[parts.length - 2] : '';
  const dayText = parts.length >= 1 ? parts[parts.length - 1] : '';
  const month = monthIndex(monthText);
  const day = Number(dayText);
  if (month < 0 || !Number.isFinite(day)) return null;
  const year = inferYear(reference, month);
  const parsed = new Date(Date.UTC(year, month, day, 0, 0, 0));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthIndex(text: string): number {
  const lower = text.toLowerCase();
  const mapping: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };
  return mapping[lower] ?? -1;
}

function inferYear(reference: Date, month: number): number {
  const refMonth = reference.getUTCMonth();
  const refYear = reference.getUTCFullYear();
  if (month > refMonth + 6) return refYear - 1;
  if (month < refMonth - 6) return refYear + 1;
  return refYear;
}

function deterministicEventKey(currency: string, normalizedEventName: string, eventDate: string, eventTime: string | null): string {
  const timeKey = eventTime ? eventTime : 'TENTATIVE';
  return stableKey([currency, normalizedEventName, eventDate, timeKey]);
}

function forexFactoryWeekUrlForDate(eventDate: string): string {
  const parsed = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return forexFactoryCalendarUrl;
  const day = parsed.getUTCDay();
  const sunday = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate() - day, 0, 0, 0));
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const slug = `${months[sunday.getUTCMonth()]}${sunday.getUTCDate()}.${sunday.getUTCFullYear()}`;
  return `https://www.forexfactory.com/calendar?week=${slug}`;
}

function findBestWebsiteMatch(
  target: { currency: string; normalizedEventName: string; eventDate: string; utcEventTime: string | null },
  websiteEvents: CollectedEconomicEvent[],
  toleranceMinutes: number,
): CollectedEconomicEvent | null {
  const currency = cleanCurrency(target.currency);
  const normalized = String(target.normalizedEventName ?? '').trim();
  const date = String(target.eventDate ?? '').trim();

  const candidates = websiteEvents
    .filter((event) => cleanCurrency(event.currency) === currency)
    .filter((event) => String(event.normalizedEventName ?? '').trim() === normalized)
    .filter((event) => String(event.eventDate ?? '').trim() === date);

  if (!candidates.length) return null;
  if (!target.utcEventTime) return candidates[0];

  const targetTime = new Date(target.utcEventTime).getTime();
  if (Number.isNaN(targetTime)) return candidates[0];

  let best: CollectedEconomicEvent | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!candidate.utcEventTime) continue;
    const candidateTime = new Date(candidate.utcEventTime).getTime();
    if (Number.isNaN(candidateTime)) continue;
    const deltaMin = Math.abs(candidateTime - targetTime) / 60_000;
    if (deltaMin <= toleranceMinutes && deltaMin < bestDelta) {
      bestDelta = deltaMin;
      best = candidate;
    }
  }

  return best ?? candidates[0];
}

type InvestingEconomicCalendarEvent = {
  eventDate: string;
  utcEventTime: string | null;
  eventTime: string | null;
  currency: string;
  eventName: string;
  normalizedEventName: string;
  impactLevel: EconomicImpactLevel;
  sourceUrl: string | null;
  actualValue: string | null;
  forecastValue: string | null;
  previousValue: string | null;
};

type InvestingCalendarMatch = InvestingEconomicCalendarEvent & { matchScore: number };

function toForexFactoryScheduleOnly(event: CollectedEconomicEvent): CollectedEconomicEvent {
  const scheduled = event.utcEventTime ? new Date(event.utcEventTime) : null;
  const status = lifecycleStatusForCollectedEvent(scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled : null, null, false);

  return {
    ...event,
    actualValue: null,
    actualSource: 'NONE',
    actualCaptureStatus: 'NOT_RELEASED',
    actualCapturedAt: null,
    websiteActualValue: null,
    xmlActualValue: null,
    sourcePriorityUsed: 'FOREXFACTORY',
    forecastValue: null,
    previousValue: null,
    revisedPreviousValue: null,
    status,
    surpriseValue: null,
    surprisePercentage: null,
    surpriseDirection: null,
    bias: 'Not Enough Data',
    biasStrength: 0,
    aiSummary: pendingSummaryForStatus(status),
    aiReasoning: null,
  };
}

function weekRangeForIsoDate(dateIso: string): { fromDate: string; toDate: string } {
  const parsed = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    const today = new Date().toISOString().slice(0, 10);
    return { fromDate: today, toDate: today };
  }
  const day = parsed.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const monday = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate() - mondayOffset, 0, 0, 0));
  const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6, 0, 0, 0));
  return { fromDate: monday.toISOString().slice(0, 10), toDate: sunday.toISOString().slice(0, 10) };
}

function shiftWeekRange(range: { fromDate: string; toDate: string }, weeks: number): { fromDate: string; toDate: string } {
  const from = new Date(`${range.fromDate}T00:00:00Z`);
  const to = new Date(`${range.toDate}T00:00:00Z`);
  const shiftMs = weeks * 7 * 24 * 60 * 60_000;
  return {
    fromDate: new Date(from.getTime() + shiftMs).toISOString().slice(0, 10),
    toDate: new Date(to.getTime() + shiftMs).toISOString().slice(0, 10),
  };
}

function calendarSyncRangesForToday(): Array<{ fromDate: string; toDate: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const thisWeek = weekRangeForIsoDate(today);
  const nextWeek = shiftWeekRange(thisWeek, 1);
  return [thisWeek, nextWeek];
}

function normalizeLooseTitle(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function bigramDiceCoefficient(a: string, b: string): number {
  const left = normalizeLooseTitle(a);
  const right = normalizeLooseTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;

  const make = (text: string) => {
    const grams = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i += 1) {
      const gram = text.slice(i, i + 2);
      grams.set(gram, (grams.get(gram) ?? 0) + 1);
    }
    return grams;
  };

  const gramsA = make(left);
  const gramsB = make(right);
  let intersection = 0;
  for (const [gram, countA] of gramsA.entries()) {
    const countB = gramsB.get(gram) ?? 0;
    intersection += Math.min(countA, countB);
  }

  const sizeA = Array.from(gramsA.values()).reduce((sum, n) => sum + n, 0);
  const sizeB = Array.from(gramsB.values()).reduce((sum, n) => sum + n, 0);
  if (sizeA + sizeB === 0) return 0;
  return (2 * intersection) / (sizeA + sizeB);
}

function normalizeInvestingCurrency(value: string): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw.length === 3) return raw;
  const mapping: Record<string, string> = {
    EU: 'EUR',
    US: 'USD',
    GB: 'GBP',
    UK: 'GBP',
    JP: 'JPY',
    CH: 'CHF',
    CA: 'CAD',
    AU: 'AUD',
    NZ: 'NZD',
    CN: 'CNY',
  };
  return mapping[raw] ?? raw;
}

function findBestInvestingCalendarMatch(
  target: { currency: string; eventDate: string; normalizedEventName: string; utcEventTime: string | null; eventName: string },
  investingEvents: InvestingEconomicCalendarEvent[],
): InvestingCalendarMatch | null {
  const currency = cleanCurrency(target.currency);
  const date = String(target.eventDate ?? '').trim();
  const candidates = investingEvents
    .filter((event) => cleanCurrency(event.currency) === currency)
    .filter((event) => String(event.eventDate ?? '').trim() === date);

  if (!candidates.length) return null;

  const targetTitle = normalizeLooseTitle(target.normalizedEventName || target.eventName);
  const targetTime = target.utcEventTime ? new Date(target.utcEventTime).getTime() : Number.NaN;

  let best: InvestingCalendarMatch | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const candidateTitle = normalizeLooseTitle(candidate.normalizedEventName || candidate.eventName);
    let score = bigramDiceCoefficient(targetTitle, candidateTitle);

    const candidateTime = candidate.utcEventTime ? new Date(candidate.utcEventTime).getTime() : Number.NaN;
    if (Number.isFinite(targetTime) && Number.isFinite(candidateTime)) {
      const deltaMin = Math.abs(candidateTime - targetTime) / 60_000;
      if (deltaMin > 180) score -= 0.25;
      else if (deltaMin > 90) score -= 0.15;
      else if (deltaMin > 30) score -= 0.05;
    }

    if (score > bestScore) {
      bestScore = score;
      best = { ...candidate, matchScore: Math.round(score * 1000) / 1000 };
    }
  }

  if (!best || bestScore < 0.55) return null;
  return best;
}

function decodeHtmlEntities(value: string): string {
  return String(value ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtmlTags(value: string): string {
  const withoutScripts = String(value ?? '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, '');
  return decodeHtmlEntities(withoutStyles.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseInvestingHeaderDate(raw: string): string | null {
  const monthMap: Record<string, number> = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const mdy = text.match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/);
  if (mdy) {
    const mm = monthMap[mdy[1].toLowerCase()] ?? 0;
    const dd = Number(mdy[2]);
    const yyyy = Number(mdy[3]);
    if (!mm || !dd || !yyyy) return null;
    return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  const dmy = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = monthMap[dmy[2].toLowerCase()] ?? 0;
    const yyyy = Number(dmy[3]);
    if (!mm || !dd || !yyyy) return null;
    return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  return null;
}

function extractTdTextByClass(trHtml: string, classCandidates: string[]): string {
  for (const cls of classCandidates) {
    const match = trHtml.match(new RegExp(`<td[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/td>`, 'i'));
    if (!match) continue;
    const text = stripHtmlTags(match[1] ?? '');
    if (text) return text;
  }
  return '';
}

function parseInvestingCalendarServiceHtml(html: string): Array<{ eventDate: string | null; utcEventTime: string | null; eventTime: string | null; currencyText: string; eventName: string; impactLevel: EconomicImpactLevel; sourceUrl: string | null; actual: string; forecast: string; previous: string }> {
  const rows = Array.from(String(html ?? '').matchAll(/<tr\b[\s\S]*?<\/tr>/gi)).map((match) => match[0]);
  let currentDate: string | null = null;
  const out: Array<{ eventDate: string | null; utcEventTime: string | null; eventTime: string | null; currencyText: string; eventName: string; impactLevel: EconomicImpactLevel; sourceUrl: string | null; actual: string; forecast: string; previous: string }> = [];

  for (const rowHtml of rows) {
    const isDayRow = /\btheDay\b/i.test(rowHtml);
    if (isDayRow) {
      const maybeDate = parseInvestingHeaderDate(stripHtmlTags(rowHtml));
      if (maybeDate) {
        currentDate = maybeDate;
        continue;
      }
    }

    const isEventRow = /eventRowId_/i.test(rowHtml) || /js-event-item/i.test(rowHtml) || /data-event-datetime=/i.test(rowHtml);
    if (!isEventRow) continue;

    const dtMatch = rowHtml.match(/data-event-datetime="([^"]+)"/i);
    const dtText = dtMatch ? String(dtMatch[1]) : '';
    const dtNormalized = dtText ? dtText.replace(/\//g, '-').replace(' ', 'T') : '';
    const parsedDate = dtNormalized ? new Date(dtNormalized.endsWith('Z') ? dtNormalized : `${dtNormalized}Z`) : null;
    const utcEventTime = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null;
    const eventTime = utcEventTime ? utcEventTime.slice(11, 19) : null;

    let eventDate = utcEventTime ? utcEventTime.slice(0, 10) : currentDate;
    const timeText = extractTdTextByClass(rowHtml, ['time', 'first', 'js-time']);
    if (!utcEventTime && eventDate && timeText && /^\d{2}:\d{2}$/.test(timeText)) {
      const fallback = new Date(`${eventDate}T${timeText}:00Z`);
      if (!Number.isNaN(fallback.getTime())) {
        eventDate = fallback.toISOString().slice(0, 10);
      }
    }

    const currencyText = extractTdTextByClass(rowHtml, ['flagCur', 'cur', 'currency']);
    const eventName = extractTdTextByClass(rowHtml, ['event']);
    const sentimentTitleMatch = rowHtml.match(/class="[^"]*\bsentiment\b[^"]*"[^>]*title="([^"]+)"/i);
    const sentimentTitle = sentimentTitleMatch ? stripHtmlTags(String(sentimentTitleMatch[1] ?? '')) : '';
    const fullBulls = (rowHtml.match(/grayFullBullishIcon/gi) ?? []).length;
    const impactLevel: EconomicImpactLevel = /high/i.test(sentimentTitle) || fullBulls >= 3
      ? 'High'
      : /moderate/i.test(sentimentTitle) || fullBulls === 2
        ? 'Medium'
        : 'Low';

    const hrefMatch = rowHtml.match(/<td[^>]*class="[^"]*\bevent\b[^"]*"[\s\S]*?href="([^"]+)"/i);
    const href = hrefMatch ? String(hrefMatch[1] ?? '') : '';
    const sourceUrl = href
      ? (href.startsWith('http') ? href : `https://www.investing.com${href.startsWith('/') ? '' : '/'}${href}`)
      : null;

    const actual = extractTdTextByClass(rowHtml, ['act', 'actual']);
    const forecast = extractTdTextByClass(rowHtml, ['fore', 'cons', 'forecast']);
    const previous = extractTdTextByClass(rowHtml, ['prev', 'previous']);

    if (!eventDate || !currencyText || !eventName) continue;
    out.push({ eventDate, utcEventTime, eventTime, currencyText, eventName, impactLevel, sourceUrl, actual, forecast, previous });
  }

  return out;
}

async function fetchInvestingEconomicCalendarRangeViaHttp(range: { fromDate: string; toDate: string }): Promise<InvestingEconomicCalendarEvent[]> {
  const url = 'https://www.investing.com/economic-calendar/Service/getCalendarFilteredData';
  const countryIds = [5, 4, 6, 35, 12, 25, 43, 17, 22, 10, 26];
  const encodedCountries = countryIds.map((id) => `country%5B%5D=${encodeURIComponent(String(id))}`).join('&');
  const body = `${encodedCountries}&dateFrom=${encodeURIComponent(range.fromDate)}&dateTo=${encodeURIComponent(range.toDate)}&currentTab=custom&submitFilters=1&limit_from=0`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Origin: 'https://www.investing.com',
      Referer: investingCalendarUrl,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': browserUserAgent,
    },
    body,
  });

  if (!response.ok) return [];
  const text = await response.text();
  if (!text || text.trim().startsWith('<')) return [];

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    return [];
  }
  const html = String(payload?.data ?? '');
  if (!html) return [];

  const parsedRows = parseInvestingCalendarServiceHtml(html);
  return parsedRows
    .map((row) => {
      const eventDate = String(row.eventDate ?? '').trim();
      if (!eventDate || eventDate < range.fromDate || eventDate > range.toDate) return null;

      const currency = normalizeInvestingCurrency(String(row.currencyText ?? ''));
      if (!currency || currency.length < 2) return null;

      const eventName = String(row.eventName ?? '').trim();
      if (!eventName) return null;

      return {
        eventDate,
        utcEventTime: row.utcEventTime ? String(row.utcEventTime) : (null as string | null),
        eventTime: row.eventTime ? String(row.eventTime) : null,
        currency,
        eventName,
        normalizedEventName: normalizeEventName(eventName, currency),
        impactLevel: row.impactLevel ? (String(row.impactLevel) as EconomicImpactLevel) : 'Low',
        sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
        actualValue: cleanValue(String(row.actual ?? '')) ?? null,
        forecastValue: cleanValue(String(row.forecast ?? '')) ?? null,
        previousValue: cleanValue(String(row.previous ?? '')) ?? null,
      } satisfies InvestingEconomicCalendarEvent;
    })
    .filter((row): row is InvestingEconomicCalendarEvent => Boolean(row));
}

async function scrapeInvestingEconomicCalendarRange(range: { fromDate: string; toDate: string }): Promise<InvestingEconomicCalendarEvent[]> {
  const direct = await fetchInvestingEconomicCalendarRangeViaHttp(range).catch(() => []);
  if (direct.length) return direct;

  const headless = String(process.env.CACSMS_INVESTING_HEADLESS ?? 'true').toLowerCase() !== 'false';
  const browser = await chromium
    .launch({ headless, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] })
    .catch(() => chromium.launch({ headless, args: ['--disable-blink-features=AutomationControlled'] }));
  const context = await browser.newContext({
    userAgent: browserUserAgent,
    viewport: { width: 1365, height: 900 },
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const page = await context.newPage();

  try {
    const start = new Date(`${range.fromDate}T00:00:00Z`);
    const end = new Date(`${range.toDate}T00:00:00Z`);
    const days: string[] = [];
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 24 * 60 * 60_000) {
        days.push(new Date(cursor).toISOString().slice(0, 10));
      }
    }
    if (!days.length) days.push(new Date().toISOString().slice(0, 10));

    const collectedRows: Array<{ eventDate: string | null; timeText: string; currencyText: string; eventName: string; actual: string; forecast: string; previous: string }> = [];

    for (const day of days) {
      await page.goto(`${investingCalendarUrl}?day=${encodeURIComponent(day)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(1_000);
      await page.evaluate(() => {
        const consent = document.querySelector('#onetrust-accept-btn-handler') as HTMLElement | null;
        if (consent) {
          try { consent.click(); } catch { /* noop */ }
        }
      }).catch(() => {});
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(500);

      const rawRows = await page.evaluate((forcedDateIso) => {
      const monthMap: Record<string, number> = {
        jan: 1, january: 1,
        feb: 2, february: 2,
        mar: 3, march: 3,
        apr: 4, april: 4,
        may: 5,
        jun: 6, june: 6,
        jul: 7, july: 7,
        aug: 8, august: 8,
        sep: 9, sept: 9, september: 9,
        oct: 10, october: 10,
        nov: 11, november: 11,
        dec: 12, december: 12,
      };

      const parseHeaderDate = (text: string): string | null => {
        const raw = String(text ?? '').trim();
        if (!raw) return null;
        const mdy = raw.match(/([A-Za-z]{3,9})\\s+(\\d{1,2}),\\s*(\\d{4})/);
        if (mdy) {
          const mm = monthMap[mdy[1].toLowerCase()] ?? 0;
          const dd = Number(mdy[2]);
          const yyyy = Number(mdy[3]);
          if (!mm || !dd || !yyyy) return null;
          return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        }
        const dmy = raw.match(/(\\d{1,2})\\s+([A-Za-z]{3,9})\\s+(\\d{4})/);
        if (dmy) {
          const dd = Number(dmy[1]);
          const mm = monthMap[dmy[2].toLowerCase()] ?? 0;
          const yyyy = Number(dmy[3]);
          if (!mm || !dd || !yyyy) return null;
          return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        }
        return null;
      };

      const readCellText = (row: Element, selectors: string[]): string => {
        for (const selector of selectors) {
          const el = row.querySelector(selector);
          const text = el?.textContent?.trim() ?? '';
          if (text) return text;
        }
        return '';
      };

      let currentDate: string | null = forcedDateIso || null;
      const out: Array<{ eventDate: string | null; timeText: string; currencyText: string; eventName: string; actual: string; forecast: string; previous: string }> = [];
      const rows = Array.from(document.querySelectorAll('tr'));

      for (const row of rows) {
        const rowText = row.textContent?.trim() ?? '';
        const maybeDate = row.classList.contains('theDay')
          ? parseHeaderDate(rowText)
          : row.querySelector('td.theDay') ? parseHeaderDate(rowText) : null;
        if (maybeDate) {
          currentDate = maybeDate;
          continue;
        }

        const id = (row as HTMLElement).id ?? '';
        const isEventRow = id.startsWith('eventRowId_')
          || row.classList.contains('js-event-item')
          || row.getAttribute('data-event-datetime') != null;
        if (!isEventRow) continue;

        const timeText = readCellText(row, ['td.time', 'td.first', 'td.js-time', 'td[class*="time"]']);
        const currencyText = readCellText(row, ['td.flagCur', 'td[class*="flagCur"]', 'td.cur', 'td.currency']);
        const eventName = readCellText(row, ['td.event a', 'td.event', 'td[class*="event"] a', 'td[class*="event"]']);
        const actual = readCellText(row, ['td.act', 'td.actual', 'td[class*="act"]']);
        const forecast = readCellText(row, ['td.fore', 'td.cons', 'td.forecast', 'td[class*="fore"]', 'td[class*="cons"]']);
        const previous = readCellText(row, ['td.prev', 'td.previous', 'td[class*="prev"]']);

        if (!currentDate || !currencyText || !eventName) continue;
        out.push({ eventDate: currentDate, timeText, currencyText, eventName, actual, forecast, previous });
      }

      return out;
    }, day);

      for (const row of rawRows as any[]) {
        collectedRows.push({
          eventDate: row.eventDate ? String(row.eventDate) : day,
          timeText: String(row.timeText ?? ''),
          currencyText: String(row.currencyText ?? ''),
          eventName: String(row.eventName ?? ''),
          actual: String(row.actual ?? ''),
          forecast: String(row.forecast ?? ''),
          previous: String(row.previous ?? ''),
        });
      }
    }

    return collectedRows
      .map((row) => {
        const eventDate = String(row.eventDate ?? '').trim();
        if (!eventDate || eventDate < range.fromDate || eventDate > range.toDate) return null;

        const currency = normalizeInvestingCurrency(String(row.currencyText ?? ''));
        if (!currency || currency.length < 2) return null;

        const eventName = String(row.eventName ?? '').trim();
        if (!eventName) return null;

        const event: InvestingEconomicCalendarEvent = {
          eventDate,
          utcEventTime: null as string | null,
          eventTime: null as string | null,
          currency,
          eventName,
          normalizedEventName: normalizeEventName(eventName, currency),
          impactLevel: 'Low',
          sourceUrl: null,
          actualValue: cleanValue(String(row.actual ?? '')) ?? null,
          forecastValue: cleanValue(String(row.forecast ?? '')) ?? null,
          previousValue: cleanValue(String(row.previous ?? '')) ?? null,
        };
        return event;
      })
      .filter((row): row is InvestingEconomicCalendarEvent => row != null);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function nextMonitoringRunAfter(props: { now: Date; utcEventTime: string | null }): Date | null {
  if (!props.utcEventTime) return null;
  const release = new Date(props.utcEventTime);
  if (Number.isNaN(release.getTime())) return null;

  const nowMs = props.now.getTime();
  const deltaMs = release.getTime() - nowMs;
  const minute = 60_000;
  const hour = 60 * minute;

  if (deltaMs > 24 * hour) return new Date(nowMs + 6 * hour);
  if (deltaMs > 1 * hour) return new Date(nowMs + 2 * hour);
  if (deltaMs > 5 * minute) return new Date(nowMs + 5 * minute);
  if (deltaMs > 0) return new Date(nowMs + 30_000);
  if (deltaMs >= -24 * hour) return new Date(nowMs + 5 * minute);
  return null;
}

type EconomicCalendarWorkerState = {
  timer: ReturnType<typeof setInterval>;
  running: boolean;
  lastTickAt: number;
  lastCalendarSyncAt: number;
};

export function ensureEconomicCalendarWorkerStarted() {
  const globalAny = globalThis as unknown as { __cacsmsEconomicCalendarWorker?: EconomicCalendarWorkerState };
  if (globalAny.__cacsmsEconomicCalendarWorker) {
    return { ok: true, status: 'running' as const };
  }

  const state: EconomicCalendarWorkerState = {
    timer: setInterval(async () => {
      if (state.running) return;
      state.running = true;
      state.lastTickAt = Date.now();
      try {
        const service = new EconomicCalendarIntelligenceService();
        await service.processDueMonitoringJobs({ maxJobs: 5 });
        if (Date.now() - state.lastCalendarSyncAt >= 60 * 60_000) {
          const stale = await service.isCalendarStale();
          if (stale) {
            await service.recordAction('refresh');
            state.lastCalendarSyncAt = Date.now();
          }
        }
      } catch (error) {
        console.error('economic_calendar_worker_tick_failed', error);
      } finally {
        state.running = false;
      }
    }, 15_000),
    running: false,
    lastTickAt: 0,
    lastCalendarSyncAt: 0,
  };

  globalAny.__cacsmsEconomicCalendarWorker = state;
  (state.timer as unknown as { unref?: () => void }).unref?.();
  return { ok: true, status: 'started' as const };
}

export function stopEconomicCalendarWorker() {
  const globalAny = globalThis as unknown as { __cacsmsEconomicCalendarWorker?: EconomicCalendarWorkerState };
  if (!globalAny.__cacsmsEconomicCalendarWorker) return { ok: true, status: 'stopped' as const };
  clearInterval(globalAny.__cacsmsEconomicCalendarWorker.timer);
  delete globalAny.__cacsmsEconomicCalendarWorker;
  return { ok: true, status: 'stopped' as const };
}

export function affectedPairsForCurrency(currency: string): string[] {
  const mapping: Record<string, string[]> = {
    USD: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'XAUUSD'],
    EUR: ['EURUSD', 'EURGBP', 'EURJPY', 'EURAUD', 'EURCAD', 'EURCHF'],
    GBP: ['GBPUSD', 'EURGBP', 'GBPJPY', 'GBPAUD', 'GBPCAD'],
    JPY: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY'],
    CHF: ['USDCHF', 'EURCHF', 'CHFJPY'],
    CAD: ['USDCAD', 'EURCAD', 'GBPCAD', 'CADJPY'],
    AUD: ['AUDUSD', 'EURAUD', 'GBPAUD', 'AUDJPY'],
    NZD: ['NZDUSD', 'AUDNZD', 'EURNZD'],
  };
  return mapping[currency.toUpperCase()] ?? [];
}

export function restrictionWindowForImpact(impact: EconomicImpactLevel): { beforeMinutes: number; afterMinutes: number } {
  if (impact === 'Critical') return { beforeMinutes: 30, afterMinutes: 60 };
  if (impact === 'High') return { beforeMinutes: 15, afterMinutes: 15 };
  if (impact === 'Medium') return { beforeMinutes: 10, afterMinutes: 10 };
  return { beforeMinutes: 0, afterMinutes: 0 };
}

function emptySummary(): EconomicCalendarDashboard['summary'] {
  return {
    todaysHighImpactEvents: 0,
    upcomingNext24Hours: 0,
    monitoringNow: 0,
    releasedAwaitingAnalysis: 0,
    activeTradeRestrictions: 0,
    sourceCollectionHealth: 0,
    strongestBullishCurrencyToday: null,
    strongestBearishCurrencyToday: null,
  };
}

function isMissingTableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && tableMissingCodes.has(String((error as { code?: unknown }).code));
}

function nullableString(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isToday(value: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getUTCFullYear() === now.getUTCFullYear()
    && date.getUTCMonth() === now.getUTCMonth()
    && date.getUTCDate() === now.getUTCDate();
}

function isWithinHours(value: string | null, hours: number): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  const now = Date.now();
  return time >= now && time <= now + hours * 60 * 60 * 1000;
}

function biasFromScore(score: number): EconomicBias {
  if (score >= 30) return 'Strong Bullish';
  if (score >= 10) return 'Mild Bullish';
  if (score <= -30) return 'Strong Bearish';
  if (score <= -10) return 'Mild Bearish';
  return 'Neutral';
}

async function fetchForexFactoryCalendarPage(): Promise<{ ok: boolean; status?: number; text: string; via: 'node-fetch' | 'powershell' }> {
  const response = await fetch(forexFactoryCalendarUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'User-Agent': browserUserAgent,
    },
  });
  const text = await response.text();

  if (response.ok && text.includes('window.calendarComponentStates')) {
    return { ok: true, status: response.status, text, via: 'node-fetch' };
  }

  if (process.platform !== 'win32') {
    return { ok: response.ok, status: response.status, text, via: 'node-fetch' };
  }

  const powershellText = await fetchForexFactoryCalendarPageWithPowerShell();
  return { ok: true, status: response.status, text: powershellText, via: 'powershell' };
}

async function fetchForexFactoryCalendarPageWithPowerShell(): Promise<string> {
  const url = powershellSingleQuoted(forexFactoryCalendarUrl);
  const userAgent = powershellSingleQuoted(browserUserAgent);
  const command = [
    "$ProgressPreference = 'SilentlyContinue'",
    `$headers = @{ 'User-Agent' = ${userAgent}; Accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'; 'Accept-Language' = 'en-US,en;q=0.9' }`,
    `(Invoke-WebRequest -Uri ${url} -Headers $headers -UseBasicParsing).Content`,
  ].join('; ');
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout;
}

function powershellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseForexFactoryXml(xml: string): CollectedEconomicEvent[] {
  const sourceName = 'ForexFactory';
  const sourceUrl = forexFactoryXmlUrl;
  const eventBlocks = Array.from(xml.matchAll(/<event>([\s\S]*?)<\/event>/gi)).map((match) => match[1]);

  return eventBlocks
    .map((block) => {
      const title = xmlTag(block, 'title') ?? '';
      const currency = (xmlTag(block, 'country') ?? '').toUpperCase();
      const date = xmlTag(block, 'date') ?? '';
      const time = xmlTag(block, 'time') ?? '';
      const impact = normalizeImpact(xmlTag(block, 'impact'));
      const xmlActual = cleanValue(xmlTag(block, 'actual'));
      const actual = guardSourceField('xml', 'actual_value', xmlActual);
      const forecast = cleanValue(xmlTag(block, 'forecast'));
      const previous = cleanValue(xmlTag(block, 'previous'));
      const scheduled = parseForexFactoryDateTime(date, time);
      const eventDate = scheduled ? scheduled.toISOString().slice(0, 10) : date || new Date().toISOString().slice(0, 10);
      const eventTime = scheduled ? scheduled.toISOString().slice(11, 19) : null;
      const normalizedEventName = normalizeEventName(title, currency);
      const eventKey = deterministicEventKey(currency, normalizedEventName, eventDate, eventTime);
      const surprise = computeSurprise(actual, forecast, title);
      const bias = classifyBias(title, surprise);
      const biasStrength = biasScore(bias);
      const restriction = restrictionWindowForImpact(impact);
      const restrictionStartTime = scheduled && restriction.beforeMinutes > 0
        ? new Date(scheduled.getTime() - restriction.beforeMinutes * 60_000).toISOString()
        : null;
      const restrictionEndTime = scheduled && restriction.afterMinutes > 0
        ? new Date(scheduled.getTime() + restriction.afterMinutes * 60_000).toISOString()
        : null;
      const expectsRelease = Boolean(forecast || previous);
      const status = lifecycleStatusForCollectedEvent(scheduled, actual, expectsRelease);

      return {
        id: `evt_${eventKey}`,
        sourceName,
        sourceUrl,
        sourceType: 'xml' as const,
        eventKey,
        eventName: title || normalizedEventName,
        normalizedEventName,
        country: countryForCurrency(currency),
        currency,
        impactLevel: impact,
        eventDate,
        eventTime,
        eventTimezone: 'UTC',
        utcEventTime: scheduled?.toISOString() ?? null,
        actualValue: actual,
        actualSource: 'NONE' as const,
        actualCaptureStatus: expectsRelease ? ('PENDING' as const) : ('NOT_RELEASED' as const),
        actualCapturedAt: null,
        websiteActualValue: null,
        xmlActualValue: xmlActual,
        sourcePriorityUsed: 'XML' as const,
        forecastValue: forecast,
        previousValue: previous,
        revisedPreviousValue: null,
        status,
        surpriseValue: surprise,
        surprisePercentage: surprise,
        surpriseDirection: surprise == null ? null : surprise > 0 ? 'positive' : surprise < 0 ? 'negative' : 'neutral',
        bias,
        biasStrength,
        affectedPairs: affectedPairsForCurrency(currency),
        tradeRestrictionRequired: impact === 'High' || impact === 'Critical' || impact === 'Medium',
        restrictionStartTime,
        restrictionEndTime,
        aiSummary: actual ? aiSummaryForEvent(title, currency, actual, forecast, previous, bias) : pendingSummaryForStatus(status),
        aiReasoning: actual ? 'Generated by deterministic economic surprise rule engine from real collected actual/forecast/previous values.' : null,
      };
    })
    .filter((event) => event.eventName && isRequiredCurrency(event.currency));
}

function parseForexFactoryJson(jsonText: string): CollectedEconomicEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const sourceName = 'ForexFactory';
  const sourceUrl = forexFactoryJsonUrl;

  return parsed
    .map((row) => {
      const obj = row as Record<string, unknown>;
      const title = cleanValue(String(obj.title ?? obj.name ?? '')) ?? '';
      const currency = cleanCurrency(String(obj.country ?? obj.currency ?? '').toUpperCase());
      if (!title || !isRequiredCurrency(currency)) return null;

      const rawDate = cleanValue(String(obj.date ?? obj.datetime ?? ''));
      if (!rawDate) return null;
      const scheduled = new Date(rawDate);
      if (Number.isNaN(scheduled.getTime())) return null;

      const eventDate = scheduled.toISOString().slice(0, 10);
      const eventTime = scheduled.toISOString().slice(11, 19);
      const impact = normalizeImpact(cleanValue(String(obj.impact ?? obj.impactName ?? '')) ?? null);
      const normalizedEventName = normalizeEventName(title, currency);
      const eventKey = deterministicEventKey(currency, normalizedEventName, eventDate, eventTime);
      const restriction = restrictionWindowForImpact(impact);
      const restrictionStartTime = restriction.beforeMinutes > 0
        ? new Date(scheduled.getTime() - restriction.beforeMinutes * 60_000).toISOString()
        : null;
      const restrictionEndTime = restriction.afterMinutes > 0
        ? new Date(scheduled.getTime() + restriction.afterMinutes * 60_000).toISOString()
        : null;
      const status = lifecycleStatusForCollectedEvent(scheduled, null, false);

      const event: CollectedEconomicEvent = {
        id: `evt_${eventKey}`,
        sourceName,
        sourceUrl: forexFactoryWeekUrlForDate(eventDate) || sourceUrl,
        sourceType: 'json' as const,
        eventKey,
        eventName: title || normalizedEventName,
        normalizedEventName,
        country: countryForCurrency(currency),
        currency,
        impactLevel: impact,
        eventDate,
        eventTime,
        eventTimezone: 'UTC',
        utcEventTime: scheduled.toISOString(),
        actualValue: null,
        actualSource: 'NONE' as const,
        actualCaptureStatus: 'NOT_RELEASED' as const,
        actualCapturedAt: null,
        websiteActualValue: null,
        xmlActualValue: null,
        sourcePriorityUsed: 'FOREXFACTORY' as const,
        forecastValue: null,
        previousValue: null,
        revisedPreviousValue: null,
        status,
        surpriseValue: null,
        surprisePercentage: null,
        surpriseDirection: null,
        bias: 'Not Enough Data',
        biasStrength: 0,
        affectedPairs: affectedPairsForCurrency(currency),
        tradeRestrictionRequired: impact === 'High' || impact === 'Critical' || impact === 'Medium',
        restrictionStartTime,
        restrictionEndTime,
        aiSummary: pendingSummaryForStatus(status),
        aiReasoning: null,
      };
      return event;
    })
    .filter((event): event is CollectedEconomicEvent => event != null);
}

type ForexFactoryHtmlEvent = {
  id?: number;
  name?: string;
  currency?: string;
  dateline?: number;
  impactName?: string;
  actual?: string;
  forecast?: string;
  previous?: string;
  revision?: string;
  url?: string;
  soloUrl?: string;
};

function parseForexFactoryCalendarHtml(html: string): CollectedEconomicEvent[] {
  const days = extractForexFactoryDays(html);
  if (!days.length) return [];

  return days
    .flatMap((day) => Array.isArray(day.events) ? day.events : [])
    .map((event) => normalizeForexFactoryHtmlEvent(event))
    .filter((event): event is CollectedEconomicEvent => Boolean(event));
}

function normalizeForexFactoryHtmlEvent(event: ForexFactoryHtmlEvent): CollectedEconomicEvent | null {
  const sourceName = 'ForexFactory';
  const sourceUrl = forexFactoryCalendarUrl;
  const title = cleanValue(event.name ?? '') ?? '';
  const currency = cleanCurrency(event.currency);
  if (!title || !isRequiredCurrency(currency)) return null;

  const scheduled = typeof event.dateline === 'number' ? new Date(event.dateline * 1000) : null;
  const eventDate = scheduled ? scheduled.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const eventTime = scheduled ? scheduled.toISOString().slice(11, 19) : null;
  const impact = normalizeImpact(event.impactName ?? null);
  const actual = normalizeActualValue(cleanValue(event.actual ?? null));
  const forecast = cleanValue(event.forecast ?? null);
  const previous = cleanValue(event.previous ?? null);
  const revision = cleanValue(event.revision ?? null);
  const normalizedEventName = normalizeEventName(title, currency);
  const eventKey = deterministicEventKey(currency, normalizedEventName, eventDate, eventTime);
  const surprise = computeSurprise(actual, forecast, title);
  const bias = classifyBias(title, surprise);
  const biasStrength = biasScore(bias);
  const restriction = restrictionWindowForImpact(impact);
  const restrictionStartTime = scheduled && restriction.beforeMinutes > 0
    ? new Date(scheduled.getTime() - restriction.beforeMinutes * 60_000).toISOString()
    : null;
  const restrictionEndTime = scheduled && restriction.afterMinutes > 0
    ? new Date(scheduled.getTime() + restriction.afterMinutes * 60_000).toISOString()
    : null;
  const expectsRelease = Boolean(forecast || previous || revision);
  const status = lifecycleStatusForCollectedEvent(scheduled, actual, expectsRelease);

  return {
    id: `evt_${eventKey}`,
    sourceName,
    sourceUrl,
    sourceType: 'fallback_html' as const,
    eventKey,
    eventName: title,
    normalizedEventName,
    country: countryForCurrency(currency),
    currency,
    impactLevel: impact,
    eventDate,
    eventTime,
    eventTimezone: 'UTC',
    utcEventTime: scheduled?.toISOString() ?? null,
    actualValue: actual,
    actualSource: actual ? ('WEBSITE' as const) : ('NONE' as const),
    actualCaptureStatus: actual ? ('CAPTURED' as const) : expectsRelease ? ('PENDING' as const) : ('NOT_RELEASED' as const),
    actualCapturedAt: null,
    websiteActualValue: actual,
    xmlActualValue: null,
    sourcePriorityUsed: 'WEBSITE' as const,
    forecastValue: forecast,
    previousValue: previous,
    revisedPreviousValue: revision,
    status,
    surpriseValue: surprise,
    surprisePercentage: surprise,
    surpriseDirection: surprise == null ? null : surprise > 0 ? 'positive' : surprise < 0 ? 'negative' : 'neutral',
    bias,
    biasStrength,
    affectedPairs: affectedPairsForCurrency(currency),
    tradeRestrictionRequired: impact === 'High' || impact === 'Critical' || impact === 'Medium',
    restrictionStartTime,
    restrictionEndTime,
    aiSummary: actual ? aiSummaryForEvent(title, currency, actual, forecast, revision ?? previous, bias) : pendingSummaryForStatus(status),
    aiReasoning: actual ? 'Generated by deterministic economic surprise rule engine from real collected actual/forecast/previous values.' : null,
  };
}

function extractForexFactoryDays(html: string): Array<{ events?: ForexFactoryHtmlEvent[] }> {
  const stateMatches = html.matchAll(/window\.calendarComponentStates\[\d+\]\s*=\s*\{\s*days\s*:/g);
  for (const match of stateMatches) {
    const arrayStart = html.indexOf('[', (match.index ?? 0) + match[0].length);
    if (arrayStart < 0) continue;

    const arrayText = extractBalancedJsonArray(html, arrayStart);
    if (!arrayText) continue;

    try {
      const parsed = JSON.parse(arrayText) as unknown;
      if (Array.isArray(parsed)) return parsed as Array<{ events?: ForexFactoryHtmlEvent[] }>;
    } catch {
      continue;
    }
  }

  return [];
}

function extractBalancedJsonArray(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function lifecycleStatusForCollectedEvent(scheduled: Date | null, actual: string | null, expectsRelease: boolean): EconomicEventStatus {
  if (actual) return 'RELEASED';
  if (!scheduled) return 'UPCOMING';

  const now = Date.now();
  const releaseTime = scheduled.getTime();

  if (!expectsRelease) {
    if (releaseTime <= now - 30 * 60_000) return 'ARCHIVED';
    return 'SCHEDULED';
  }

  if (releaseTime <= now - 24 * 60 * 60_000) return 'FAILED';
  if (releaseTime <= now) return 'WATCHING';
  if (releaseTime <= now + 60 * 60_000) return 'PRE_MONITORING';
  return 'SCHEDULED';
}

function pendingSummaryForStatus(status: EconomicEventStatus): string | null {
  if (status === 'WATCHING') {
    return 'Actual value is not captured yet. Cacsms Trader is actively watching enabled real data sources and will not invent a result.';
  }
  if (status === 'FAILED') {
    return 'Release window passed but no actual value was captured from enabled real data sources. Retry collection or add a confirmed source.';
  }
  if (status === 'PRE_MONITORING') {
    return 'Awaiting release. Cacsms Trader is preparing monitoring and trade protection for this event.';
  }
  return null;
}

function xmlTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return null;
  return decodeXml(match[1].trim());
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanValue(value: string | null): string | null {
  if (!value || value.trim() === '') return null;
  return value.trim();
}

function guardSourceField(sourceType: 'json' | 'xml' | 'website' | 'fallback_html', field: 'actual_value', value: string | null): string | null {
  if (sourceType === 'xml' && field === 'actual_value') return null;
  return value;
}

function normalizeActualValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-') return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'null' || lower === 'undefined') return null;
  if (lower.includes('pending') || lower.includes('not released') || lower.includes('not available')) return null;
  if (lower.includes('forecast') || lower.includes('previous')) return null;
  if (!/\d/.test(trimmed)) return null;
  return trimmed;
}

function cleanCurrency(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function isRequiredCurrency(currency: string): boolean {
  return requiredCurrencySet.has(cleanCurrency(currency));
}

function formatForexFactoryKeyDate(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}-${day}-${date.getUTCFullYear()}`;
}

function formatForexFactoryKeyTime(date: Date): string {
  const hour24 = date.getUTCHours();
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const suffix = hour24 >= 12 ? 'pm' : 'am';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute}${suffix}`;
}

function parseForexFactoryDateTime(dateText: string, timeText: string): Date | null {
  if (!dateText || /tentative/i.test(timeText) || /all day/i.test(timeText)) return null;
  const dateMatch = dateText.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  const timeMatch = timeText.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (!dateMatch) return null;

  const month = Number(dateMatch[1]) - 1;
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  let hour = 0;
  let minute = 0;

  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    if (timeMatch[3] === 'pm' && hour !== 12) hour += 12;
    if (timeMatch[3] === 'am' && hour === 12) hour = 0;
  }

  const parsed = new Date(Date.UTC(year, month, day, hour, minute, 0));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeImpact(value: string | null): EconomicImpactLevel {
  const lower = String(value ?? '').toLowerCase();
  if (lower.includes('high')) return 'High';
  if (lower.includes('medium') || lower.includes('med')) return 'Medium';
  if (lower.includes('critical')) return 'Critical';
  return 'Low';
}

function normalizeEventName(title: string, currency: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('unemployment claims') || lower.includes('jobless claims')) return `${currency} Initial Jobless Claims`;
  if (lower.includes('fed funds') || lower.includes('fomc') || lower.includes('interest rate')) return `${currency} Interest Rate Decision`;
  if (lower.includes('non-farm') || lower.includes('nonfarm')) return `${currency} Nonfarm Payrolls`;
  if (lower.includes('cpi')) return `${currency} Consumer Price Index`;
  if (lower.includes('gdp')) return `${currency} Gross Domestic Product`;
  return `${currency} ${title}`.trim();
}

function stableKey(parts: string[]): string {
  return parts.join('|').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 180);
}

function numberFromEconomicValue(value: string | null): number | null {
  if (!value) return null;
  const multiplier = /k$/i.test(value) ? 1_000 : /m$/i.test(value) ? 1_000_000 : /b$/i.test(value) ? 1_000_000_000 : 1;
  const numeric = Number(value.replace(/[%,$|]/g, '').replace(/[kmb]$/i, '').trim());
  return Number.isFinite(numeric) ? numeric * multiplier : null;
}

function computeSurprise(actual: string | null, forecast: string | null, title: string): number | null {
  const actualNumber = numberFromEconomicValue(actual);
  const forecastNumber = numberFromEconomicValue(forecast);
  if (actualNumber == null || forecastNumber == null || forecastNumber === 0) return null;
  const raw = ((actualNumber - forecastNumber) / Math.abs(forecastNumber)) * 100;
  return Math.round((higherIsBad(title) ? -raw : raw) * 100) / 100;
}

function higherIsBad(title: string): boolean {
  const lower = title.toLowerCase();
  return lower.includes('unemployment')
    || lower.includes('jobless')
    || lower.includes('claimant')
    || lower.includes('inflation expectations');
}

function classifyBias(title: string, surprise: number | null): EconomicBias {
  if (surprise == null) return 'Not Enough Data';
  if (Math.abs(surprise) < 0.5) return 'Neutral';
  if (surprise >= 5) return 'Strong Bullish';
  if (surprise > 0) return 'Mild Bullish';
  if (surprise <= -5) return 'Strong Bearish';
  return 'Mild Bearish';
}

function biasScore(bias: EconomicBias): number {
  if (bias === 'Strong Bullish') return 30;
  if (bias === 'Mild Bullish') return 10;
  if (bias === 'Mild Bearish') return -10;
  if (bias === 'Strong Bearish') return -30;
  return 0;
}

function countryForCurrency(currency: string): string {
  const mapping: Record<string, string> = {
    USD: 'United States',
    EUR: 'Euro Area',
    GBP: 'United Kingdom',
    JPY: 'Japan',
    CHF: 'Switzerland',
    CAD: 'Canada',
    AUD: 'Australia',
    NZD: 'New Zealand',
    CNY: 'China',
  };
  return mapping[currency] ?? currency;
}

function aiSummaryForEvent(title: string, currency: string, actual: string | null, forecast: string | null, previous: string | null, bias: EconomicBias): string {
  return `${currency} ${title} came out at ${actual ?? 'Pending'} versus ${forecast ?? 'no forecast'} forecast and ${previous ?? 'no previous'} previous. The deterministic surprise engine classifies this as ${bias}. Cacsms Trader should require price confirmation before allowing aggressive ${currency} entries.`;
}
