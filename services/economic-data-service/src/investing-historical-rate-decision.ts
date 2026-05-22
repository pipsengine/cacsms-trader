import { chromium } from 'playwright';
import { queryPostgres } from '@/lib/postgres';
import crypto from 'crypto';

type RateDecisionHistoryRow = {
  sourcePageId: number;
  sourceUrl: string;
  country: string | null;
  currency: string;
  centralBank: string | null;
  eventName: string;
  normalizedEventName: string;
  releaseDate: string;
  releaseTime: string | null;
  actualRate: number;
  forecastRate: number | null;
  previousRate: number | null;
  rateChangeBps: number | null;
  decisionType: string | null;
  surpriseDirection: string | null;
  policyBias: string | null;
  dataQualityStatus: string;
  sourceReliabilityScore: number;
  rawRowHash: string;
  capturedAtIso: string;
};

type SyncResult = { ok: boolean; inserted: number; updated: number; skipped: number; pages: number[]; message: string };

const browserUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export async function ensureRateDecisionHistoryTables(): Promise<void> {
  if (globalThis.__cacsmsRateHistoryTablesEnsured) return;
  globalThis.__cacsmsRateHistoryTablesEnsured = true;

  await queryPostgres(
    `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS rate_decision_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_name TEXT NOT NULL DEFAULT 'Investing.com',
        source_page_id INTEGER NOT NULL,
        source_url TEXT NOT NULL,
        country TEXT,
        currency TEXT NOT NULL,
        central_bank TEXT,
        event_name TEXT NOT NULL,
        normalized_event_name TEXT NOT NULL,
        release_date DATE NOT NULL,
        release_time TEXT,
        actual_rate NUMERIC(12,6),
        forecast_rate NUMERIC(12,6),
        previous_rate NUMERIC(12,6),
        rate_change_bps INTEGER,
        decision_type TEXT,
        surprise_direction TEXT,
        policy_bias TEXT,
        data_quality_status TEXT NOT NULL DEFAULT 'OK',
        source_reliability_score NUMERIC(5,2) NOT NULL DEFAULT 0,
        raw_row_hash TEXT,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_checked_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (source_page_id, currency, normalized_event_name, release_date)
      );

      CREATE INDEX IF NOT EXISTS idx_rate_decision_history_release_date ON rate_decision_history (release_date DESC);
      CREATE INDEX IF NOT EXISTS idx_rate_decision_history_currency_date ON rate_decision_history (currency, release_date DESC);
      CREATE INDEX IF NOT EXISTS idx_rate_decision_history_page_date ON rate_decision_history (source_page_id, release_date DESC);
      CREATE INDEX IF NOT EXISTS idx_rate_decision_history_decision ON rate_decision_history (decision_type, release_date DESC);
      CREATE INDEX IF NOT EXISTS idx_rate_decision_history_surprise ON rate_decision_history (surprise_direction, release_date DESC);

      CREATE TABLE IF NOT EXISTS rate_decision_history_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_type TEXT NOT NULL,
        source_page_id INTEGER,
        status TEXT NOT NULL CHECK (status IN ('success','error','warning','info')),
        message TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_rate_decision_history_logs_fetched ON rate_decision_history_logs (fetched_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rate_decision_history_logs_page ON rate_decision_history_logs (source_page_id, fetched_at DESC);
    `,
  ).catch(() => null);
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function subtractYearsUtc(date: Date, years: number): Date {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() - years);
  return next;
}

function parseRate(value: string): number | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw.toLowerCase() === 'n/a') return null;
  const cleaned = raw.replaceAll('%', '').replaceAll(',', '').replaceAll(' ', '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseReleaseDate(value: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const iso = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    const ms = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(ms) ? iso : null;
  }

  const dmy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    const ms = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(ms) ? iso : null;
  }

  const mdy = raw.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
  if (mdy) {
    const monthMap: Record<string, string> = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
    };
    const mm = monthMap[mdy[1].toLowerCase()] ?? '';
    const dd = String(Number(mdy[2])).padStart(2, '0');
    const yyyy = mdy[3];
    if (!mm) return null;
    const iso = `${yyyy}-${mm}-${dd}`;
    const ms = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(ms) ? iso : null;
  }

  return null;
}

function normalizeEventName(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function computeDecision(actual: number, previous: number | null): { decisionType: string | null; rateChangeBps: number | null } {
  if (previous == null) return { decisionType: null, rateChangeBps: null };
  if (actual > previous) return { decisionType: 'HIKE', rateChangeBps: Math.round((actual - previous) * 100) };
  if (actual < previous) return { decisionType: 'CUT', rateChangeBps: Math.round((actual - previous) * 100) };
  return { decisionType: 'HOLD', rateChangeBps: 0 };
}

function computeSurprise(actual: number, forecast: number | null): string | null {
  if (forecast == null) return null;
  if (actual > forecast) return 'HAWKISH_SURPRISE';
  if (actual < forecast) return 'DOVISH_SURPRISE';
  return 'AS_EXPECTED';
}

function computePolicyBias(decisionType: string | null, surpriseDirection: string | null): string | null {
  if (!decisionType) return null;
  if (!surpriseDirection) {
    if (decisionType === 'HIKE') return 'Mild Bullish';
    if (decisionType === 'CUT') return 'Mild Bearish';
    return 'Neutral';
  }

  if (decisionType === 'HIKE' && surpriseDirection === 'HAWKISH_SURPRISE') return 'Strong Bullish';
  if (decisionType === 'HIKE' && surpriseDirection === 'AS_EXPECTED') return 'Mild Bullish';

  if (decisionType === 'CUT' && surpriseDirection === 'DOVISH_SURPRISE') return 'Strong Bearish';
  if (decisionType === 'CUT' && surpriseDirection === 'AS_EXPECTED') return 'Mild Bearish';

  if (decisionType === 'HOLD' && surpriseDirection === 'HAWKISH_SURPRISE') return 'Mild Bullish';
  if (decisionType === 'HOLD' && surpriseDirection === 'DOVISH_SURPRISE') return 'Mild Bearish';
  if (decisionType === 'HOLD' && surpriseDirection === 'AS_EXPECTED') return 'Neutral';

  return 'Neutral';
}

async function appendRateLog(input: { jobType: string; status: 'success' | 'error' | 'warning' | 'info'; message: string; pageId?: number; details?: any }): Promise<void> {
  await ensureRateDecisionHistoryTables();
  await queryPostgres(
    `
      INSERT INTO rate_decision_history_logs (job_type, source_page_id, status, message, details, fetched_at)
      VALUES ($1, $2, $3, $4, $5, now())
    `,
    [input.jobType, input.pageId ?? null, input.status, input.message, input.details == null ? '{}' : JSON.stringify(input.details)],
  ).catch(() => null);
}

async function scrapeRateDecisionPage(input: { pageId: number; cutoffIso: string }): Promise<{ meta: any; rows: Array<{ releaseDateText: string; timeText: string; actualText: string; forecastText: string; previousText: string }> }> {
  const sourceUrl = `https://www.investing.com/economic-calendar/interest-rate-decision-${input.pageId}`;

  const headless = String(process.env.CACSMS_INVESTING_HEADLESS ?? 'true').toLowerCase() !== 'false';
  const browser = await chromium
    .launch({ headless, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] })
    .catch(() => chromium.launch({ headless, args: ['--disable-blink-features=AutomationControlled'] }));
  const context = await browser.newContext({
    userAgent: browserUserAgent,
    locale: 'en-US',
    timezoneId: 'UTC',
    viewport: { width: 1365, height: 900 },
    extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });
  const page = await context.newPage();

  try {
    let attempt = 0;
    while (attempt < 3) {
      attempt += 1;
      await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(1250).catch(() => null);
      const currentUrl = page.url();
      if (!currentUrl.includes(`interest-rate-decision-${input.pageId}`)) {
        if (attempt >= 3) throw new Error('Page blocked (bot protection).');
        await page.waitForTimeout(2500 * attempt).catch(() => null);
        continue;
      }
      const title = (await page.title()).toLowerCase();
      if (title.includes('just a moment') || title.includes('attention required') || title.includes('captcha')) {
        if (attempt >= 3) throw new Error('Page blocked (bot protection).');
        await page.waitForTimeout(2500 * attempt).catch(() => null);
        continue;
      }
      break;
    }

    await page.locator('button:has-text("Accept")').first().click({ timeout: 2_000 }).catch(() => {});
    const afterConsentTitle = (await page.title().catch(() => '')).toLowerCase();
    if (afterConsentTitle.includes('just a moment') || afterConsentTitle.includes('attention required') || afterConsentTitle.includes('captcha')) {
      throw new Error('Page blocked (bot protection).');
    }

    const extractOnce = async (): Promise<{
      eventName: string;
      currency: string | null;
      centralBank: string | null;
      country: string | null;
      rows: Array<{ releaseDateText: string; timeText: string; actualText: string; forecastText: string; previousText: string }>;
    }> => {
      return page.evaluate(() => {
        const normalize = (v: string | null | undefined) => String(v ?? '').replace(/\s+/g, ' ').trim();
        const headerKey = (value: string) => normalize(value).toLowerCase();
        const matchHeader = (header: string, keys: string[]) => {
          const h = headerKey(header);
          return keys.some((k) => h === k || h.includes(k));
        };

        const h1 = document.querySelector('h1') ?? document.querySelector('#leftColumn h1') ?? document.querySelector('.instrumentH1') ?? null;
        const eventName = normalize(h1?.textContent);

        const currency = (() => {
          const a = document.querySelector('a[href*="/currencies/"]');
          const text = normalize(a?.textContent);
          return text || null;
        })();

        const centralBank = (() => {
          const a = document.querySelector('a[href*="/central-banks/"]');
          const text = normalize(a?.textContent);
          if (text) return text;

          const labels = Array.from(document.querySelectorAll('*')).slice(0, 2000);
          const idx = labels.findIndex((el) => normalize(el.textContent).toLowerCase() === 'source:');
          if (idx >= 0) {
            const nextAnchor = labels.slice(idx, idx + 25).find((el) => el.tagName === 'A') as HTMLAnchorElement | undefined;
            const nextText = normalize(nextAnchor?.textContent);
            if (nextText) return nextText;
          }
          return null;
        })();

        const country = (() => {
          const a = document.querySelector('a[href*="/countries/"]') as HTMLAnchorElement | null;
          const text = normalize(a?.textContent);
          if (text) return text;

          const name = eventName.toLowerCase();
          const marker = 'interest rate decision';
          if (name.includes(marker)) {
            const before = eventName.slice(0, name.indexOf(marker)).trim();
            return before || null;
          }
          return null;
        })();

        const table = (() => {
          const tables = Array.from(document.querySelectorAll('table'));
          const scored = tables
            .map((t) => {
              const headers = Array.from(t.querySelectorAll('th')).map((th) => normalize(th.textContent));
              const score =
                (headers.some((h) => matchHeader(h, ['actual'])) ? 4 : 0) +
                (headers.some((h) => matchHeader(h, ['forecast'])) ? 2 : 0) +
                (headers.some((h) => matchHeader(h, ['previous', 'prev'])) ? 2 : 0) +
                (headers.some((h) => matchHeader(h, ['release date', 'date'])) ? 2 : 0) +
                (headers.some((h) => matchHeader(h, ['time'])) ? 1 : 0);
              return { t, headers, score };
            })
            .filter((x) => x.score >= 4)
            .sort((a, b) => b.score - a.score);

          return scored[0]?.t ?? null;
        })();

        const rows = (() => {
          if (!table) return [];
          const headers = Array.from(table.querySelectorAll('th')).map((th) => normalize(th.textContent));
          const dateIdx = headers.findIndex((h) => matchHeader(h, ['release date', 'date']));
          const timeIdx = headers.findIndex((h) => matchHeader(h, ['time']));
          const actualIdx = headers.findIndex((h) => matchHeader(h, ['actual']));
          const forecastIdx = headers.findIndex((h) => matchHeader(h, ['forecast']));
          const previousIdx = headers.findIndex((h) => matchHeader(h, ['previous', 'prev']));
          if (actualIdx < 0 || dateIdx < 0) return [];

          const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
          return bodyRows.map((tr) => {
            const cells = Array.from(tr.querySelectorAll('td')).map((td) => normalize(td.textContent));
            return {
              releaseDateText: cells[dateIdx] ?? '',
              timeText: timeIdx >= 0 ? cells[timeIdx] ?? '' : '',
              actualText: cells[actualIdx] ?? '',
              forecastText: forecastIdx >= 0 ? cells[forecastIdx] ?? '' : '',
              previousText: previousIdx >= 0 ? cells[previousIdx] ?? '' : '',
            };
          });
        })();

        return { eventName, currency, centralBank, country, rows };
      });
    };

    const getRowCount = async (): Promise<number> => {
      return page.evaluate(() => {
        const normalize = (v: string | null | undefined) => String(v ?? '').replace(/\s+/g, ' ').trim();
        const headerKey = (value: string) => normalize(value).toLowerCase();
        const matchHeader = (header: string, keys: string[]) => {
          const h = headerKey(header);
          return keys.some((k) => h === k || h.includes(k));
        };

        const tables = Array.from(document.querySelectorAll('table'));
        const match = tables
          .map((t) => {
            const headers = Array.from(t.querySelectorAll('th')).map((th) => normalize(th.textContent));
            const score =
              (headers.some((h) => matchHeader(h, ['actual'])) ? 4 : 0) +
              (headers.some((h) => matchHeader(h, ['forecast'])) ? 2 : 0) +
              (headers.some((h) => matchHeader(h, ['previous', 'prev'])) ? 2 : 0) +
              (headers.some((h) => matchHeader(h, ['release date', 'date'])) ? 2 : 0);
            return { t, score };
          })
          .filter((x) => x.score >= 4)
          .sort((a, b) => b.score - a.score)[0]?.t;
        if (!match) return 0;
        return match.querySelectorAll('tbody tr').length;
      });
    };

    await page.waitForFunction(() => document.querySelectorAll('table').length > 0, null, { timeout: 45_000 }).catch(() => null);
    await page
      .waitForFunction(() => {
        const normalize = (v: string | null | undefined) => String(v ?? '').replace(/\s+/g, ' ').trim();
        const headerKey = (value: string) => normalize(value).toLowerCase();
        const matchHeader = (header: string, keys: string[]) => {
          const h = headerKey(header);
          return keys.some((k) => h === k || h.includes(k));
        };
        const tables = Array.from(document.querySelectorAll('table'));
        const match = tables
          .map((t) => {
            const headers = Array.from(t.querySelectorAll('th')).map((th) => normalize(th.textContent));
            const score =
              (headers.some((h) => matchHeader(h, ['actual'])) ? 4 : 0) +
              (headers.some((h) => matchHeader(h, ['forecast'])) ? 2 : 0) +
              (headers.some((h) => matchHeader(h, ['previous', 'prev'])) ? 2 : 0) +
              (headers.some((h) => matchHeader(h, ['release date', 'date'])) ? 2 : 0);
            return { t, score };
          })
          .filter((x) => x.score >= 4)
          .sort((a, b) => b.score - a.score)[0]?.t;
        if (!match) return false;
        return match.querySelectorAll('tbody tr').length > 0;
      }, null, { timeout: 45_000 })
      .catch(() => null);

    let beforeCount = await getRowCount();
    let stable = 0;
    let lastOldest: string | null = null;
    const maxIterations = 40;

    const waitForMoreRows = async (prev: number): Promise<boolean> => {
      try {
        await page.waitForFunction(
          (prevCount: number) => {
            const normalize = (v: string | null | undefined) => String(v ?? '').replace(/\s+/g, ' ').trim();
            const headerKey = (value: string) => normalize(value).toLowerCase();
            const matchHeader = (header: string, keys: string[]) => {
              const h = headerKey(header);
              return keys.some((k) => h === k || h.includes(k));
            };
            const tables = Array.from(document.querySelectorAll('table'));
            const match = tables
              .map((t) => {
                const headers = Array.from(t.querySelectorAll('th')).map((th) => normalize(th.textContent));
                const score =
                  (headers.some((h) => matchHeader(h, ['actual'])) ? 4 : 0) +
                  (headers.some((h) => matchHeader(h, ['forecast'])) ? 2 : 0) +
                  (headers.some((h) => matchHeader(h, ['previous', 'prev'])) ? 2 : 0) +
                  (headers.some((h) => matchHeader(h, ['release date', 'date'])) ? 2 : 0);
                return { t, score };
              })
              .filter((x) => x.score >= 4)
              .sort((a, b) => b.score - a.score)[0]?.t;
            if (!match) return false;
            return match.querySelectorAll('tbody tr').length > prevCount;
          },
          prev,
          { timeout: 7_500 },
        );
        return true;
      } catch {
        return false;
      }
    };

    const tryLoadMore = async (prev: number): Promise<boolean> => {
      const clickCandidates = [
        'button:has-text("Show more")',
        'button:has-text("Show More")',
        'a:has-text("Show more")',
        'a:has-text("Show More")',
        'button:has-text("Load more")',
        'button:has-text("Load More")',
        'a:has-text("Load more")',
        'a:has-text("Load More")',
        'button[aria-label="Next"]',
        'a[aria-label="Next"]',
        'button:has-text("Next")',
        'a:has-text("Next")',
      ];

      for (const selector of clickCandidates) {
        const loc = page.locator(selector).first();
        const visible = await loc.isVisible().catch(() => false);
        if (!visible) continue;
        await loc.scrollIntoViewIfNeeded().catch(() => null);
        await loc.click({ timeout: 3_000 }).catch(() => null);
        const ok = await waitForMoreRows(prev);
        if (ok) return true;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => null);
      const ok = await waitForMoreRows(prev);
      if (ok) return true;
      await page.mouse.wheel(0, 2000).catch(() => null);
      return waitForMoreRows(prev);
    };

    for (let i = 0; i < maxIterations; i += 1) {
      const snapshot = await extractOnce().catch(() => null);
      if (!snapshot) break;

      const dates = snapshot.rows
        .map((r) => parseReleaseDate(r.releaseDateText))
        .filter((d): d is string => Boolean(d))
        .sort();

      const oldest = dates.length ? dates[0] : null;
      if (oldest && oldest < input.cutoffIso) break;

      if (oldest && lastOldest && oldest === lastOldest) stable += 1;
      else stable = 0;

      if (stable >= 2) break;
      lastOldest = oldest;

      const progressed = await tryLoadMore(beforeCount);
      const afterCount = await getRowCount();
      if (!progressed && afterCount <= beforeCount) break;
      beforeCount = afterCount;
    }

    const extracted = await extractOnce();
    if (!extracted?.eventName) throw new Error('Event name not found.');
    if (!Array.isArray(extracted?.rows) || extracted.rows.length === 0) {
      const probe = await page
        .evaluate(() => {
          const normalize = (v: string | null | undefined) => String(v ?? '').replace(/\s+/g, ' ').trim();
          const tables = Array.from(document.querySelectorAll('table')).map((t) => {
            const headers = Array.from(t.querySelectorAll('th')).map((th) => normalize(th.textContent));
            const rows = t.querySelectorAll('tbody tr').length;
            return { headers: headers.slice(0, 12), rows };
          });
          tables.sort((a, b) => (b.rows ?? 0) - (a.rows ?? 0));
          const showMore = Array.from(document.querySelectorAll('a,button'))
            .map((el) => normalize(el.textContent))
            .some((t) => t.toLowerCase() === 'show more' || t.toLowerCase() === 'load more');
          const hasReleaseDateText = document.body ? document.body.innerText.toLowerCase().includes('release date') : false;
          return {
            url: location.href,
            title: document.title,
            tableCount: tables.length,
            topTables: tables.slice(0, 5),
            showMore,
            hasReleaseDateText,
          };
        })
        .catch(() => null);

      await appendRateLog({
        jobType: 'rate_history_table_probe',
        status: 'warning',
        message: 'Historical table not found or empty.',
        pageId: input.pageId,
        details: { sourceUrl, probe },
      });
      const probeTitle = String((probe as any)?.title ?? '').toLowerCase();
      const probeUrl = String((probe as any)?.url ?? '');
      if (
        probeTitle.includes('just a moment') ||
        probeTitle.includes('attention required') ||
        probeTitle.includes('captcha') ||
        (probeUrl && !probeUrl.includes(`interest-rate-decision-${input.pageId}`))
      ) {
        throw new Error('Page blocked (bot protection).');
      }
      throw new Error('Historical table not found or empty.');
    }

    return { meta: { sourceUrl, ...extracted }, rows: extracted.rows };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export class InvestingHistoricalRateDecisionCollectorService {
  private readonly sourceName = 'Investing.com';
  private readonly pageIds = [164, 165, 166, 167, 168, 169, 170, 171, 172];

  async syncAllLast3Years(): Promise<SyncResult> {
    return this.syncPages(this.pageIds);
  }

  async syncPageLast3Years(pageId: number): Promise<SyncResult> {
    return this.syncPages([pageId]);
  }

  private async syncPages(pageIds: number[]): Promise<SyncResult> {
    await ensureRateDecisionHistoryTables();
    const now = new Date();
    const cutoff = subtractYearsUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), 3);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    const twoYearCutoffIso = subtractYearsUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), 2).toISOString().slice(0, 10);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    await appendRateLog({ jobType: 'rate_history_sync', status: 'info', message: `Sync requested for pages ${pageIds.join(', ')} (cutoff ${cutoffIso}).`, details: { pageIds, cutoffIso } });

    for (const pageId of pageIds) {
      try {
        await appendRateLog({ jobType: 'rate_history_page_start', status: 'info', message: `Fetching rate history page ${pageId}.`, pageId });
        const scraped = await scrapeRateDecisionPage({ pageId, cutoffIso });
        const meta = scraped.meta ?? {};

        const currency = String(meta.currency ?? '').trim();
        if (!currency) {
          await appendRateLog({ jobType: 'rate_history_page_currency_missing', status: 'warning', message: `Currency missing for page ${pageId}.`, pageId, details: { sourceUrl: meta.sourceUrl } });
          continue;
        }

        const eventName = String(meta.eventName ?? '').trim() || `Interest Rate Decision ${pageId}`;
        const normalizedEventName = normalizeEventName(eventName);
        const centralBank = meta.centralBank ? String(meta.centralBank) : null;
        const country = meta.country ? String(meta.country) : null;

        const capturedAtIso = nowIso();
        let pageRows = 0;
        let pageSkippedOld = 0;
        let pageSkippedBad = 0;
        let earliestSeen: string | null = null;

        for (const row of scraped.rows) {
          const releaseDate = parseReleaseDate(row.releaseDateText);
          if (!releaseDate) {
            pageSkippedBad += 1;
            continue;
          }
          if (!earliestSeen || releaseDate < earliestSeen) earliestSeen = releaseDate;
          if (releaseDate < cutoffIso) {
            pageSkippedOld += 1;
            continue;
          }

          const actualRate = parseRate(row.actualText);
          if (actualRate == null) {
            pageSkippedBad += 1;
            continue;
          }

          const forecastRate = parseRate(row.forecastText);
          const previousRate = parseRate(row.previousText);

          const decision = computeDecision(actualRate, previousRate);
          const surpriseDirection = computeSurprise(actualRate, forecastRate);
          const policyBias = computePolicyBias(decision.decisionType, surpriseDirection);

          const dataQualityStatus = 'OK';
          const sourceReliabilityScore = 70;

          const rawRowHash = sha256(
            [
              this.sourceName,
              pageId,
              meta.sourceUrl,
              currency,
              normalizedEventName,
              releaseDate,
              row.timeText,
              actualRate,
              forecastRate ?? '',
              previousRate ?? '',
            ].join('|'),
          );

          const prepared: RateDecisionHistoryRow = {
            sourcePageId: pageId,
            sourceUrl: String(meta.sourceUrl),
            country,
            currency,
            centralBank,
            eventName,
            normalizedEventName,
            releaseDate,
            releaseTime: row.timeText ? String(row.timeText).trim() || null : null,
            actualRate,
            forecastRate,
            previousRate,
            rateChangeBps: decision.rateChangeBps,
            decisionType: decision.decisionType,
            surpriseDirection,
            policyBias,
            dataQualityStatus,
            sourceReliabilityScore,
            rawRowHash,
            capturedAtIso,
          };

          const upserted = await this.upsert(prepared);
          if (upserted.inserted) inserted += 1;
          else updated += 1;
          pageRows += 1;

          if (upserted.conflicts.length) {
            await appendRateLog({
              jobType: 'rate_history_conflict',
              status: 'warning',
              message: `Conflict detected for ${currency} ${normalizedEventName} ${releaseDate} (fields: ${upserted.conflicts.join(', ')}).`,
              pageId,
              details: { currency, normalizedEventName, releaseDate, conflicts: upserted.conflicts, sourceUrl: meta.sourceUrl },
            });
          }
        }

        if (earliestSeen && earliestSeen > cutoffIso && earliestSeen >= twoYearCutoffIso) {
          await appendRateLog({
            jobType: 'rate_history_only_2y_available',
            status: 'warning',
            message: `Only 2 years available from source.`,
            pageId,
            details: { currency, eventName, earliestSeen, cutoffIso, twoYearCutoffIso, sourceUrl: meta.sourceUrl },
          });
        }

        await appendRateLog({
          jobType: 'rate_history_page_success',
          status: 'success',
          message: `Captured ${pageRows} rows for page ${pageId} (${currency}).`,
          pageId,
          details: { currency, eventName, cutoffIso, skippedOld: pageSkippedOld, skippedBad: pageSkippedBad },
        });
      } catch (error) {
        skipped += 1;
        const message = error instanceof Error ? error.message : `Failed to process page ${pageId}`;
        const lower = message.toLowerCase();
        const jobType =
          lower.includes('page blocked') || lower.includes('bot protection') || lower.includes('just a moment')
            ? 'rate_history_page_blocked'
            : lower.includes('timeout')
              ? 'rate_history_browser_timeout'
              : lower.includes('historical table not found')
                ? 'rate_history_table_not_found'
                : lower.includes('date') && lower.includes('parse')
                  ? 'rate_history_date_parse_failed'
                  : lower.includes('rate') && lower.includes('parse')
                    ? 'rate_history_rate_parse_failed'
                    : 'rate_history_page_error';
        await appendRateLog({
          jobType,
          status: 'error',
          message,
          pageId,
        });
      }
    }

    const ok = skipped === 0;
    const message = `Synced rate history for pages ${pageIds.join(', ')} (inserted ${inserted}, updated ${updated}, skippedPages ${skipped}).`;
    await appendRateLog({ jobType: 'rate_history_sync_done', status: ok ? 'success' : 'warning', message, details: { inserted, updated, skippedPages: skipped } });
    return { ok, inserted, updated, skipped, pages: pageIds, message };
  }

  private async upsert(row: RateDecisionHistoryRow): Promise<{ inserted: boolean; conflicts: string[] }> {
    await ensureRateDecisionHistoryTables();
    const result = await queryPostgres(
      `
        WITH existing AS (
          SELECT actual_rate, forecast_rate, previous_rate, release_time
          FROM rate_decision_history
          WHERE source_page_id = $2
            AND currency = $5
            AND normalized_event_name = $8
            AND release_date = $9::date
        ),
        upserted AS (
          INSERT INTO rate_decision_history (
            source_name,
            source_page_id,
            source_url,
            country,
            currency,
            central_bank,
            event_name,
            normalized_event_name,
            release_date,
            release_time,
            actual_rate,
            forecast_rate,
            previous_rate,
            rate_change_bps,
            decision_type,
            surprise_direction,
            policy_bias,
            data_quality_status,
            source_reliability_score,
            raw_row_hash,
            captured_at,
            last_checked_at,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now(), now(), now())
          ON CONFLICT (source_page_id, currency, normalized_event_name, release_date)
          DO UPDATE SET
            source_url = COALESCE(rate_decision_history.source_url, EXCLUDED.source_url),
            country = COALESCE(rate_decision_history.country, EXCLUDED.country),
            central_bank = COALESCE(rate_decision_history.central_bank, EXCLUDED.central_bank),
            event_name = COALESCE(rate_decision_history.event_name, EXCLUDED.event_name),
            release_time = COALESCE(rate_decision_history.release_time, EXCLUDED.release_time),
            actual_rate = COALESCE(rate_decision_history.actual_rate, EXCLUDED.actual_rate),
            forecast_rate = COALESCE(rate_decision_history.forecast_rate, EXCLUDED.forecast_rate),
            previous_rate = COALESCE(rate_decision_history.previous_rate, EXCLUDED.previous_rate),
            rate_change_bps = COALESCE(rate_decision_history.rate_change_bps, EXCLUDED.rate_change_bps),
            decision_type = COALESCE(rate_decision_history.decision_type, EXCLUDED.decision_type),
            surprise_direction = COALESCE(rate_decision_history.surprise_direction, EXCLUDED.surprise_direction),
            policy_bias = COALESCE(rate_decision_history.policy_bias, EXCLUDED.policy_bias),
            data_quality_status = COALESCE(rate_decision_history.data_quality_status, EXCLUDED.data_quality_status),
            source_reliability_score = GREATEST(rate_decision_history.source_reliability_score, EXCLUDED.source_reliability_score),
            raw_row_hash = COALESCE(rate_decision_history.raw_row_hash, EXCLUDED.raw_row_hash),
            last_checked_at = now(),
            updated_at = now()
          RETURNING (xmax = 0) AS inserted
        )
        SELECT
          upserted.inserted AS inserted,
          COALESCE((existing.actual_rate IS NOT NULL AND $11 IS NOT NULL AND existing.actual_rate <> $11), false) AS actual_conflict,
          COALESCE((existing.forecast_rate IS NOT NULL AND $12 IS NOT NULL AND existing.forecast_rate <> $12), false) AS forecast_conflict,
          COALESCE((existing.previous_rate IS NOT NULL AND $13 IS NOT NULL AND existing.previous_rate <> $13), false) AS previous_conflict,
          COALESCE((existing.release_time IS NOT NULL AND $10 IS NOT NULL AND existing.release_time <> $10), false) AS release_time_conflict
        FROM upserted
        LEFT JOIN existing ON true
      `,
      [
        this.sourceName,
        row.sourcePageId,
        row.sourceUrl,
        row.country,
        row.currency,
        row.centralBank,
        row.eventName,
        row.normalizedEventName,
        row.releaseDate,
        row.releaseTime,
        row.actualRate,
        row.forecastRate,
        row.previousRate,
        row.rateChangeBps,
        row.decisionType,
        row.surpriseDirection,
        row.policyBias,
        row.dataQualityStatus,
        row.sourceReliabilityScore,
        row.rawRowHash,
      ],
    );

    const first = result.rows[0] as any;
    const conflicts: string[] = [];
    if (first?.actual_conflict) conflicts.push('actual_rate');
    if (first?.forecast_conflict) conflicts.push('forecast_rate');
    if (first?.previous_conflict) conflicts.push('previous_rate');
    if (first?.release_time_conflict) conflicts.push('release_time');
    return { inserted: Boolean(first?.inserted), conflicts };
  }
}

declare global {
  var __cacsmsRateHistorySchedulerStarted: boolean | undefined;
  var __cacsmsRateHistorySchedulerTimer: ReturnType<typeof setInterval> | undefined;
  var __cacsmsRateHistoryTablesEnsured: boolean | undefined;
}

function lagosNowUtcShifted(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

function lagosDateKey(date = lagosNowUtcShifted()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shouldRunSaturdayMidnightLagos(now = lagosNowUtcShifted()): boolean {
  return now.getUTCDay() === 6 && now.getUTCHours() === 0 && now.getUTCMinutes() <= 10;
}

export class InvestingRateDecisionWeeklySchedulerService {
  private readonly collector = new InvestingHistoricalRateDecisionCollectorService();

  ensureStarted(): void {
    if (globalThis.__cacsmsRateHistorySchedulerStarted) return;
    globalThis.__cacsmsRateHistorySchedulerStarted = true;

    globalThis.__cacsmsRateHistorySchedulerTimer = setInterval(() => {
      this.tick().catch(() => null);
    }, 60_000);
  }

  private async tick(): Promise<void> {
    const now = lagosNowUtcShifted();
    if (!shouldRunSaturdayMidnightLagos(now)) return;
    const dateKey = lagosDateKey(now);

    const already = await queryPostgres(
      `
        SELECT 1
        FROM rate_decision_history_logs
        WHERE job_type = 'rate_history_weekly_scheduler'
          AND status IN ('success','warning')
          AND DATE(fetched_at AT TIME ZONE 'Africa/Lagos') = $1::date
        LIMIT 1
      `,
      [dateKey],
    ).then((r) => (r.rows?.length ?? 0) > 0).catch(() => false);

    if (already) return;
    await appendRateLog({ jobType: 'rate_history_weekly_scheduler', status: 'info', message: `Weekly scheduler firing for ${dateKey} (Africa/Lagos).`, details: { dateKey, firedAt: nowIso() } });

    const result = await this.collector.syncAllLast3Years();
    await appendRateLog({
      jobType: 'rate_history_weekly_scheduler',
      status: result.ok ? 'success' : 'warning',
      message: result.message,
      details: result,
    });
  }
}
