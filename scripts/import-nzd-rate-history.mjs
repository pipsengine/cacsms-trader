/**
 * One-off import: NZD rate history from Investing.com event page 167.
 * Usage: node scripts/import-nzd-rate-history.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnvFile(name) {
  try {
    const text = readFileSync(resolve(root, name), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = value;
    }
  } catch {}
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const monthMap = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parseMdyDateToIso(value) {
  const raw = String(value ?? '').trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
  const m = raw.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const mm = monthMap[m[1].toLowerCase()] ?? '';
  if (!mm) return null;
  const dd = String(Number(m[2])).padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

function parseRateText(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '—' || raw.toLowerCase() === 'n/a') return null;
  const n = Number(raw.replaceAll('%', '').replaceAll(',', '').trim());
  return Number.isFinite(n) ? n : null;
}

const RATE = '(?:-?\\d+(?:\\.\\d+)?%)';
const ROW_RE = new RegExp(
  `([A-Za-z]{3}\\s+\\d{1,2},\\s+\\d{4}(?:\\s*\\([^)]+\\))?)\\s+(\\d{2}:\\d{2})\\s+(${RATE}|—|-|n\\/a)?\\s+(${RATE}|—|-|n\\/a)?\\s+(${RATE}|—|-|n\\/a)?`,
  'gi',
);

const PASTED = `
Release date Time Actual Forecast Previous
May 27, 2026 03:00 2.25% 2.25% 2.25%
Apr 08, 2026 03:00 2.25% 2.25% 2.25%
Feb 18, 2026 02:00 2.25% 2.25% 2.25%
Nov 26, 2025 02:00 2.25% 2.25% 2.50%
Oct 08, 2025 02:00 2.50% 2.75% 3.00%
Aug 20, 2025 03:00 3.00% 3.00% 3.25%
Jul 09, 2025 03:00 3.25% 3.25% 3.25%
May 28, 2025 03:00 3.25% 3.25% 3.50%
Apr 09, 2025 03:00 3.50% 3.50% 3.75%
Feb 19, 2025 02:00 3.75% 3.75% 4.25%
Nov 27, 2024 02:00 4.25% 4.25% 4.75%
Oct 09, 2024 02:00 4.75% 4.75% 5.25%
Aug 14, 2024 03:00 5.25% 5.50% 5.50%
Jul 10, 2024 03:00 5.50% 5.50% 5.50%
May 22, 2024 03:00 5.50% 5.50% 5.50%
Apr 10, 2024 03:00 5.50% 5.50% 5.50%
Feb 28, 2024 02:00 5.50% 5.50% 5.50%
Nov 29, 2023 02:00 5.50% 5.50% 5.50%
Oct 04, 2023 02:00 5.50% 5.50% 5.50%
Aug 16, 2023 03:00 5.50% 5.50% 5.50%
Jul 12, 2023 03:00 5.50% 5.50% 5.50%
May 24, 2023 03:00 5.50% 5.50% 5.25%
Apr 05, 2023 03:00 5.25% 5.00% 4.75%
Feb 22, 2023 02:00 4.75% 4.75% 4.25%
Nov 23, 2022 02:00 4.25% 4.25% 3.50%
Oct 05, 2022 02:00 3.50% 3.50% 3.00%
Aug 17, 2022 03:00 3.00% 3.00% 2.50%
Jul 13, 2022 03:00 2.50% 2.50% 2.00%
May 25, 2022 03:00 2.00% 2.00% 1.50%
Apr 13, 2022 03:00 1.50% 1.25% 1.00%
Feb 23, 2022 02:00 1.00% 1.00% 0.75%
Nov 24, 2021 02:00 0.75% 0.75% 0.50%
Oct 06, 2021 02:00 0.50% 0.50% 0.25%
Aug 18, 2021 03:00 0.25% 0.50% 0.25%
Jul 14, 2021 03:00 0.25% 0.25% 0.25%
May 26, 2021 03:00 0.25% 0.25% 0.25%
Apr 14, 2021 03:00 0.25% 0.25% 0.25%
Feb 24, 2021 02:00 0.25% 0.25% 0.25%
Nov 11, 2020 02:00 0.25% 0.25% 0.25%
Sep 23, 2020 03:00 0.25% 0.25% 0.25%
Aug 12, 2020 03:00 0.25% 0.25% 0.25%
Jun 24, 2020 03:00 0.25% 0.25% 0.25%
May 13, 2020 03:00 0.25% 0.25% 0.25%
Mar 15, 2020 16:00 0.25% — 1.00%
Feb 12, 2020 02:00 1.00% 1.00% 1.00%
Nov 13, 2019 02:00 1.00% 0.75% 1.00%
Sep 25, 2019 03:00 1.00% 1.00% 1.00%
Aug 07, 2019 03:00 1.00% 1.25% 1.50%
Jun 26, 2019 03:00 1.50% 1.50% 1.50%
May 08, 2019 03:00 1.50% 1.50% 1.75%
Mar 27, 2019 02:00 1.75% 1.75% 1.75%
Mar 26, 2019 21:00 — — 1.75%
Feb 13, 2019 02:00 1.75% 1.75% 1.75%
Nov 07, 2018 21:00 1.75% 1.75% 1.75%
Sep 26, 2018 22:00 1.75% 1.75% 1.75%
Aug 08, 2018 22:00 1.75% 1.75% 1.75%
Jun 27, 2018 22:00 1.75% 1.75% 1.75%
May 09, 2018 22:00 1.75% 1.75% 1.75%
Mar 21, 2018 21:00 1.75% 1.75% 1.75%
Feb 07, 2018 21:00 1.75% 1.75% 1.75%
Nov 08, 2017 21:00 1.75% 1.75% 1.75%
Sep 27, 2017 21:00 1.75% 1.75% 1.75%
Aug 09, 2017 22:00 1.75% 1.75% 1.75%
Jun 21, 2017 22:00 1.75% 1.75% 1.75%
May 10, 2017 22:00 1.75% 1.75% 1.75%
Mar 22, 2017 21:00 1.75% 1.75% 1.75%
Feb 08, 2017 21:00 1.75% 1.75% 1.75%
Nov 09, 2016 21:00 1.75% 1.75% 2.00%
Sep 21, 2016 22:00 2.00% 2.00% 2.00%
Aug 10, 2016 22:00 2.00% 2.00% 2.25%
`;

function parseRows(inputText) {
  const normalized = inputText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n');
  const rows = [];
  for (const m of normalized.matchAll(ROW_RE)) {
    const releaseDate = parseMdyDateToIso(m[1] ?? '');
    const releaseTime = String(m[2] ?? '').trim();
    if (!releaseDate || !releaseTime) continue;
    rows.push({
      releaseDate,
      releaseTime,
      actualRate: parseRateText(m[3]),
      forecastRate: parseRateText(m[4]),
      previousRate: parseRateText(m[5]),
    });
  }
  const dedup = new Map();
  for (const row of rows) dedup.set(`${row.releaseDate}|${row.releaseTime}`, row);
  return Array.from(dedup.values());
}

const EVENT_ID = 167;
const CURRENCY = 'NZD';
const CENTRAL_BANK = 'Reserve Bank of New Zealand (RBNZ)';
const COUNTRY = 'New Zealand';
const EVENT_NAME = 'Interest Rate Decision';
const SOURCE_URL = 'https://www.investing.com/economic-calendar/interest-rate-decision-167';

function computeBias(actual, forecast) {
  if (actual == null || forecast == null) return null;
  if (actual > forecast) return `Bullish ${CURRENCY}`;
  if (actual < forecast) return `Bearish ${CURRENCY}`;
  return `Neutral ${CURRENCY}`;
}

const rows = parseRows(PASTED);
console.log(`Parsed ${rows.length} NZD rows`);

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? process.env.POSTGRES_HOST_PORT ?? 5433),
  user: process.env.POSTGRES_USER ?? 'cacsms',
  password: process.env.POSTGRES_PASSWORD ?? '',
  database: process.env.POSTGRES_DB ?? 'db_cacsms-trader',
});

await pool.query(`DELETE FROM central_bank_rate_history WHERE currency = $1`, [CURRENCY]);

await pool.query(
  `INSERT INTO central_bank_rate_events (event_id, currency, country, central_bank, event_name, investing_url, is_active, created_at, updated_at)
   VALUES ($1,$2,$3,$4,$5,$6,true, now(), now())
   ON CONFLICT (event_id) DO UPDATE SET currency = EXCLUDED.currency, country = COALESCE(central_bank_rate_events.country, EXCLUDED.country),
     central_bank = COALESCE(central_bank_rate_events.central_bank, EXCLUDED.central_bank), event_name = EXCLUDED.event_name,
     investing_url = EXCLUDED.investing_url, is_active = true, updated_at = now()`,
  [EVENT_ID, CURRENCY, COUNTRY, CENTRAL_BANK, EVENT_NAME, SOURCE_URL],
);

let inserted = 0;
let updated = 0;
const fetchedAt = new Date().toISOString();

for (const row of rows) {
  const rateChange = row.actualRate != null && row.previousRate != null ? row.actualRate - row.previousRate : null;
  const surprise = row.actualRate != null && row.forecastRate != null ? row.actualRate - row.forecastRate : null;
  const bias = computeBias(row.actualRate, row.forecastRate);
  const result = await pool.query(
    `INSERT INTO central_bank_rate_history (
      event_id, currency, central_bank, release_date, release_time,
      actual_rate, forecast_rate, previous_rate, rate_change, surprise, bias,
      source_url, fetched_at, created_at, updated_at
    ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz, now(), now())
    ON CONFLICT (event_id, currency, release_date, release_time)
    DO UPDATE SET
      actual_rate = CASE WHEN EXCLUDED.actual_rate IS NOT NULL THEN EXCLUDED.actual_rate ELSE central_bank_rate_history.actual_rate END,
      forecast_rate = CASE WHEN EXCLUDED.forecast_rate IS NOT NULL THEN EXCLUDED.forecast_rate ELSE central_bank_rate_history.forecast_rate END,
      previous_rate = CASE WHEN EXCLUDED.previous_rate IS NOT NULL THEN EXCLUDED.previous_rate ELSE central_bank_rate_history.previous_rate END,
      rate_change = CASE WHEN EXCLUDED.rate_change IS NOT NULL THEN EXCLUDED.rate_change ELSE central_bank_rate_history.rate_change END,
      surprise = CASE WHEN EXCLUDED.surprise IS NOT NULL THEN EXCLUDED.surprise ELSE central_bank_rate_history.surprise END,
      bias = CASE WHEN EXCLUDED.bias IS NOT NULL THEN EXCLUDED.bias ELSE central_bank_rate_history.bias END,
      source_url = EXCLUDED.source_url,
      fetched_at = GREATEST(central_bank_rate_history.fetched_at, EXCLUDED.fetched_at),
      updated_at = now()
    RETURNING (xmax = 0) AS inserted`,
    [EVENT_ID, CURRENCY, CENTRAL_BANK, row.releaseDate, row.releaseTime, row.actualRate, row.forecastRate, row.previousRate, rateChange, surprise, bias, SOURCE_URL, fetchedAt],
  );
  if (result.rows[0]?.inserted) inserted += 1;
  else updated += 1;
}

await pool.query(
  `INSERT INTO rate_sync_logs (event_id, currency, sync_started_at, sync_completed_at, status, rows_fetched, rows_inserted, rows_updated, error_message)
   VALUES ($1,$2, now(), now(), 'PASTE_IMPORT_NZD', $3,$4,$5, null)`,
  [EVENT_ID, CURRENCY, rows.length, inserted, updated],
);

const count = await pool.query(`SELECT COUNT(*)::int AS count FROM central_bank_rate_history WHERE currency = 'NZD'`);
console.log(JSON.stringify({ ok: true, parsed: rows.length, inserted, updated, nzdTotal: count.rows[0]?.count }, null, 2));

await pool.end();
