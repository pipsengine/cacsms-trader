import { randomUUID } from 'node:crypto';

import { queryPostgres } from './postgres';
import { completePipelineStage, getLatestPipelineSession } from './top-down-orchestrator';

export type MacroComponentId = 'calendar' | 'cot' | 'rates' | 'blackout';

export interface MacroComponentStatus {
  id: MacroComponentId;
  label: string;
  status: 'ready' | 'partial' | 'missing';
  detail: string;
  progress: number;
}

export interface MacroIntelligenceFusion {
  id: string;
  symbol: string;
  sessionId: string | null;
  economicRiskScore: number;
  interestRateBias: string | null;
  cotBias: string | null;
  sentimentBias: string | null;
  blackoutActive: boolean;
  warning: string | null;
  components: MacroComponentStatus[];
  overallProgress: number;
  status: 'in_progress' | 'completed';
  context: Record<string, unknown>;
  fusedAt: string;
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS autonomous_macro_fusions (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  session_id UUID,
  economic_risk_score INTEGER NOT NULL DEFAULT 0,
  interest_rate_bias TEXT,
  cot_bias TEXT,
  sentiment_bias TEXT,
  blackout_active BOOLEAN NOT NULL DEFAULT false,
  warning TEXT,
  components_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  progress INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_autonomous_macro_fusions_symbol ON autonomous_macro_fusions(upper(symbol), created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureMacroIntelligenceSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

function parsePairCurrencies(symbol: string): [string, string] {
  const normalized = symbol.toUpperCase();
  if (normalized.startsWith('XAU')) return ['XAU', normalized.slice(3)];
  if (normalized.length >= 6) return [normalized.slice(0, 3), normalized.slice(3)];
  return [normalized.slice(0, 3), normalized.slice(3)];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function biasToScore(bias: string | null, rateChange?: unknown, surprise?: unknown): number {
  const normalized = String(bias ?? '').toLowerCase();
  let score = 50;
  if (normalized.includes('strong bull')) score += 20;
  else if (normalized.includes('bull')) score += 12;
  if (normalized.includes('strong bear')) score -= 20;
  else if (normalized.includes('bear')) score -= 12;
  if (normalized.includes('improving')) score += 4;
  if (normalized.includes('worsening')) score -= 4;
  const change = Number(rateChange);
  if (Number.isFinite(change)) score += Math.max(-10, Math.min(10, change * 25));
  const surpriseValue = Number(surprise);
  if (Number.isFinite(surpriseValue)) score += Math.max(-6, Math.min(6, surpriseValue * 8));
  return clampScore(score);
}

function impactMinutes(impactLevel: string, side: 'pre' | 'post'): number {
  const level = String(impactLevel ?? '').toLowerCase();
  const critical = level === 'critical';
  const high = level === 'high';
  if (side === 'pre') return critical ? 75 : high ? 45 : 30;
  return critical ? 90 : high ? 60 : 45;
}

function isBlackoutActive(now: number, startIso: string | null, endIso: string | null): boolean {
  const start = startIso ? Date.parse(startIso) : NaN;
  const end = endIso ? Date.parse(endIso) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return now >= start && now <= end;
}

async function loadCalendarComponent(symbol: string, currencies: string[]) {
  const upcoming = await queryPostgres(
    `SELECT COUNT(*)::int AS count
     FROM economic_events
     WHERE utc_event_time >= now()
       AND utc_event_time <= now() + interval '14 days'
       AND upper(currency) = ANY($1::text[])`,
    [currencies.map((item) => item.toUpperCase())],
  );
  const highImpactWindow = await queryPostgres(
    `SELECT COUNT(*)::int AS count
     FROM economic_events
     WHERE upper(impact_level) IN ('HIGH', 'CRITICAL')
       AND utc_event_time >= now() - interval '30 minutes'
       AND utc_event_time <= now() + interval '30 minutes'
       AND upper(currency) = ANY($1::text[])`,
    [currencies.map((item) => item.toUpperCase())],
  );
  const upcomingCount = Number(upcoming.rows[0]?.count ?? 0);
  const activeHighImpact = Number(highImpactWindow.rows[0]?.count ?? 0);
  const status: MacroComponentStatus['status'] = upcomingCount > 0 ? 'ready' : 'partial';
  return {
    id: 'calendar' as const,
    label: 'Economic calendar',
    status,
    detail:
      upcomingCount > 0
        ? `${upcomingCount} scheduled event(s) in the next 14 days for ${symbol} currencies.`
        : 'Calendar connected — no upcoming events in the next 14 days for active currencies.',
    progress: upcomingCount > 0 ? 25 : activeHighImpact > 0 ? 20 : 15,
    metrics: { upcomingCount, activeHighImpact },
  };
}

async function loadCotComponent(currencies: string[]) {
  const result = await queryPostgres(
    `SELECT DISTINCT ON (upper(currency))
       upper(currency) AS currency, bias, bias_strength, report_date::text AS report_date
     FROM cot_institutional_positions
     WHERE upper(currency) = ANY($1::text[])
     ORDER BY upper(currency), report_date DESC`,
    [currencies.map((item) => item.toUpperCase())],
  );
  const rows = result.rows;
  if (!rows.length) {
    return {
      id: 'cot' as const,
      label: 'COT positioning',
      status: 'missing' as const,
      detail: 'No COT positioning rows for active pair currencies.',
      progress: 0,
      metrics: { positions: 0 },
      cotBias: null as string | null,
    };
  }
  const labels = rows.map((row) => `${String(row.currency)} ${String(row.bias ?? 'Neutral')}`);
  const cotBias = labels.join(' / ');
  return {
    id: 'cot' as const,
    label: 'COT positioning',
    status: 'ready' as const,
    detail: `Latest COT bias: ${cotBias}.`,
    progress: 25,
    metrics: { positions: rows.length, reportDates: rows.map((row) => String(row.report_date)) },
    cotBias,
  };
}

async function loadRatesComponent(currencies: string[]) {
  const history = await queryPostgres(
    `SELECT DISTINCT ON (upper(currency))
       upper(currency) AS currency, bias, rate_change, surprise, release_date::text AS release_date
     FROM central_bank_rate_history
     WHERE upper(currency) = ANY($1::text[])
     ORDER BY upper(currency), release_date DESC NULLS LAST, fetched_at DESC`,
    [currencies.map((item) => item.toUpperCase())],
  );
  if (history.rows.length > 0) {
    const labels = history.rows.map((row) => `${String(row.currency)} ${String(row.bias ?? 'Neutral')}`);
    return {
      id: 'rates' as const,
      label: 'Interest rates',
      status: 'ready' as const,
      detail: `Central bank rate history: ${labels.join(', ')}.`,
      progress: 25,
      metrics: { historyRows: history.rows.length },
      interestRateBias: labels.join(' / '),
      source: 'central_bank_rate_history',
    };
  }

  const calendarRates = await queryPostgres(
    `SELECT DISTINCT ON (upper(currency))
       upper(currency) AS currency, bias, normalized_event_name, utc_event_time::text AS event_time
     FROM economic_events
     WHERE (
       normalized_event_name ILIKE '%interest rate%'
       OR normalized_event_name ILIKE '%rate decision%'
       OR normalized_event_name ILIKE '%monetary policy%'
     )
       AND upper(currency) = ANY($1::text[])
     ORDER BY upper(currency), utc_event_time DESC NULLS LAST`,
    [currencies.map((item) => item.toUpperCase())],
  );
  if (calendarRates.rows.length > 0) {
    const labels = calendarRates.rows.map((row) => `${String(row.currency)} ${String(row.bias ?? 'Neutral')}`);
    return {
      id: 'rates' as const,
      label: 'Interest rates',
      status: 'partial' as const,
      detail: `Rate history empty — using calendar policy events: ${labels.join(', ')}.`,
      progress: 18,
      metrics: { calendarRateEvents: calendarRates.rows.length },
      interestRateBias: labels.join(' / '),
      source: 'economic_calendar_fallback',
    };
  }

  const eventRegistry = await queryPostgres(
    `SELECT upper(currency) AS currency
     FROM central_bank_rate_events
     WHERE upper(currency) = ANY($1::text[]) AND is_active = true`,
    [currencies.map((item) => item.toUpperCase())],
  );
  if (eventRegistry.rows.length > 0) {
    const labels = eventRegistry.rows.map((row) => `${String(row.currency)} Neutral`);
    return {
      id: 'rates' as const,
      label: 'Interest rates',
      status: 'partial' as const,
      detail: `Rate registry ready (${labels.join(', ')}) — sync rate history for full policy bias.`,
      progress: 18,
      metrics: { registeredCurrencies: eventRegistry.rows.length },
      interestRateBias: labels.join(' / '),
      source: 'rate_events_registry',
    };
  }

  return {
    id: 'rates' as const,
    label: 'Interest rates',
    status: 'partial' as const,
    detail: 'No rate history loaded — using neutral monetary policy assumption for fusion.',
    progress: 12,
    metrics: {},
    interestRateBias: 'Neutral',
    source: 'neutral_fallback',
  };
}

async function loadBlackoutComponent(symbol: string, currencies: string[]) {
  const now = Date.now();
  const events = await queryPostgres(
    `SELECT id, event_name, currency, impact_level, utc_event_time, trade_restriction_required,
            restriction_start_time, restriction_end_time, affected_pairs
     FROM economic_events
     WHERE utc_event_time >= now() - interval '1 day'
       AND utc_event_time <= now() + interval '7 days'
       AND (
         upper(currency) = ANY($1::text[])
         OR affected_pairs::text ILIKE $2
       )`,
    [currencies.map((item) => item.toUpperCase()), `%${symbol.toUpperCase()}%`],
  );

  let activeBlackout = false;
  let nearestLabel = 'No active news blackout window.';
  const windows: Array<Record<string, unknown>> = [];

  for (const row of events.rows) {
    const startIso = row.restriction_start_time
      ? String(row.restriction_start_time)
      : row.utc_event_time
        ? new Date(Date.parse(String(row.utc_event_time)) - impactMinutes(String(row.impact_level), 'pre') * 60_000).toISOString()
        : null;
    const endIso = row.restriction_end_time
      ? String(row.restriction_end_time)
      : row.utc_event_time
        ? new Date(Date.parse(String(row.utc_event_time)) + impactMinutes(String(row.impact_level), 'post') * 60_000).toISOString()
        : null;
    const active = isBlackoutActive(now, startIso, endIso);
    if (active) {
      activeBlackout = true;
      nearestLabel = `News blackout active around ${String(row.event_name)} (${String(row.currency)}).`;
    }
    windows.push({
      eventId: String(row.id),
      eventName: String(row.event_name),
      currency: String(row.currency),
      impactLevel: String(row.impact_level),
      active,
      startIso,
      endIso,
      tradeRestrictionRequired: Boolean(row.trade_restriction_required),
    });
  }

  return {
    id: 'blackout' as const,
    label: 'News blackout',
    status: 'ready' as const,
    detail: activeBlackout ? nearestLabel : `No active blackout — ${windows.length} risk window(s) tracked for ${symbol}.`,
    progress: 25,
    metrics: { windowsTracked: windows.length, activeBlackout },
    blackoutActive: activeBlackout,
    windows,
  };
}

export async function fuseMacroIntelligence(symbol: string, sessionId?: string | null): Promise<MacroIntelligenceFusion> {
  await ensureMacroIntelligenceSchema();
  const normalized = symbol.toUpperCase();
  const [base, quote] = parsePairCurrencies(normalized);
  const currencies = Array.from(new Set([base, quote]));

  const [calendar, cot, rates, blackout] = await Promise.all([
    loadCalendarComponent(normalized, currencies),
    loadCotComponent(currencies),
    loadRatesComponent(currencies),
    loadBlackoutComponent(normalized, currencies),
  ]);

  const components: MacroComponentStatus[] = [calendar, cot, rates, blackout];
  const overallProgress = clampScore(components.reduce((sum, item) => sum + item.progress, 0));
  const baseScore = biasToScore(cot.cotBias);
  const quoteScore = biasToScore(rates.interestRateBias);
  const calendarRisk = Number((calendar.metrics as { activeHighImpact?: number }).activeHighImpact ?? 0);
  const economicRiskScore = clampScore(
    (blackout.blackoutActive ? 85 : calendarRisk > 0 ? 70 : 25)
    + (100 - Math.abs(baseScore - quoteScore)) * 0.05,
  );

  let warning: string | null = null;
  if (blackout.blackoutActive) warning = `News blackout active for ${normalized}.`;
  else if (calendarRisk > 0) warning = `High-impact macro event window active for ${normalized} currencies.`;

  const sentimentBias = calendarRisk > 0 ? 'risk_off' : baseScore > quoteScore + 8 ? 'bullish' : quoteScore > baseScore + 8 ? 'bearish' : 'neutral';
  const status: 'in_progress' | 'completed' =
    components.every((item) => item.status !== 'missing') ? 'completed' : 'in_progress';

  const fusion: MacroIntelligenceFusion = {
    id: randomUUID(),
    symbol: normalized,
    sessionId: sessionId ?? null,
    economicRiskScore,
    interestRateBias: rates.interestRateBias,
    cotBias: cot.cotBias,
    sentimentBias,
    blackoutActive: blackout.blackoutActive,
    warning,
    components,
    overallProgress: status === 'completed' ? 100 : overallProgress,
    status,
    context: {
      currencies,
      calendar: calendar.metrics,
      cot: cot.metrics,
      rates: rates.metrics,
      ratesSource: (rates as { source?: string }).source ?? null,
      blackout: blackout.metrics,
      blackoutWindows: blackout.windows,
    },
    fusedAt: new Date().toISOString(),
  };

  await queryPostgres(
    `INSERT INTO autonomous_macro_fusions (
      id, symbol, session_id, economic_risk_score, interest_rate_bias, cot_bias, sentiment_bias,
      blackout_active, warning, components_json, context_json, progress, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13)`,
    [
      fusion.id,
      fusion.symbol,
      fusion.sessionId,
      fusion.economicRiskScore,
      fusion.interestRateBias,
      fusion.cotBias,
      fusion.sentimentBias,
      fusion.blackoutActive,
      fusion.warning,
      JSON.stringify(fusion.components),
      JSON.stringify(fusion.context),
      fusion.overallProgress,
      fusion.status,
    ],
  );

  return fusion;
}

export async function getLatestMacroFusion(symbol: string): Promise<MacroIntelligenceFusion | null> {
  await ensureMacroIntelligenceSchema();
  const result = await queryPostgres(
    'SELECT * FROM autonomous_macro_fusions WHERE upper(symbol) = $1 ORDER BY created_at DESC LIMIT 1',
    [symbol.toUpperCase()],
  );
  const row = result.rows[0];
  if (!row) return null;
  return mapFusionRow(row);
}

export async function getMacroContextForSymbol(symbol: string) {
  const { shouldBypassNewsBlackout } = await import('./trading-session-policy');
  const softenNewsRisk = shouldBypassNewsBlackout();
  const latest = await getLatestMacroFusion(symbol);
  if (latest) {
    return {
      economicRiskScore: softenNewsRisk ? Math.min(latest.economicRiskScore, 55) : latest.economicRiskScore,
      interestRateBias: latest.interestRateBias,
      cotBias: latest.cotBias,
      sentimentBias: latest.sentimentBias,
      warning: softenNewsRisk ? null : latest.warning,
    };
  }
  const fusion = await fuseMacroIntelligence(symbol);
  return {
    economicRiskScore: softenNewsRisk ? Math.min(fusion.economicRiskScore, 55) : fusion.economicRiskScore,
    interestRateBias: fusion.interestRateBias,
    cotBias: fusion.cotBias,
    sentimentBias: fusion.sentimentBias,
    warning: softenNewsRisk ? null : fusion.warning,
  };
}

export async function advanceMacroIntelligence(symbol: string): Promise<MacroIntelligenceFusion> {
  const session = await getLatestPipelineSession(symbol);
  const sessionId = session?.id ? String(session.id) : null;
  const fusion = await fuseMacroIntelligence(symbol, sessionId);

  if (sessionId && fusion.status === 'completed') {
    const readyComponents = fusion.components.filter((item) => item.status !== 'missing');
    await completePipelineStage(sessionId, 'macro-intelligence', 100, {
      eventType: 'macro.fusion.completed',
      message: `Macro intelligence fused (${readyComponents.map((item) => item.label).join(', ')}).`,
      payload: {
        economicRiskScore: fusion.economicRiskScore,
        blackoutActive: fusion.blackoutActive,
        cotBias: fusion.cotBias,
        interestRateBias: fusion.interestRateBias,
      },
    });
  }

  return fusion;
}

export async function getMacroPipelineStatus(symbol: string) {
  const latest = await getLatestMacroFusion(symbol);
  if (!latest) {
    return {
      status: 'not_started' as const,
      detail: 'Macro intelligence not fused yet for active symbol.',
      progress: 0,
      metrics: {},
    };
  }

  const componentSummary = latest.components
    .map((item) => `${item.label}: ${item.status}`)
    .join(' · ');

  if (latest.status === 'completed') {
    return {
      status: 'completed' as const,
      detail: `Macro context fused — ${componentSummary}.`,
      progress: 100,
      metrics: {
        economicRiskScore: latest.economicRiskScore,
        blackoutActive: latest.blackoutActive,
        components: latest.components,
        fusedAt: latest.fusedAt,
      },
    };
  }

  return {
    status: 'in_progress' as const,
    detail: `Macro fusion in progress (${latest.overallProgress}%) — ${componentSummary}.`,
    progress: latest.overallProgress,
    metrics: {
      economicRiskScore: latest.economicRiskScore,
      blackoutActive: latest.blackoutActive,
      components: latest.components,
      fusedAt: latest.fusedAt,
    },
  };
}

function mapFusionRow(row: Record<string, unknown>): MacroIntelligenceFusion {
  const components = Array.isArray(row.components_json) ? row.components_json as MacroComponentStatus[] : [];
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    sessionId: row.session_id ? String(row.session_id) : null,
    economicRiskScore: Number(row.economic_risk_score ?? 0),
    interestRateBias: row.interest_rate_bias ? String(row.interest_rate_bias) : null,
    cotBias: row.cot_bias ? String(row.cot_bias) : null,
    sentimentBias: row.sentiment_bias ? String(row.sentiment_bias) : null,
    blackoutActive: Boolean(row.blackout_active),
    warning: row.warning ? String(row.warning) : null,
    components,
    overallProgress: Number(row.progress ?? 0),
    status: String(row.status) === 'completed' ? 'completed' : 'in_progress',
    context: objectValue(row.context_json),
    fusedAt: String(row.created_at),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
