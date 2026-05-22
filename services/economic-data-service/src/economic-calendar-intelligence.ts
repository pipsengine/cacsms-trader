import { queryPostgres } from '@/lib/postgres';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
  | 'CONFLICTED';
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
const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const execFileAsync = promisify(execFile);

export class EconomicCalendarIntelligenceService {
  async getDashboard(): Promise<EconomicCalendarDashboard> {
    const generatedAt = new Date().toISOString();

    try {
      const [events, sources, conflicts, sourceLogs, activeRestrictionCount] = await Promise.all([
        this.listEvents(),
        this.listSources(),
        this.listConflicts(),
        this.listSourceLogs(),
        this.countActiveRestrictions(),
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
      discover: { jobType: 'weekly_calendar_discovery', message: 'Discovery job requested. Enabled sources will be collected by the scheduler/worker.' },
      refresh: { jobType: 'daily_calendar_refresh', message: 'Calendar refresh requested for today and tomorrow.' },
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
        return {
          ok: true,
          message: `${resolved.message} ForexFactory collector stored ${collection.stored} required-currency event(s). ${collection.lifecycle.watching} released event(s) without actual values are being watched, ${collection.lifecycle.failed} stale missing releases are marked failed for retry, and ${collection.lifecycle.watcherJobsQueued} watcher job(s) are queued.`,
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

  private async collectForexFactoryThisWeek(jobType: string): Promise<{ stored: number; lifecycle: LifecycleReconciliation }> {
    const sourceName = 'ForexFactory';
    const sourceUrl = forexFactoryCalendarUrl;
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
      [sourceName, sourceUrl],
    );

    try {
      const response = await fetchForexFactoryCalendarPage();

      if (!response.ok) {
        const fallback = await this.collectForexFactoryXmlFallback(jobType, startedAt, response.status);
        if (fallback.stored > 0) return fallback;
        await this.logSourceFetch(sourceName, jobType, 'FAILED', `HTTP ${response.status} from ${sourceUrl}`, Date.now() - startedAt, response.status);
        return fallback;
      }

      const html = response.text;
      const events = parseForexFactoryCalendarHtml(html);

      if (events.length === 0) {
        const fallback = await this.collectForexFactoryXmlFallback(jobType, startedAt, response.status);
        if (fallback.stored > 0) return fallback;
      }

      let stored = 0;

      for (const event of events) {
        await this.upsertCollectedEvent(event);
        stored += 1;
      }

      await queryPostgres(
        `UPDATE economic_sources
         SET successful_fetch_count = successful_fetch_count + 1,
             reliability_score = LEAST(100, reliability_score + 5),
             last_success_at = now(),
             last_checked_at = now(),
             updated_at = now()
         WHERE source_name = $1`,
        [sourceName],
      );
      await this.logSourceFetch(sourceName, jobType, 'SUCCESS', `Collected ${stored} required-currency event(s) from ForexFactory calendar page via ${response.via}.`, Date.now() - startedAt, response.status);
      return { stored, lifecycle: await this.reconcileReleaseLifecycle() };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown collector error.';
      await queryPostgres(
        `UPDATE economic_sources
         SET failed_fetch_count = failed_fetch_count + 1,
             last_failure_at = now(),
             last_checked_at = now(),
             updated_at = now()
         WHERE source_name = $1`,
        [sourceName],
      );
      await this.logSourceFetch(sourceName, jobType, 'FAILED', message, Date.now() - startedAt);
      await this.reconcileReleaseLifecycle();
      await queryPostgres(
        `INSERT INTO scrape_error_logs (source_name, error_type, message, url)
         VALUES ($1, $2, $3, $4)`,
        [sourceName, 'collector_failed', message, sourceUrl],
      );
      return { stored: 0, lifecycle: await this.reconcileReleaseLifecycle() };
    }
  }

  private async collectForexFactoryXmlFallback(jobType: string, startedAt: number, firstHttpStatus?: number): Promise<{ stored: number; lifecycle: LifecycleReconciliation }> {
    const sourceName = 'ForexFactory';
    const response = await fetch(forexFactoryXmlUrl, {
      headers: {
        Accept: 'application/xml,text/xml,*/*',
        'User-Agent': 'CacsmsTrader/1.0 economic-calendar-intelligence',
      },
    });

    if (!response.ok) {
      await this.logSourceFetch(sourceName, jobType, 'FAILED', `HTML collector unavailable${firstHttpStatus ? ` (HTTP ${firstHttpStatus})` : ''}; XML fallback returned HTTP ${response.status}.`, Date.now() - startedAt, response.status);
      return { stored: 0, lifecycle: await this.reconcileReleaseLifecycle() };
    }

    const xml = await response.text();
    const events = parseForexFactoryXml(xml);
    let stored = 0;

    for (const event of events) {
      await this.upsertCollectedEvent(event);
      stored += 1;
    }

    await this.logSourceFetch(sourceName, jobType, 'DEGRADED', `Collected ${stored} required-currency event(s) from XML fallback; released actual values may be unavailable in this feed.`, Date.now() - startedAt, response.status);
    return { stored, lifecycle: await this.reconcileReleaseLifecycle() };
  }

  private async upsertCollectedEvent(event: CollectedEconomicEvent): Promise<void> {
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
        last_checked_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25,$26,$27,$28,$29,$30,$31,now(),now()
      )
      ON CONFLICT (source_name, event_key)
      DO UPDATE SET
        event_name = EXCLUDED.event_name,
        normalized_event_name = EXCLUDED.normalized_event_name,
        impact_level = EXCLUDED.impact_level,
        event_date = EXCLUDED.event_date,
        event_time = EXCLUDED.event_time,
        local_event_time = EXCLUDED.local_event_time,
        utc_event_time = EXCLUDED.utc_event_time,
        actual_value = EXCLUDED.actual_value,
        forecast_value = EXCLUDED.forecast_value,
        previous_value = EXCLUDED.previous_value,
        revised_previous_value = EXCLUDED.revised_previous_value,
        status = EXCLUDED.status,
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
        'PROVISIONAL',
      ],
    );
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
        AND status NOT IN ('ARCHIVED','ANALYZED','RELEASED','CONFLICTED')
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
        AND status NOT IN ('ARCHIVED','ANALYZED','RELEASED','CONFLICTED')
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
        AND status NOT IN ('ARCHIVED','ANALYZED','RELEASED','CONFLICTED')
      RETURNING id
    `);

    const watcherJobs = await queryPostgres(`
      INSERT INTO economic_event_monitoring_jobs (event_id, job_type, status, run_after)
      SELECT event.id, 'release_watcher', 'QUEUED', now() + interval '5 minutes'
      FROM economic_events event
      WHERE event.actual_value IS NULL
        AND event.status IN ('WATCHING','FAILED')
        AND event.utc_event_time >= now() - interval '7 days'
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

  private async listEvents(): Promise<EconomicCalendarEventView[]> {
    const result = await queryPostgres(`
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
        AND (utc_event_time IS NULL OR utc_event_time >= now() - interval '14 days')
      ORDER BY COALESCE(utc_event_time, created_at) ASC
      LIMIT 500
    `, [[...REQUIRED_CURRENCIES]]);

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
      const actual = cleanValue(xmlTag(block, 'actual'));
      const forecast = cleanValue(xmlTag(block, 'forecast'));
      const previous = cleanValue(xmlTag(block, 'previous'));
      const scheduled = parseForexFactoryDateTime(date, time);
      const eventDate = scheduled ? scheduled.toISOString().slice(0, 10) : date || new Date().toISOString().slice(0, 10);
      const eventTime = scheduled ? scheduled.toISOString().slice(11, 19) : null;
      const normalizedEventName = normalizeEventName(title, currency);
      const eventKey = stableKey([sourceName, date, time, currency, normalizedEventName]);
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
      const status = lifecycleStatusForCollectedEvent(scheduled, actual);

      return {
        id: `evt_${eventKey}`,
        sourceName,
        sourceUrl,
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
  const keyDate = scheduled ? formatForexFactoryKeyDate(scheduled) : eventDate;
  const keyTime = scheduled ? formatForexFactoryKeyTime(scheduled) : '';
  const impact = normalizeImpact(event.impactName ?? null);
  const actual = cleanValue(event.actual ?? null);
  const forecast = cleanValue(event.forecast ?? null);
  const previous = cleanValue(event.previous ?? null);
  const revision = cleanValue(event.revision ?? null);
  const normalizedEventName = normalizeEventName(title, currency);
  const eventKey = stableKey([sourceName, keyDate, keyTime, currency, normalizedEventName]);
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
  const status = lifecycleStatusForCollectedEvent(scheduled, actual);

  return {
    id: `evt_${eventKey}`,
    sourceName,
    sourceUrl,
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

function lifecycleStatusForCollectedEvent(scheduled: Date | null, actual: string | null): EconomicEventStatus {
  if (actual) return 'RELEASED';
  if (!scheduled) return 'UPCOMING';

  const now = Date.now();
  const releaseTime = scheduled.getTime();

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
