import { NextResponse } from 'next/server';
import { queryPostgres } from '@/lib/postgres';
import { ensureEconomicCalendarWorkerStarted } from '@/services/economic-data-service/src/economic-calendar-intelligence';

export const dynamic = 'force-dynamic';

type ImpactLevel = 'Low' | 'Medium' | 'High' | 'Critical' | string;

type MacroCategory = 'inflation' | 'employment' | 'growth' | 'policy' | 'other';

type MacroType =
  | 'cpi'
  | 'core_cpi'
  | 'inflation_rate'
  | 'nfp'
  | 'employment_change'
  | 'avg_hourly_earnings'
  | 'unemployment_rate'
  | 'jobless_claims'
  | 'gdp'
  | 'pmi'
  | 'industrial_production'
  | 'retail_sales'
  | 'rate_decision'
  | 'unknown';

type EconomicEventRow = {
  id: string;
  event_name: string;
  normalized_event_name: string;
  country: string;
  currency: string;
  impact_level: ImpactLevel;
  unit: string | null;
  event_date: string;
  event_time: string | null;
  utc_event_time: string | null;
  actual_value: string | null;
  forecast_value: string | null;
  previous_value: string | null;
  revised_previous_value: string | null;
  surprise_value: number | null;
  surprise_direction: string | null;
  status: string;
  source_url: string | null;
  updated_at: string;
};

type RateHistoryRow = {
  currency: string;
  central_bank: string | null;
  release_date: string;
  release_time: string | null;
  actual_rate: number | null;
  previous_rate: number | null;
  rate_change: number | null;
  surprise: number | null;
  bias: string | null;
  fetched_at: string;
};

const majorCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'] as const;
const presets = ['balanced', 'rates_led', 'data_led'] as const;

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_ECONOMIC_CALENDAR_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('Economic Calendar requires local machine access.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('Economic Calendar requires local machine access.');
  }
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function impactWeight(level: ImpactLevel): number {
  const s = String(level ?? '').toLowerCase();
  if (s === 'critical') return 1.25;
  if (s === 'high') return 1.1;
  if (s === 'medium') return 1.0;
  if (s === 'low') return 0.85;
  return 1.0;
}

function timeDecayWeight(eventDate: string, halfLifeDays: number): number {
  const ts = Date.parse(`${eventDate}T00:00:00.000Z`);
  if (!Number.isFinite(ts)) return 1.0;
  const days = Math.max(0, (Date.now() - ts) / (24 * 60 * 60_000));
  const lambda = Math.log(2) / Math.max(1, halfLifeDays);
  return Math.exp(-lambda * days);
}

function median(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid] ?? null;
  const a = nums[mid - 1];
  const b = nums[mid];
  if (a == null || b == null) return null;
  return (a + b) / 2;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function inferMacroKind(name: string): { category: MacroCategory; type: MacroType; higherIsBullish: boolean } {
  const s = normalizeText(name);

  const isCore = /\bcore\b/.test(s);
  const isInflation = /\bcpi\b|\bconsumer price\b|\bhicp\b|\bharmonized\b|\binflation\b/.test(s);
  if (isInflation) {
    if (/\binflation rate\b/.test(s)) return { category: 'inflation', type: 'inflation_rate', higherIsBullish: true };
    if (isCore) return { category: 'inflation', type: 'core_cpi', higherIsBullish: true };
    return { category: 'inflation', type: 'cpi', higherIsBullish: true };
  }

  if (/\bnon[-\s]?farm\b|\bnonfarm\b|\bpayrolls?\b|\bnfp\b/.test(s)) return { category: 'employment', type: 'nfp', higherIsBullish: true };
  if (/\bemployment\b.*\bchange\b|\bchange in employment\b|\bemployment change\b/.test(s)) return { category: 'employment', type: 'employment_change', higherIsBullish: true };
  if (/\bavg\b.*\bhourly\b.*\bearnings\b|\baverage hourly earnings\b/.test(s)) return { category: 'employment', type: 'avg_hourly_earnings', higherIsBullish: true };
  if (/\bunemployment\b/.test(s) && /\brate\b|\b%\b/.test(s)) return { category: 'employment', type: 'unemployment_rate', higherIsBullish: false };
  if (/\bjobless\b|\bclaims?\b/.test(s)) return { category: 'employment', type: 'jobless_claims', higherIsBullish: false };

  if (/\bgdp\b|\bgross domestic product\b/.test(s)) return { category: 'growth', type: 'gdp', higherIsBullish: true };
  if (/\bpmi\b|\bpurchasing managers\b/.test(s)) return { category: 'growth', type: 'pmi', higherIsBullish: true };
  if (/\bindustrial production\b|\bindustrial prod\b|\bmanufacturing production\b/.test(s)) return { category: 'growth', type: 'industrial_production', higherIsBullish: true };
  if (/\bretail sales\b/.test(s)) return { category: 'growth', type: 'retail_sales', higherIsBullish: true };

  if (/\binterest rate decision\b|\brate decision\b|\bpolicy rate\b/.test(s)) return { category: 'policy', type: 'rate_decision', higherIsBullish: true };

  return { category: 'other', type: 'unknown', higherIsBullish: true };
}

function presetWeights(preset: (typeof presets)[number]): Record<string, number> {
  if (preset === 'rates_led') {
    return { inflation: 0.2, employment: 0.15, growth: 0.15, policy: 0.35, carry: 0.15 };
  }
  if (preset === 'data_led') {
    return { inflation: 0.3, employment: 0.25, growth: 0.25, policy: 0.1, carry: 0.1 };
  }
  return { inflation: 0.25, employment: 0.25, growth: 0.2, policy: 0.2, carry: 0.1 };
}

function biasToPoints(bias: string | null): number {
  const b = String(bias ?? '').toLowerCase();
  if (!b) return 0;
  if (b.includes('hawk')) return 10;
  if (b.includes('dov')) return -10;
  if (b.includes('hold')) return 0;
  if (b.includes('hike')) return 8;
  if (b.includes('cut')) return -8;
  if (b.includes('neutral')) return 0;
  return 0;
}

function safeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
    ensureEconomicCalendarWorkerStarted();

    const url = new URL(request.url);
    const horizonDaysRaw = safeNumber(url.searchParams.get('horizonDays') ?? 180) ?? 180;
    const horizonDays = Math.max(30, Math.min(730, Math.floor(horizonDaysRaw)));
    const presetRaw = String(url.searchParams.get('preset') ?? 'balanced').trim().toLowerCase();
    const preset = (presets.includes(presetRaw as any) ? presetRaw : 'balanced') as (typeof presets)[number];
    const from = daysAgo(horizonDays);
    const to = isoDate(new Date());

    const patterns = [
      '%cpi%',
      '%consumer price%',
      '%inflation%',
      '%hicp%',
      '%harmonized%',
      '%nonfarm%',
      '%non-farm%',
      '%payroll%',
      '%nfp%',
      '%unemployment%',
      '%employment%',
      '%jobless%',
      '%claims%',
      '%average hourly earnings%',
      '%avg hourly earnings%',
      '%adp%',
      '%gdp%',
      '%gross domestic product%',
      '%industrial production%',
      '%manufacturing production%',
      '%pmi%',
      '%purchasing managers%',
      '%retail sales%',
      '%interest rate decision%',
      '%rate decision%',
      '%policy rate%',
    ];

    const events = await queryPostgres(
      `
        SELECT
          id::text AS id,
          event_name,
          normalized_event_name,
          country,
          currency,
          impact_level,
          unit,
          event_date::text AS event_date,
          event_time::text AS event_time,
          utc_event_time::text AS utc_event_time,
          actual_value,
          forecast_value,
          previous_value,
          revised_previous_value,
          surprise_value,
          surprise_direction,
          status,
          source_url,
          updated_at::text AS updated_at
        FROM economic_events
        WHERE event_date >= $1::date
          AND event_date <= $2::date
          AND currency = ANY($3::text[])
          AND (normalized_event_name ILIKE ANY($4::text[]) OR event_name ILIKE ANY($4::text[]))
          AND surprise_value IS NOT NULL
        ORDER BY event_date DESC, utc_event_time DESC NULLS LAST, updated_at DESC
        LIMIT 5000
      `,
      [from, to, [...majorCurrencies], patterns],
    ).then((r) => r.rows as unknown as EconomicEventRow[]);

    const scoredEvents = events
      .map((row) => {
        const inferred = inferMacroKind(row.normalized_event_name || row.event_name);
        const currency = String(row.currency ?? '').trim().toUpperCase();
        if (!currency) return null;
        if (!majorCurrencies.includes(currency as any)) return null;
        if (inferred.category === 'other') return null;
        const surprise = row.surprise_value;
        if (surprise == null || !Number.isFinite(surprise)) return null;
        const direction = inferred.higherIsBullish ? 1 : -1;
        const effectiveSurprise = surprise * direction;
        return {
          id: row.id,
          currency,
          country: row.country,
          eventName: row.event_name,
          normalizedEventName: row.normalized_event_name,
          impactLevel: row.impact_level,
          eventDate: row.event_date,
          utcEventTime: row.utc_event_time,
          actualValue: row.actual_value,
          forecastValue: row.forecast_value,
          previousValue: row.revised_previous_value ?? row.previous_value,
          surpriseValue: surprise,
          effectiveSurprise,
          category: inferred.category,
          type: inferred.type,
          sourceUrl: row.source_url,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      currency: string;
      country: string;
      eventName: string;
      normalizedEventName: string;
      impactLevel: ImpactLevel;
      eventDate: string;
      utcEventTime: string | null;
      actualValue: string | null;
      forecastValue: string | null;
      previousValue: string | null;
      surpriseValue: number;
      effectiveSurprise: number;
      category: MacroCategory;
      type: MacroType;
      sourceUrl: string | null;
    }>;

    const typeScale: Record<string, number> = {};
    const byTypeAbs: Record<string, number[]> = {};
    for (const ev of scoredEvents) {
      const key = ev.type;
      if (!byTypeAbs[key]) byTypeAbs[key] = [];
      byTypeAbs[key].push(Math.abs(ev.surpriseValue));
    }
    for (const [key, list] of Object.entries(byTypeAbs)) {
      const m = median(list);
      typeScale[key] = m != null && m > 0 ? m : 1;
    }

    const halfLifeDays = Math.max(30, Math.min(120, Math.round(horizonDays / 3)));
    const perCurrency: Record<
      string,
      {
        currency: string;
        buckets: Record<MacroCategory, { weightedSum: number; weight: number; count: number }>;
        topDrivers: Array<any>;
      }
    > = {};
    for (const cur of majorCurrencies) {
      perCurrency[cur] = {
        currency: cur,
        buckets: {
          inflation: { weightedSum: 0, weight: 0, count: 0 },
          employment: { weightedSum: 0, weight: 0, count: 0 },
          growth: { weightedSum: 0, weight: 0, count: 0 },
          policy: { weightedSum: 0, weight: 0, count: 0 },
          other: { weightedSum: 0, weight: 0, count: 0 },
        },
        topDrivers: [],
      };
    }

    for (const ev of scoredEvents) {
      const scale = typeScale[ev.type] ?? 1;
      const normalized = clamp(ev.effectiveSurprise / Math.max(1e-9, scale), -3, 3);
      const w = impactWeight(ev.impactLevel) * timeDecayWeight(ev.eventDate, halfLifeDays);
      const contrib = normalized * w;

      const slot = perCurrency[ev.currency];
      if (!slot) continue;
      slot.buckets[ev.category].weightedSum += contrib;
      slot.buckets[ev.category].weight += w;
      slot.buckets[ev.category].count += 1;

      slot.topDrivers.push({
        id: ev.id,
        currency: ev.currency,
        category: ev.category,
        type: ev.type,
        eventDate: ev.eventDate,
        eventName: ev.eventName,
        impactLevel: ev.impactLevel,
        surpriseValue: ev.surpriseValue,
        normalizedImpact: normalized,
        contribution: contrib,
        actualValue: ev.actualValue,
        forecastValue: ev.forecastValue,
        previousValue: ev.previousValue,
        sourceUrl: ev.sourceUrl,
      });
    }

    for (const cur of majorCurrencies) {
      perCurrency[cur].topDrivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
      perCurrency[cur].topDrivers = perCurrency[cur].topDrivers.slice(0, 14);
    }

    const latestRates = await queryPostgres(
      `
        SELECT DISTINCT ON (h.currency)
          h.currency,
          h.central_bank,
          h.release_date::text AS release_date,
          h.release_time,
          h.actual_rate,
          h.previous_rate,
          h.rate_change,
          h.surprise,
          h.bias,
          h.fetched_at::text AS fetched_at
        FROM central_bank_rate_history h
        WHERE h.currency = ANY($1::text[])
        ORDER BY h.currency, h.release_date DESC, h.release_time DESC, h.fetched_at DESC
      `,
      [[...majorCurrencies]],
    ).then((r) => r.rows as unknown as RateHistoryRow[]);

    const byCurrencyLatestRate = new Map<string, RateHistoryRow>();
    for (const row of latestRates) {
      const cur = String(row.currency ?? '').trim().toUpperCase();
      if (!cur) continue;
      byCurrencyLatestRate.set(cur, row);
    }

    const rateMomentumRows = await queryPostgres(
      `
        SELECT
          h.currency,
          h.release_date::text AS release_date,
          h.release_time,
          h.actual_rate,
          h.previous_rate,
          h.rate_change,
          h.surprise,
          h.bias
        FROM central_bank_rate_history h
        WHERE h.currency = ANY($1::text[])
          AND h.release_date >= (CURRENT_DATE - INTERVAL '3 years')
        ORDER BY h.currency, h.release_date DESC, h.release_time DESC NULLS LAST, h.fetched_at DESC
      `,
      [[...majorCurrencies]],
    ).then((r) => r.rows as unknown as Array<{ currency: string; release_date: string; release_time: string | null; actual_rate: number | null; previous_rate: number | null; rate_change: number | null; surprise: number | null; bias: string | null }>);

    const last3ByCurrency: Record<string, Array<{ rate_change: number | null; surprise: number | null; bias: string | null }>> = {};
    for (const cur of majorCurrencies) last3ByCurrency[cur] = [];
    for (const row of rateMomentumRows) {
      const cur = String(row.currency ?? '').trim().toUpperCase();
      if (!cur) continue;
      if (!last3ByCurrency[cur]) last3ByCurrency[cur] = [];
      if (last3ByCurrency[cur].length >= 3) continue;
      last3ByCurrency[cur].push({ rate_change: row.rate_change, surprise: row.surprise, bias: row.bias });
    }

    const rateLevels: Array<{ currency: string; rate: number }> = [];
    for (const cur of majorCurrencies) {
      const r = byCurrencyLatestRate.get(cur);
      const rate = r?.actual_rate;
      if (rate == null || !Number.isFinite(rate)) continue;
      rateLevels.push({ currency: cur, rate });
    }

    const meanRate = rateLevels.length ? rateLevels.reduce((a, b) => a + b.rate, 0) / rateLevels.length : 0;
    const stdRate =
      rateLevels.length > 1
        ? Math.sqrt(rateLevels.reduce((a, b) => a + (b.rate - meanRate) * (b.rate - meanRate), 0) / (rateLevels.length - 1))
        : 0;

    const upcomingRiskRows = await queryPostgres(
      `
        SELECT
          id::text AS id,
          event_name,
          normalized_event_name,
          country,
          currency,
          impact_level,
          event_date::text AS event_date,
          event_time::text AS event_time,
          utc_event_time::text AS utc_event_time,
          status,
          source_url,
          trade_restriction_required,
          restriction_start_time::text AS restriction_start_time,
          restriction_end_time::text AS restriction_end_time
        FROM economic_events
        WHERE currency = ANY($1::text[])
          AND event_date >= CURRENT_DATE
          AND event_date <= (CURRENT_DATE + INTERVAL '2 days')
          AND impact_level IN ('High','Critical')
          AND (actual_value IS NULL OR actual_value = '')
        ORDER BY event_date ASC, utc_event_time ASC NULLS LAST, updated_at DESC
        LIMIT 1200
      `,
      [[...majorCurrencies]],
    ).then((r) => r.rows as Array<any>);

    const upcomingByCurrency: Record<string, Array<any>> = {};
    for (const cur of majorCurrencies) upcomingByCurrency[cur] = [];
    for (const row of upcomingRiskRows) {
      const cur = String(row.currency ?? '').trim().toUpperCase();
      if (!cur) continue;
      if (!upcomingByCurrency[cur]) upcomingByCurrency[cur] = [];
      if (upcomingByCurrency[cur].length >= 18) continue;
      upcomingByCurrency[cur].push({
        id: String(row.id),
        currency: cur,
        eventDate: String(row.event_date),
        eventTime: row.event_time ? String(row.event_time) : null,
        utcEventTime: row.utc_event_time ? String(row.utc_event_time) : null,
        eventName: String(row.event_name),
        impactLevel: String(row.impact_level),
        status: String(row.status),
        tradeRestrictionRequired: Boolean(row.trade_restriction_required),
        restrictionStartTime: row.restriction_start_time ? String(row.restriction_start_time) : null,
        restrictionEndTime: row.restriction_end_time ? String(row.restriction_end_time) : null,
        sourceUrl: row.source_url ? String(row.source_url) : null,
      });
    }

    const w = presetWeights(preset);

    const results = majorCurrencies.map((cur) => {
      const slot = perCurrency[cur];
      const inflation = slot.buckets.inflation;
      const employment = slot.buckets.employment;
      const growth = slot.buckets.growth;
      const policy = slot.buckets.policy;

      const inflationAvg = inflation.weight > 0 ? inflation.weightedSum / inflation.weight : 0;
      const employmentAvg = employment.weight > 0 ? employment.weightedSum / employment.weight : 0;
      const growthAvg = growth.weight > 0 ? growth.weightedSum / growth.weight : 0;
      const policyAvg = policy.weight > 0 ? policy.weightedSum / policy.weight : 0;

      const inflationPoints = clamp(inflationAvg * 14, -30, 30);
      const employmentPoints = clamp(employmentAvg * 14, -30, 30);
      const growthPoints = clamp(growthAvg * 12, -25, 25);
      const policyDataPoints = clamp(policyAvg * 12, -25, 25);

      const latest = byCurrencyLatestRate.get(cur) ?? null;
      const carryZ = stdRate > 0 && latest?.actual_rate != null ? (latest.actual_rate - meanRate) / stdRate : 0;
      const carryPoints = clamp(carryZ * 8, -20, 20);

      const last3 = last3ByCurrency[cur] ?? [];
      const netChange = last3.reduce((a, b) => a + (b.rate_change ?? 0), 0);
      const absNetChangeMax = Math.max(
        0.25,
        ...majorCurrencies.map((c) => Math.abs((last3ByCurrency[c] ?? []).reduce((a, b) => a + (b.rate_change ?? 0), 0))),
      );
      const momentumPoints = clamp((netChange / absNetChangeMax) * 12, -15, 15);

      const biasPoints = biasToPoints(latest?.bias ?? null);
      const policyPoints = clamp(policyDataPoints + momentumPoints + biasPoints, -35, 35);

      const upcoming = upcomingByCurrency[cur] ?? [];
      const highCount = upcoming.filter((x) => String(x.impactLevel ?? '') === 'High').length;
      const criticalCount = upcoming.filter((x) => String(x.impactLevel ?? '') === 'Critical').length;
      const restrictionCount = upcoming.filter((x) => Boolean(x.tradeRestrictionRequired)).length;
      const riskPenalty = -clamp(highCount * 2.5 + criticalCount * 4 + restrictionCount * 3, 0, 22);

      const rawScore =
        inflationPoints * w.inflation +
        employmentPoints * w.employment +
        growthPoints * w.growth +
        policyPoints * w.policy +
        carryPoints * w.carry +
        riskPenalty;

      const score = clamp(rawScore, -100, 100);

      const evidenceCount = inflation.count + employment.count + growth.count + policy.count;
      const evidenceWeights = inflation.weight + employment.weight + growth.weight + policy.weight;
      const coverage = clamp(evidenceCount / 18, 0, 1);
      const recency = clamp(evidenceWeights / Math.max(1, evidenceCount), 0, 1);
      const confidence = clamp(Math.round((coverage * 70 + recency * 30) - (Math.abs(riskPenalty) * 0.8)), 0, 100);

      return {
        currency: cur,
        score,
        confidence,
        components: {
          inflation: inflationPoints,
          employment: employmentPoints,
          growth: growthPoints,
          policy: policyPoints,
          carry: carryPoints,
          riskPenalty,
        },
        evidence: {
          horizonDays,
          eventCounts: {
            inflation: inflation.count,
            employment: employment.count,
            growth: growth.count,
            policy: policy.count,
          },
          topDrivers: slot.topDrivers,
          upcomingRiskEvents: upcoming,
        },
        rates: latest
          ? {
              centralBank: latest.central_bank,
              releaseDate: latest.release_date,
              releaseTime: latest.release_time,
              actualRate: latest.actual_rate,
              previousRate: latest.previous_rate,
              rateChange: latest.rate_change,
              surprise: latest.surprise,
              bias: latest.bias,
              fetchedAt: latest.fetched_at,
            }
          : null,
      };
    });

    const strongestBullish = [...results].sort((a, b) => b.score - a.score)[0] ?? null;
    const strongestBearish = [...results].sort((a, b) => a.score - b.score)[0] ?? null;
    const highestConfidence = [...results].sort((a, b) => b.confidence - a.confidence)[0] ?? null;

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        horizonDays,
        preset,
        summary: {
          strongestBullish: strongestBullish ? { currency: strongestBullish.currency, score: strongestBullish.score } : null,
          strongestBearish: strongestBearish ? { currency: strongestBearish.currency, score: strongestBearish.score } : null,
          highestConfidence: highestConfidence ? { currency: highestConfidence.currency, confidence: highestConfidence.confidence } : null,
        },
        rows: results,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, generatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'fundamental_bias_scoring_failed', rows: [] },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

