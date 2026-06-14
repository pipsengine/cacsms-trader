import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import * as XLSX from 'xlsx';
import { queryPostgres } from '@/lib/postgres';

type CotReportType = 'FUTURES_ONLY';

export type CotInstitutionalPositionRow = {
  reportDate: string;
  currency: string;
  marketName: string | null;
  cftcMarketCode: string | null;
  exchange: string | null;
  longPositions: number | null;
  shortPositions: number | null;
  changeLong: number | null;
  changeShort: number | null;
  percentChange: number | null;
  netPositions: number | null;
  netChange: number | null;
  bias: string | null;
  biasStrength: number | null;
  reportType: CotReportType;
  sourceName: string;
  sourceUrl: string;
  sourceYear: number;
  rawContractMarketName: string | null;
  rawRowHash: string;
};

type SourceYearLink = {
  year: number;
  textZipUrl: string;
  excelZipUrl: string;
};

type SyncResult = {
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  years: number[];
  message: string;
};

function nowIso() {
  return new Date().toISOString();
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function clampInt(value: number | null, min: number, max: number): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replaceAll(',', '').replaceAll(' ', '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDateYmd(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return iso;
}

function subtractYears(date: Date, years: number): Date {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() - years);
  return next;
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

function csvSplitLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((cell) => cell.trim());
}

function splitMarketName(rawContractMarketName: string): { marketName: string | null; exchange: string | null } {
  const raw = rawContractMarketName.trim();
  if (!raw) return { marketName: null, exchange: null };
  const parts = raw.split(' - ');
  if (parts.length < 2) return { marketName: raw, exchange: null };
  const marketName = parts.slice(0, -1).join(' - ').trim();
  const exchange = parts[parts.length - 1].trim();
  return { marketName: marketName || null, exchange: exchange || null };
}

export class CftcCotCurrencyNormalizerService {
  private readonly enabled: Set<string>;

  constructor(enabledCurrencies?: string[]) {
    const defaults = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'XAU'];
    this.enabled = new Set((enabledCurrencies?.length ? enabledCurrencies : defaults).map((c) => c.trim()).filter(Boolean));
  }

  normalize(rawContractMarketName: string): { currency: string | null; marketName: string | null; exchange: string | null } {
    const upper = rawContractMarketName.toUpperCase();
    const { marketName, exchange } = splitMarketName(rawContractMarketName);
    const isCrossRate =
      upper.includes('XRATE')
      || upper.includes('X-RATE')
      || upper.includes('CROSS')
      || upper.includes('/');

    const currency =
      (upper.includes('U.S. DOLLAR INDEX') || upper.includes('US DOLLAR INDEX') || upper.startsWith('USD INDEX')) ? 'USD'
        : (!isCrossRate && upper.startsWith('EURO FX')) ? 'EUR'
          : (!isCrossRate && (upper.startsWith('BRITISH POUND') || upper.startsWith('BRITISH POUND STERLING'))) ? 'GBP'
            : (!isCrossRate && upper.startsWith('JAPANESE YEN')) ? 'JPY'
              : (!isCrossRate && upper.startsWith('SWISS FRANC')) ? 'CHF'
                : (!isCrossRate && upper.startsWith('CANADIAN DOLLAR')) ? 'CAD'
                  : (!isCrossRate && upper.startsWith('AUSTRALIAN DOLLAR')) ? 'AUD'
                    : (!isCrossRate && (upper.startsWith('NEW ZEALAND DOLLAR') || upper.startsWith('NZ DOLLAR'))) ? 'NZD'
                      : (upper.startsWith('GOLD')) ? 'XAU'
                        : null;

    if (!currency) return { currency: null, marketName, exchange };
    if (!this.enabled.has(currency)) return { currency: null, marketName, exchange };
    return { currency, marketName, exchange };
  }
}

export class CotInstitutionalBiasEngineService {
  compute(input: { longPositions: number | null; shortPositions: number | null; previousLong: number | null; previousShort: number | null }): {
    changeLong: number | null;
    changeShort: number | null;
    netPositions: number | null;
    netChange: number | null;
    percentChange: number | null;
    bias: string | null;
    biasStrength: number | null;
  } {
    const longPositions = input.longPositions == null ? null : Math.round(input.longPositions);
    const shortPositions = input.shortPositions == null ? null : Math.round(input.shortPositions);
    const previousLong = input.previousLong == null ? null : Math.round(input.previousLong);
    const previousShort = input.previousShort == null ? null : Math.round(input.previousShort);

    const netPositions = longPositions == null || shortPositions == null ? null : longPositions - shortPositions;
    const previousNet = previousLong == null || previousShort == null ? null : previousLong - previousShort;
    const changeLong = longPositions == null || previousLong == null ? null : longPositions - previousLong;
    const changeShort = shortPositions == null || previousShort == null ? null : shortPositions - previousShort;
    const netChange = netPositions == null || previousNet == null ? null : netPositions - previousNet;

    const percentChange = (() => {
      if (netChange == null || previousNet == null) return null;
      const denom = Math.abs(previousNet);
      if (denom === 0) return null;
      return (netChange / denom) * 100;
    })();

    const biasThreshold = (() => {
      if (longPositions == null || shortPositions == null) return 1000;
      return Math.max(1000, Math.round(0.02 * (Math.abs(longPositions) + Math.abs(shortPositions))));
    })();

    let bias: string | null = null;
    let biasStrength: number | null = null;
    if (netPositions == null) {
      bias = null;
      biasStrength = null;
    } else if (Math.abs(netPositions) <= biasThreshold) {
      bias = 'Neutral';
      biasStrength = 0;
    } else if (netPositions > 0 && (netChange ?? 0) > 0) {
      bias = 'Strong Bullish';
      biasStrength = 2;
    } else if (netPositions > 0) {
      bias = 'Bullish but weakening';
      biasStrength = 1;
    } else if (netPositions < 0 && (netChange ?? 0) < 0) {
      bias = 'Strong Bearish';
      biasStrength = 2;
    } else if (netPositions < 0) {
      bias = 'Bearish but improving';
      biasStrength = 1;
    } else {
      bias = 'Neutral';
      biasStrength = 0;
    }

    return {
      changeLong,
      changeShort,
      netPositions,
      netChange,
      percentChange: percentChange == null ? null : Math.round(percentChange * 100) / 100,
      bias,
      biasStrength,
    };
  }
}

export class CftcCotSourceDiscoveryService {
  private readonly sourceUrl = 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalCompressed/index.htm';

  async discoverFuturesOnlyYearLinks(): Promise<SourceYearLink[]> {
    const response = await fetch(this.sourceUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`CFTC page unreachable (HTTP ${response.status}).`);
    const html = await response.text();

    const sectionStart = html.indexOf('Futures Only Reports');
    if (sectionStart < 0) throw new Error('Futures Only section not found.');
    const slice = html.slice(sectionStart, sectionStart + 120_000);

    const yearSet = new Set<number>();
    const textLinks = new Map<number, string>();
    const excelLinks = new Map<number, string>();

    const textRe = /href="([^"]*deacot(\d{4})\.zip)"/gi;
    const excelRe = /href="([^"]*dea_fut_xls_(\d{4})\.zip)"/gi;

    for (const match of slice.matchAll(textRe)) {
      const url = new URL(match[1], this.sourceUrl).toString();
      const year = Number(match[2]);
      if (!Number.isFinite(year)) continue;
      yearSet.add(year);
      textLinks.set(year, url);
    }

    for (const match of slice.matchAll(excelRe)) {
      const url = new URL(match[1], this.sourceUrl).toString();
      const year = Number(match[2]);
      if (!Number.isFinite(year)) continue;
      yearSet.add(year);
      excelLinks.set(year, url);
    }

    const years = Array.from(yearSet.values()).sort((a, b) => b - a);
    const merged = years
      .map((year) => {
        const textZipUrl = textLinks.get(year) ?? '';
        const excelZipUrl = excelLinks.get(year) ?? '';
        if (!textZipUrl || !excelZipUrl) return null;
        return { year, textZipUrl, excelZipUrl } satisfies SourceYearLink;
      })
      .filter(Boolean) as SourceYearLink[];

    if (!merged.length) throw new Error('Yearly Futures Only file links missing.');
    return merged;
  }
}

export class CftcCotFileDownloadService {
  async downloadZip(url: string): Promise<Uint8Array> {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`File download failed (HTTP ${response.status}).`);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  unzipFirstFile(zipBytes: Uint8Array): { name: string; bytes: Uint8Array } {
    const files = unzipSync(zipBytes);
    const entries = Object.entries(files);
    if (!entries.length) throw new Error('Zip contained no files.');
    const [name, bytes] = entries[0];
    return { name, bytes };
  }
}

export class CftcCotParserService {
  parseCsvText(csvText: string): Array<Record<string, string>> {
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) throw new Error('Text file parse failed (no rows).');
    const header = csvSplitLine(lines[0]).map((h) => h.replaceAll(/^"|"$/g, '').trim());
    const required = [
      'Market and Exchange Names',
      'As of Date in Form YYYY-MM-DD',
      'CFTC Contract Market Code',
      'Noncommercial Positions-Long (All)',
      'Noncommercial Positions-Short (All)',
    ];
    for (const key of required) {
      if (!header.includes(key)) throw new Error(`Required column missing: ${key}`);
    }

    const rows: Array<Record<string, string>> = [];
    for (let i = 1; i < lines.length; i += 1) {
      const cells = csvSplitLine(lines[i]);
      if (cells.length !== header.length) continue;
      const row: Record<string, string> = {};
      for (let j = 0; j < header.length; j += 1) row[header[j]] = cells[j];
      rows.push(row);
    }
    return rows;
  }

  parseExcel(bytes: Uint8Array): Array<Record<string, unknown>> {
    const workbook = XLSX.read(bytes, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('Excel file parse failed (missing sheet).');
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    if (!json.length) throw new Error('Excel file parse failed (no rows).');
    return json;
  }
}

export class CotSourceLogService {
  async append(input: { jobType: string; status: 'success' | 'error' | 'warning' | 'info'; message: string; details?: any; sourceUrl?: string; sourceYear?: number | null }): Promise<void> {
    await queryPostgres(
      `
        INSERT INTO cot_source_logs (job_type, status, message, details, source_url, source_year, fetched_at)
        VALUES ($1, $2, $3, $4, $5, $6, now())
      `,
      [
        input.jobType,
        input.status,
        input.message,
        input.details == null ? null : JSON.stringify(input.details),
        input.sourceUrl ?? null,
        input.sourceYear ?? null,
      ],
    ).catch(() => null);
  }

  async list(limit = 200): Promise<any[]> {
    const result = await queryPostgres(
      `
        SELECT id, job_type, status, message, details, source_url, source_year, fetched_at
        FROM cot_source_logs
        ORDER BY fetched_at DESC, id DESC
        LIMIT $1
      `,
      [Math.min(500, Math.max(1, Math.round(limit)))],
    );
    return result.rows as any[];
  }
}

export class CotHistoricalSyncService {
  private readonly discovery = new CftcCotSourceDiscoveryService();
  private readonly downloader = new CftcCotFileDownloadService();
  private readonly parser = new CftcCotParserService();
  private readonly normalizer = new CftcCotCurrencyNormalizerService();
  private readonly biasEngine = new CotInstitutionalBiasEngineService();
  private readonly logs = new CotSourceLogService();

  private cutoffDateIso(now = new Date(), yearsBack = 2): string {
    const cutoff = subtractYears(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), yearsBack);
    const y = cutoff.getUTCFullYear();
    const m = String(cutoff.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cutoff.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private requiredYearsForLast2Years(now = new Date()): number[] {
    const cutoff = this.cutoffDateIso(now, 2);
    const cutoffYear = Number(cutoff.slice(0, 4));
    const currentYear = now.getUTCFullYear();
    const years: number[] = [];
    for (let y = cutoffYear; y <= currentYear; y += 1) years.push(y);
    return years;
  }

  private async normalizeUsdCurrencyLabel(): Promise<void> {
    await queryPostgres(
      `
        DELETE FROM cot_institutional_positions a
        USING cot_institutional_positions b
        WHERE a.report_type = 'FUTURES_ONLY'
          AND b.report_type = 'FUTURES_ONLY'
          AND a.currency = 'USD Index'
          AND b.currency = 'USD'
          AND a.report_date = b.report_date
      `,
    ).catch(() => null);

    await queryPostgres(
      `
        UPDATE cot_institutional_positions
        SET currency = 'USD', updated_at = now()
        WHERE report_type = 'FUTURES_ONLY'
          AND currency = 'USD Index'
      `,
    ).catch(() => null);
  }

  async syncLast2Years(): Promise<SyncResult> {
    const years = this.requiredYearsForLast2Years(new Date());
    return this.syncYears(years, 'sync_last_2_years');
  }

  async syncCurrentYear(): Promise<SyncResult> {
    const year = new Date().getUTCFullYear();
    return this.syncYears([year], 'sync_current_year');
  }

  async syncPreviousYear(): Promise<SyncResult> {
    const year = new Date().getUTCFullYear() - 1;
    return this.syncYears([year], 'sync_previous_year');
  }

  async syncLatest(): Promise<SyncResult> {
    const year = new Date().getUTCFullYear();
    return this.syncYears([year], 'sync_latest');
  }

  private async loadYearRows(link: SourceYearLink): Promise<Array<Record<string, unknown>>> {
    const textZip = await this.downloader.downloadZip(link.textZipUrl);
    const { bytes: textBytes } = this.downloader.unzipFirstFile(textZip);
    try {
      const text = strFromU8(textBytes);
      const parsed = this.parser.parseCsvText(text);
      return parsed;
    } catch (error) {
      await this.logs.append({
        jobType: 'cot_parse_fallback',
        status: 'warning',
        message: error instanceof Error ? error.message : 'Text parsing failed; falling back to Excel.',
        sourceUrl: link.textZipUrl,
        sourceYear: link.year,
      });
    }

    const excelZip = await this.downloader.downloadZip(link.excelZipUrl);
    const { bytes: excelBytes } = this.downloader.unzipFirstFile(excelZip);
    const parsed = this.parser.parseExcel(excelBytes);
    return parsed;
  }

  private buildPositions(rows: Array<Record<string, unknown>>, link: SourceYearLink, cutoffIso: string): CotInstitutionalPositionRow[] {
    const filtered: Array<{
      reportDate: string;
      currency: string;
      marketName: string | null;
      exchange: string | null;
      cftcMarketCode: string | null;
      longPositions: number | null;
      shortPositions: number | null;
      rawContractMarketName: string;
      rawRowHash: string;
    }> = [];

    for (const row of rows) {
      const rawContractMarketName = String((row as any)['Market and Exchange Names'] ?? (row as any)['Market_and_Exchange_Names'] ?? '').trim();
      if (!rawContractMarketName) continue;
      const normalized = this.normalizer.normalize(rawContractMarketName);
      if (!normalized.currency) continue;
      const reportDate = parseDateYmd((row as any)['As of Date in Form YYYY-MM-DD'] ?? (row as any)['Report_Date_as_YYYY-MM-DD']);
      if (!reportDate) {
        continue;
      }
      if (reportDate < cutoffIso) continue;

      const cftcMarketCode = String((row as any)['CFTC Contract Market Code'] ?? (row as any)['CFTC_Contract_Market_Code'] ?? '').trim() || null;
      const longPositions = parseNumber((row as any)['Noncommercial Positions-Long (All)'] ?? (row as any)['Noncommercial_Positions_Long_All']);
      const shortPositions = parseNumber((row as any)['Noncommercial Positions-Short (All)'] ?? (row as any)['Noncommercial_Positions_Short_All']);

      const rawRowHash = sha256(`${reportDate}|${normalized.currency}|${rawContractMarketName}|${cftcMarketCode}|${longPositions ?? ''}|${shortPositions ?? ''}|${link.year}`);

      filtered.push({
        reportDate,
        currency: normalized.currency,
        marketName: normalized.marketName,
        exchange: normalized.exchange,
        cftcMarketCode,
        longPositions: longPositions == null ? null : Math.round(longPositions),
        shortPositions: shortPositions == null ? null : Math.round(shortPositions),
        rawContractMarketName,
        rawRowHash,
      });
    }

    const byCurrency = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const existing = byCurrency.get(item.currency) ?? [];
      existing.push(item);
      byCurrency.set(item.currency, existing);
    }

    const output: CotInstitutionalPositionRow[] = [];
    for (const [currency, list] of byCurrency.entries()) {
      const sorted = list.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
      for (let i = 0; i < sorted.length; i += 1) {
        const current = sorted[i];
        const prev = i > 0 ? sorted[i - 1] : null;
        const computed = this.biasEngine.compute({
          longPositions: current.longPositions,
          shortPositions: current.shortPositions,
          previousLong: prev?.longPositions ?? null,
          previousShort: prev?.shortPositions ?? null,
        });

        output.push({
          reportDate: current.reportDate,
          currency,
          marketName: current.marketName,
          cftcMarketCode: current.cftcMarketCode,
          exchange: current.exchange,
          longPositions: current.longPositions,
          shortPositions: current.shortPositions,
          changeLong: computed.changeLong,
          changeShort: computed.changeShort,
          percentChange: computed.percentChange,
          netPositions: computed.netPositions,
          netChange: computed.netChange,
          bias: computed.bias,
          biasStrength: clampInt(computed.biasStrength, 0, 3),
          reportType: 'FUTURES_ONLY',
          sourceName: 'CFTC',
          sourceUrl: link.textZipUrl,
          sourceYear: link.year,
          rawContractMarketName: current.rawContractMarketName,
          rawRowHash: current.rawRowHash,
        });
      }
    }

    return output;
  }

  private async upsertPositions(rows: CotInstitutionalPositionRow[]): Promise<{ inserted: number; updated: number; skipped: number }> {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const result = await queryPostgres(
          `
            INSERT INTO cot_institutional_positions (
              report_date,
              currency,
              market_name,
              cftc_market_code,
              exchange,
              long_positions,
              short_positions,
              change_long,
              change_short,
              percent_change,
              net_positions,
              net_change,
              bias,
              bias_strength,
              report_type,
              source_name,
              source_url,
              source_year,
              raw_contract_market_name,
              raw_row_hash,
              created_at,
              updated_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now(),now())
            ON CONFLICT (report_date, currency, report_type)
            DO UPDATE SET
              market_name = CASE
                WHEN cot_institutional_positions.market_name IS NULL
                  OR cot_institutional_positions.market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.market_name LIKE '%/%'
                  OR cot_institutional_positions.raw_contract_market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.raw_contract_market_name LIKE '%/%'
                THEN EXCLUDED.market_name
                ELSE cot_institutional_positions.market_name
              END,
              cftc_market_code = CASE
                WHEN cot_institutional_positions.market_name IS NULL
                  OR cot_institutional_positions.market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.market_name LIKE '%/%'
                  OR cot_institutional_positions.raw_contract_market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.raw_contract_market_name LIKE '%/%'
                THEN EXCLUDED.cftc_market_code
                ELSE cot_institutional_positions.cftc_market_code
              END,
              exchange = CASE
                WHEN cot_institutional_positions.market_name IS NULL
                  OR cot_institutional_positions.market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.market_name LIKE '%/%'
                  OR cot_institutional_positions.raw_contract_market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.raw_contract_market_name LIKE '%/%'
                THEN EXCLUDED.exchange
                ELSE cot_institutional_positions.exchange
              END,
              long_positions = EXCLUDED.long_positions,
              short_positions = EXCLUDED.short_positions,
              source_url = CASE
                WHEN cot_institutional_positions.market_name IS NULL
                  OR cot_institutional_positions.market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.market_name LIKE '%/%'
                  OR cot_institutional_positions.raw_contract_market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.raw_contract_market_name LIKE '%/%'
                THEN EXCLUDED.source_url
                ELSE cot_institutional_positions.source_url
              END,
              source_year = CASE
                WHEN cot_institutional_positions.market_name IS NULL
                  OR cot_institutional_positions.market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.market_name LIKE '%/%'
                  OR cot_institutional_positions.raw_contract_market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.raw_contract_market_name LIKE '%/%'
                THEN EXCLUDED.source_year
                ELSE cot_institutional_positions.source_year
              END,
              raw_contract_market_name = CASE
                WHEN cot_institutional_positions.market_name IS NULL
                  OR cot_institutional_positions.market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.market_name LIKE '%/%'
                  OR cot_institutional_positions.raw_contract_market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.raw_contract_market_name LIKE '%/%'
                THEN EXCLUDED.raw_contract_market_name
                ELSE cot_institutional_positions.raw_contract_market_name
              END,
              raw_row_hash = CASE
                WHEN cot_institutional_positions.market_name IS NULL
                  OR cot_institutional_positions.market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.market_name LIKE '%/%'
                  OR cot_institutional_positions.raw_contract_market_name ILIKE '%XRATE%'
                  OR cot_institutional_positions.raw_contract_market_name LIKE '%/%'
                THEN EXCLUDED.raw_row_hash
                ELSE cot_institutional_positions.raw_row_hash
              END,
              change_long = EXCLUDED.change_long,
              change_short = EXCLUDED.change_short,
              percent_change = EXCLUDED.percent_change,
              net_positions = EXCLUDED.net_positions,
              net_change = EXCLUDED.net_change,
              bias = EXCLUDED.bias,
              bias_strength = EXCLUDED.bias_strength,
              updated_at = now()
            RETURNING (xmax = 0) AS inserted
          `,
          [
            row.reportDate,
            row.currency,
            row.marketName,
            row.cftcMarketCode,
            row.exchange,
            row.longPositions,
            row.shortPositions,
            row.changeLong,
            row.changeShort,
            row.percentChange,
            row.netPositions,
            row.netChange,
            row.bias,
            row.biasStrength,
            row.reportType,
            row.sourceName,
            row.sourceUrl,
            row.sourceYear,
            row.rawContractMarketName,
            row.rawRowHash,
          ],
        );
        const didInsert = Boolean((result.rows[0] as any)?.inserted);
        if (didInsert) inserted += 1;
        else updated += 1;
      } catch (error) {
        skipped += 1;
        await this.logs.append({
          jobType: 'cot_upsert_row',
          status: 'warning',
          message: error instanceof Error ? error.message : 'Row upsert failed.',
          details: { reportDate: row.reportDate, currency: row.currency, reportType: row.reportType, rawRowHash: row.rawRowHash },
        });
      }
    }

    return { inserted, updated, skipped };
  }

  async syncYears(years: number[], jobType: string): Promise<SyncResult> {
    const cutoffIso = this.cutoffDateIso(new Date(), 2);
    const requested = Array.from(new Set(years)).sort((a, b) => a - b);
    const links = await this.discovery.discoverFuturesOnlyYearLinks();
    const byYear = new Map<number, SourceYearLink>(links.map((l) => [l.year, l]));
    const missing = requested.filter((y) => !byYear.has(y));
    if (missing.length) {
      await this.logs.append({ jobType, status: 'error', message: `Yearly file link missing for: ${missing.join(', ')}` });
      throw new Error(`Yearly file link missing for: ${missing.join(', ')}`);
    }

    let allRows: CotInstitutionalPositionRow[] = [];
    for (const year of requested) {
      const link = byYear.get(year)!;
      try {
        await this.logs.append({ jobType, status: 'info', message: `Fetching CFTC Futures Only ${year}`, sourceUrl: link.textZipUrl, sourceYear: year });
        const rawRows = await this.loadYearRows(link);
        const positions = this.buildPositions(rawRows, link, cutoffIso);
        allRows = allRows.concat(positions);
        await this.logs.append({ jobType, status: 'success', message: `Parsed ${positions.length} rows for ${year}`, sourceUrl: link.textZipUrl, sourceYear: year });
      } catch (error) {
        await this.logs.append({
          jobType,
          status: 'error',
          message: error instanceof Error ? error.message : `Failed to process year ${year}`,
          sourceUrl: link.textZipUrl,
          sourceYear: year,
        });
      }
    }

    const deduped = new Map<string, CotInstitutionalPositionRow>();
    for (const row of allRows) {
      const key = `${row.reportDate}|${row.currency}|${row.reportType}`;
      deduped.set(key, row);
    }
    const finalRows = Array.from(deduped.values());

    const upsert = await this.upsertPositions(finalRows);
    await this.normalizeUsdCurrencyLabel();
    const ok = upsert.skipped === 0;
    const message = `Synced ${finalRows.length} records for years ${requested.join(', ')} (inserted ${upsert.inserted}, updated ${upsert.updated}, skipped ${upsert.skipped}).`;
    await this.logs.append({ jobType, status: ok ? 'success' : 'warning', message, details: { ...upsert, years: requested, cutoffIso } });
    return { ok, inserted: upsert.inserted, updated: upsert.updated, skipped: upsert.skipped, years: requested, message };
  }
}

export class CftcCotFuturesOnlyCollectorService {
  private readonly sync = new CotHistoricalSyncService();

  async syncLast2Years(): Promise<SyncResult> {
    return this.sync.syncLast2Years();
  }

  async syncCurrentYear(): Promise<SyncResult> {
    return this.sync.syncCurrentYear();
  }

  async syncPreviousYear(): Promise<SyncResult> {
    return this.sync.syncPreviousYear();
  }

  async syncLatest(): Promise<SyncResult> {
    return this.sync.syncLatest();
  }
}

declare global {
  var __cacsmsCotSchedulerStarted: boolean | undefined;
  var __cacsmsCotSchedulerTimer: ReturnType<typeof setInterval> | undefined;
}

export class CotWeeklySchedulerService {
  private readonly logs = new CotSourceLogService();
  private readonly collector = new CftcCotFuturesOnlyCollectorService();

  ensureStarted(): void {
    if (globalThis.__cacsmsCotSchedulerStarted) return;
    globalThis.__cacsmsCotSchedulerStarted = true;

    globalThis.__cacsmsCotSchedulerTimer = setInterval(() => {
      this.tick().catch(() => null);
    }, 60_000);
  }

  private async alreadyRanToday(jobType: string, lagosDate: string): Promise<boolean> {
    try {
      const result = await queryPostgres(
        `
          SELECT 1
          FROM cot_source_logs
          WHERE job_type = $1
            AND status IN ('success', 'warning', 'error', 'info')
            AND message NOT LIKE 'Scheduler firing%'
            AND DATE(fetched_at AT TIME ZONE 'Africa/Lagos') = $2::date
          LIMIT 1
        `,
        [jobType, lagosDate],
      );
      return Boolean(result.rows[0]);
    } catch {
      return false;
    }
  }

  private async latestReportAgeDays(): Promise<number | null> {
    try {
      const result = await queryPostgres(
        `
          SELECT MAX(report_date::date)::text AS latest_date
          FROM cot_institutional_positions
          WHERE report_type = 'FUTURES_ONLY'
        `,
      );
      const latest = String((result.rows[0] as { latest_date?: string })?.latest_date ?? '').trim();
      if (!latest) return null;
      const ageMs = Date.now() - Date.parse(`${latest}T00:00:00Z`);
      if (!Number.isFinite(ageMs)) return null;
      return Math.floor(ageMs / (24 * 60 * 60 * 1000));
    } catch {
      return null;
    }
  }

  async tick(): Promise<void> {
    const now = lagosNowUtcShifted();
    const reportAgeDays = await this.latestReportAgeDays();
    const stale = reportAgeDays == null || reportAgeDays >= 8;
    const scheduledWindow = shouldRunSaturdayMidnightLagos(now);
    if (!scheduledWindow && !stale) return;

    const jobType = 'cot_weekly_scheduler';
    const dateKey = lagosDateKey(now);
    if (await this.alreadyRanToday(jobType, dateKey)) return;

    const reason = scheduledWindow ? `weekly window ${dateKey}` : `stale data (${reportAgeDays ?? 'none'} days old)`;
    await this.logs.append({ jobType, status: 'info', message: `Scheduler firing (${reason}).`, details: { dateKey, firedAt: nowIso(), reportAgeDays } });
    try {
      const result = reportAgeDays == null
        ? await this.collector.syncLast2Years()
        : await this.collector.syncLatest();
      await this.logs.append({ jobType, status: 'success', message: result.message, details: result });
    } catch (error) {
      await this.logs.append({ jobType, status: 'error', message: error instanceof Error ? error.message : 'Scheduled sync failed.' });
    }
  }
}
