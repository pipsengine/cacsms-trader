import { NextResponse } from 'next/server';
import { queryPostgres } from '@/lib/postgres';
import { ensureEconomicCalendarWorkerStarted } from '@/services/economic-data-service/src/economic-calendar-intelligence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ImpactLevel = 'Low' | 'Medium' | 'High' | 'Critical' | string;

type RateRow = {
  currency: string;
  central_bank: string | null;
  release_date: string;
  release_time: string | null;
  actual_rate: number | null;
  rate_change: number | null;
  bias: string | null;
  fetched_at: string;
};

type RateHistoryRow = {
  release_date: string;
  release_time: string | null;
  actual_rate: number | null;
};

type EconomicEventRow = {
  id: string;
  event_name: string;
  normalized_event_name: string;
  currency: string;
  impact_level: ImpactLevel;
  event_date: string;
  event_time: string | null;
  utc_event_time: string | null;
  actual_value: string | null;
  forecast_value: string | null;
  previous_value: string | null;
  revised_previous_value: string | null;
  surprise_value: number | null;
  status: string;
  source_url: string | null;
  updated_at: string;
};

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

function daysAhead(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function parsePercent(value: string | null | undefined): number | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const m = s.match(/([-+]?\d[\d,]*\.?\d*)/);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function monthKey(dateIso: string): string | null {
  const m = String(dateIso ?? '').match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m?.[1] || !m?.[2]) return null;
  return `${m[1]}-${m[2]}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stdev(values: number[]): number {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length <= 1) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function mean(values: number[]): number {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function classifyUsdMacroScore(points: number): 'bullish_usd' | 'neutral_usd' | 'bearish_usd' {
  if (points >= 20) return 'bullish_usd';
  if (points <= -20) return 'bearish_usd';
  return 'neutral_usd';
}

function classifyGoldBias(points: number): 'bullish_gold' | 'neutral_gold' | 'bearish_gold' {
  if (points >= 20) return 'bullish_gold';
  if (points <= -20) return 'bearish_gold';
  return 'neutral_gold';
}

function isReleased(row: EconomicEventRow): boolean {
  const actual = String(row.actual_value ?? '').trim();
  if (actual) return true;
  return ['RELEASED', 'ANALYZED', 'ARCHIVED'].includes(String(row.status ?? '').toUpperCase());
}

function weightByImpact(impact: ImpactLevel): number {
  const s = String(impact ?? '').toLowerCase();
  if (s === 'critical') return 1.25;
  if (s === 'high') return 1.1;
  if (s === 'medium') return 1.0;
  if (s === 'low') return 0.85;
  return 1.0;
}

function timeDecay(eventDate: string, halfLifeDays: number): number {
  const ts = Date.parse(`${eventDate}T00:00:00.000Z`);
  if (!Number.isFinite(ts)) return 1;
  const days = Math.max(0, (Date.now() - ts) / (24 * 60 * 60_000));
  const lambda = Math.log(2) / Math.max(1, halfLifeDays);
  return Math.exp(-lambda * days);
}

type CpiPoint = {
  month: string;
  eventDate: string;
  headlineYoy: number | null;
  coreYoy: number | null;
  policyRate: number | null;
  realRateProxy: number | null;
};

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
    ensureEconomicCalendarWorkerStarted();

    const url = new URL(request.url);
    const horizonDaysRaw = Number(url.searchParams.get('horizonDays') ?? 365);
    const horizonDays = Number.isFinite(horizonDaysRaw) ? clamp(Math.floor(horizonDaysRaw), 90, 1460) : 365;
    const from = daysAgo(horizonDays);
    const to = isoDate(new Date());

    const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'] as const;

    const latestRates = await queryPostgres(
      `
        SELECT DISTINCT ON (h.currency)
          h.currency,
          h.central_bank,
          h.release_date::text AS release_date,
          h.release_time,
          h.actual_rate,
          h.rate_change,
          h.bias,
          h.fetched_at::text AS fetched_at
        FROM central_bank_rate_history h
        WHERE h.currency = ANY($1::text[])
        ORDER BY h.currency, h.release_date DESC, h.release_time DESC NULLS LAST, h.fetched_at DESC
      `,
      [[...currencies]],
    ).then((r) => r.rows as unknown as RateRow[]);

    const ratesByCurrency = new Map<string, RateRow>();
    for (const row of latestRates) {
      const cur = String(row.currency ?? '').toUpperCase();
      if (cur) ratesByCurrency.set(cur, row);
    }

    const usdRateHistory = await queryPostgres(
      `
        SELECT
          release_date::text AS release_date,
          release_time,
          actual_rate
        FROM central_bank_rate_history
        WHERE currency = 'USD'
          AND release_date >= $1::date
          AND release_date <= $2::date
        ORDER BY release_date ASC, release_time ASC NULLS LAST, fetched_at ASC
      `,
      [from, to],
    ).then((r) => r.rows as unknown as RateHistoryRow[]);

    const usdRateHistorySorted = [...usdRateHistory].sort((a, b) => (a.release_date < b.release_date ? -1 : a.release_date > b.release_date ? 1 : 0));

    const cpiPatterns = ['%cpi%', '%consumer price%', '%inflation%', '%hicp%', '%harmonized%'];
    const usdCpiRows = await queryPostgres(
      `
        SELECT
          id::text AS id,
          event_name,
          normalized_event_name,
          currency,
          impact_level,
          event_date::text AS event_date,
          event_time::text AS event_time,
          utc_event_time::text AS utc_event_time,
          actual_value,
          forecast_value,
          previous_value,
          revised_previous_value,
          surprise_value,
          status,
          source_url,
          updated_at::text AS updated_at
        FROM economic_events
        WHERE currency = 'USD'
          AND event_date >= $1::date
          AND event_date <= $2::date
          AND (normalized_event_name ILIKE ANY($3::text[]) OR event_name ILIKE ANY($3::text[]))
        ORDER BY event_date DESC, utc_event_time DESC NULLS LAST, updated_at DESC
        LIMIT 1500
      `,
      [from, to, cpiPatterns],
    ).then((r) => r.rows as unknown as EconomicEventRow[]);

    const headlineByMonth = new Map<string, { eventDate: string; value: number }>();
    const coreByMonth = new Map<string, { eventDate: string; value: number }>();

    for (const row of usdCpiRows) {
      if (!isReleased(row)) continue;
      const mk = monthKey(row.event_date);
      if (!mk) continue;
      const name = normalizeText(row.normalized_event_name || row.event_name);
      const isYoY = /\byoy\b|y\/y|year over year|y-o-y/.test(name);
      if (!isYoY) continue;
      const value = parsePercent(row.actual_value);
      if (value == null) continue;
      const isCore = /\bcore\b/.test(name);

      if (isCore) {
        if (!coreByMonth.has(mk)) coreByMonth.set(mk, { eventDate: row.event_date, value });
      } else {
        if (!headlineByMonth.has(mk)) headlineByMonth.set(mk, { eventDate: row.event_date, value });
      }
    }

    const months = Array.from(new Set([...headlineByMonth.keys(), ...coreByMonth.keys()])).sort();
    const points: CpiPoint[] = [];

    let usdRateCursor = 0;
    let lastUsdRate: number | null = null;
    for (const mk of months) {
      const sampleDate = `${mk}-15`;
      while (usdRateCursor < usdRateHistorySorted.length) {
        const row = usdRateHistorySorted[usdRateCursor];
        if (!row) break;
        if (row.release_date <= sampleDate) {
          const v = row.actual_rate;
          if (v != null && Number.isFinite(v)) lastUsdRate = v;
          usdRateCursor += 1;
          continue;
        }
        break;
      }

      const headline = headlineByMonth.get(mk)?.value ?? null;
      const core = coreByMonth.get(mk)?.value ?? null;
      const inflationProxy = headline ?? core;
      const realRateProxy = lastUsdRate != null && inflationProxy != null ? lastUsdRate - inflationProxy : null;
      const eventDate = headlineByMonth.get(mk)?.eventDate ?? coreByMonth.get(mk)?.eventDate ?? `${mk}-01`;
      points.push({
        month: mk,
        eventDate,
        headlineYoy: headline,
        coreYoy: core,
        policyRate: lastUsdRate,
        realRateProxy,
      });
    }

    const latestPoint = [...points].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0))[0] ?? null;
    const latestUsdRate = ratesByCurrency.get('USD')?.actual_rate ?? null;

    const latestHeadline = latestPoint?.headlineYoy ?? null;
    const latestCore = latestPoint?.coreYoy ?? null;
    const latestRealRate = latestPoint?.realRateProxy ?? (latestUsdRate != null && latestHeadline != null ? latestUsdRate - latestHeadline : null);

    const surprisePatterns = [
      '%cpi%',
      '%consumer price%',
      '%inflation%',
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
      '%gdp%',
      '%gross domestic product%',
      '%pmi%',
      '%industrial production%',
      '%retail sales%',
    ];
    const usdSurpriseRows = await queryPostgres(
      `
        SELECT
          id::text AS id,
          event_name,
          normalized_event_name,
          currency,
          impact_level,
          event_date::text AS event_date,
          event_time::text AS event_time,
          utc_event_time::text AS utc_event_time,
          actual_value,
          forecast_value,
          previous_value,
          revised_previous_value,
          surprise_value,
          status,
          source_url,
          updated_at::text AS updated_at
        FROM economic_events
        WHERE currency = 'USD'
          AND event_date >= $1::date
          AND event_date <= $2::date
          AND surprise_value IS NOT NULL
          AND (normalized_event_name ILIKE ANY($3::text[]) OR event_name ILIKE ANY($3::text[]))
        ORDER BY event_date DESC, utc_event_time DESC NULLS LAST, updated_at DESC
        LIMIT 2200
      `,
      [daysAgo(Math.min(365, horizonDays)), to, surprisePatterns],
    ).then((r) => r.rows as unknown as EconomicEventRow[]);

    const typeScale: Record<string, number> = {};
    const absByType: Record<string, number[]> = {};
    const typed = usdSurpriseRows
      .filter((r) => r.surprise_value != null && Number.isFinite(r.surprise_value as any))
      .map((r) => {
        const name = normalizeText(r.normalized_event_name || r.event_name);
        const isInflation = /\bcpi\b|\bconsumer price\b|\binflation\b|\bhicp\b/.test(name);
        const isEmployment = /\bnon[-\s]?farm\b|\bpayrolls?\b|\bnfp\b|\bunemployment\b|\bemployment\b|\bjobless\b|\bclaims?\b|\bhourly earnings\b/.test(name);
        const isGrowth = /\bgdp\b|\bgross domestic product\b|\bpmi\b|\bindustrial production\b|\bretail sales\b/.test(name);
        const category = isInflation ? 'inflation' : isEmployment ? 'employment' : isGrowth ? 'growth' : 'other';
        const higherIsBullishForUsd = isInflation || /\bhourly earnings\b/.test(name) || isGrowth || /\bpayrolls?\b|\bnfp\b/.test(name);
        const lowerIsBullishForUsd = /\bunemployment\b/.test(name) || /\bjobless\b|\bclaims?\b/.test(name);
        const direction = lowerIsBullishForUsd ? -1 : higherIsBullishForUsd ? 1 : 1;
        const kind =
          isInflation
            ? /\bcore\b/.test(name) ? 'core_cpi' : 'cpi'
            : isEmployment
              ? /\bunemployment\b/.test(name) ? 'unemployment' : /\bjobless\b|\bclaims?\b/.test(name) ? 'claims' : 'jobs'
              : isGrowth
                ? /\bpmi\b/.test(name) ? 'pmi' : /\bgdp\b/.test(name) ? 'gdp' : 'growth'
                : 'other';
        return {
          id: r.id,
          eventDate: r.event_date,
          eventName: r.event_name,
          normalizedEventName: r.normalized_event_name,
          impactLevel: r.impact_level,
          surprise: Number(r.surprise_value),
          effectiveSurprise: Number(r.surprise_value) * direction,
          category,
          kind,
          sourceUrl: r.source_url,
        };
      })
      .filter((x) => x.category !== 'other');

    for (const row of typed) {
      if (!absByType[row.kind]) absByType[row.kind] = [];
      absByType[row.kind].push(Math.abs(row.surprise));
    }
    for (const [key, list] of Object.entries(absByType)) {
      const sorted = [...list].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const med = sorted.length ? (sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2) : 1;
      typeScale[key] = med > 0 ? med : 1;
    }

    const halfLifeDays = Math.max(30, Math.min(120, Math.round(horizonDays / 3)));
    let usdMacroSum = 0;
    let usdMacroWeight = 0;
    const drivers: Array<any> = [];

    for (const row of typed) {
      const scale = typeScale[row.kind] ?? 1;
      const normalized = clamp(row.effectiveSurprise / Math.max(1e-9, scale), -3, 3);
      const w = weightByImpact(row.impactLevel) * timeDecay(row.eventDate, halfLifeDays);
      const contrib = normalized * w;
      usdMacroSum += contrib;
      usdMacroWeight += w;
      drivers.push({ ...row, normalized, contribution: contrib });
    }

    drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const topUsdDrivers = drivers.slice(0, 12);

    const usdMacroAvg = usdMacroWeight > 0 ? usdMacroSum / usdMacroWeight : 0;
    const usdMacroScore = clamp(usdMacroAvg * 22, -60, 60);
    const usdMacroRegime = classifyUsdMacroScore(usdMacroScore);

    const realSeries = points
      .map((p) => ({ month: p.month, real: p.realRateProxy }))
      .filter((p) => p.real != null) as Array<{ month: string; real: number }>;
    const realMean = mean(realSeries.map((p) => p.real));
    const realStd = stdev(realSeries.map((p) => p.real));
    const realZ = latestRealRate != null && realStd > 0 ? (latestRealRate - realMean) / realStd : 0;

    const riskRows = await queryPostgres(
      `
        SELECT
          id::text AS id,
          event_name,
          normalized_event_name,
          currency,
          impact_level,
          event_date::text AS event_date,
          event_time::text AS event_time,
          utc_event_time::text AS utc_event_time,
          actual_value,
          forecast_value,
          previous_value,
          revised_previous_value,
          surprise_value,
          status,
          source_url,
          updated_at::text AS updated_at
        FROM economic_events
        WHERE currency = 'USD'
          AND event_date >= $1::date
          AND event_date <= $2::date
          AND impact_level IN ('High','Critical')
          AND (actual_value IS NULL OR actual_value = '')
        ORDER BY event_date ASC, utc_event_time ASC NULLS LAST, updated_at DESC
        LIMIT 180
      `,
      [isoDate(new Date()), daysAhead(7)],
    ).then((r) => r.rows as unknown as EconomicEventRow[]);

    const riskPenalty = clamp((riskRows.filter((r) => String(r.impact_level) === 'Critical').length * 4) + (riskRows.filter((r) => String(r.impact_level) === 'High').length * 2), 0, 22);

    const goldScoreRaw = (-usdMacroScore * 0.55) + (-realZ * 28) + (latestHeadline != null ? clamp((latestHeadline - (latestCore ?? latestHeadline)) * 6, -10, 10) : 0) - riskPenalty;
    const goldScore = clamp(goldScoreRaw, -100, 100);
    const goldRegime = classifyGoldBias(goldScore);

    const spreads: Array<{ pair: string; base: string; quote: string; differential: number | null }> = [];
    const usd = ratesByCurrency.get('USD')?.actual_rate ?? null;
    for (const cur of currencies) {
      if (cur === 'USD') continue;
      const other = ratesByCurrency.get(cur)?.actual_rate ?? null;
      const diff = usd != null && other != null ? usd - other : null;
      spreads.push({ pair: `USD/${cur}`, base: 'USD', quote: cur, differential: diff });
    }

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        horizonDays,
        latest: {
          usdPolicyRate: latestUsdRate,
          headlineCpiYoy: latestHeadline,
          coreCpiYoy: latestCore,
          realRateProxy: latestRealRate,
          usdMacroScore,
          usdMacroRegime,
          goldScore,
          goldRegime,
          upcomingUsdHighImpact: riskRows.length,
        },
        series: {
          realRateProxyByMonth: points.slice(-48),
        },
        intermarket: {
          latestRates: currencies.map((cur) => {
            const r = ratesByCurrency.get(cur) ?? null;
            return {
              currency: cur,
              centralBank: r?.central_bank ?? null,
              releaseDate: r?.release_date ?? null,
              releaseTime: r?.release_time ?? null,
              actualRate: r?.actual_rate ?? null,
              rateChange: r?.rate_change ?? null,
              bias: r?.bias ?? null,
              fetchedAt: r?.fetched_at ?? null,
            };
          }),
          usdSpreads: spreads,
        },
        usd: {
          topDrivers: topUsdDrivers,
          upcomingHighImpact: riskRows.map((r) => ({
            id: r.id,
            eventDate: r.event_date,
            eventTime: r.event_time,
            utcEventTime: r.utc_event_time,
            eventName: r.event_name,
            impactLevel: r.impact_level,
            status: r.status,
            sourceUrl: r.source_url,
          })),
        },
        model: {
          weights: {
            usdMacro: -0.55,
            realRateZ: -28,
            inflationMix: 1,
            riskPenalty: -1,
          },
          notes: [
            'Real-rate proxy uses (USD policy rate − US CPI YoY).',
            'USD macro score is derived from normalized surprise history with impact and recency weighting.',
            'Risk penalty reduces conviction ahead of high/critical USD events.',
          ],
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, generatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'gold_intermarket_failed' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

