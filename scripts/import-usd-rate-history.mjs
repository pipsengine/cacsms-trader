/**
 * One-off import: USD rate history from Investing.com event page 168.
 * Usage: node scripts/import-usd-rate-history.mjs
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
Jun 17, 2026 19:00 — 3.75% 3.75%
Apr 29, 2026 19:00 3.75% 3.75% 3.75%
Mar 18, 2026 19:00 3.75% 3.75% 3.75%
Jan 28, 2026 20:00 3.75% 3.75% 3.75%
Dec 10, 2025 20:00 3.75% 3.75% 4.00%
Oct 29, 2025 19:00 4.00% 4.00% 4.25%
Sep 17, 2025 19:00 4.25% 4.25% 4.50%
Jul 30, 2025 19:00 4.50% 4.50% 4.50%
Jun 18, 2025 19:00 4.50% 4.50% 4.50%
May 07, 2025 19:00 4.50% 4.50% 4.50%
Mar 19, 2025 19:00 4.50% 4.50% 4.50%
Jan 29, 2025 20:00 4.50% 4.50% 4.50%
Dec 18, 2024 20:00 4.50% 4.50% 4.75%
Nov 07, 2024 20:00 4.75% 4.75% 5.00%
Sep 18, 2024 19:00 5.00% 5.25% 5.50%
Jul 31, 2024 19:00 5.50% 5.50% 5.50%
Jun 12, 2024 19:00 5.50% 5.50% 5.50%
May 01, 2024 19:00 5.50% 5.50% 5.50%
Mar 20, 2024 19:00 5.50% 5.50% 5.50%
Jan 31, 2024 20:00 5.50% 5.50% 5.50%
Dec 13, 2023 20:00 5.50% 5.50% 5.50%
Nov 01, 2023 19:00 5.50% 5.50% 5.50%
Sep 20, 2023 19:00 5.50% 5.50% 5.50%
Jul 26, 2023 19:00 5.50% 5.50% 5.25%
Jun 14, 2023 19:00 5.25% 5.25% 5.25%
May 03, 2023 19:00 5.25% 5.25% 5.00%
Mar 22, 2023 19:00 5.00% 5.00% 4.75%
Feb 01, 2023 20:00 4.75% 4.75% 4.50%
Dec 14, 2022 20:00 4.50% 4.50% 4.00%
Nov 02, 2022 19:00 4.00% 4.00% 3.25%
Sep 21, 2022 19:00 3.25% 3.25% 2.50%
Jul 27, 2022 19:00 2.50% 2.50% 1.75%
Jun 15, 2022 19:00 1.75% 1.50% 1.00%
May 04, 2022 19:00 1.00% 1.00% 0.50%
Mar 16, 2022 19:00 0.50% 0.50% 0.25%
Jan 26, 2022 20:00 0.25% 0.25% 0.25%
Dec 15, 2021 20:00 0.25% 0.25% 0.25%
Nov 03, 2021 19:00 0.25% 0.25% 0.25%
Sep 22, 2021 19:00 0.25% 0.25% 0.25%
Jul 28, 2021 19:00 0.25% 0.25% 0.25%
Jun 16, 2021 19:00 0.25% 0.25% 0.25%
Apr 28, 2021 19:00 0.25% 0.25% 0.25%
Mar 17, 2021 19:00 0.25% 0.25% 0.25%
Jan 27, 2021 20:00 0.25% 0.25% 0.25%
Dec 16, 2020 20:00 0.25% 0.25% 0.25%
Nov 05, 2020 20:00 0.25% 0.25% 0.25%
Sep 16, 2020 19:00 0.25% 0.25% 0.25%
Jul 29, 2020 19:00 0.25% 0.25% 0.25%
Jun 10, 2020 19:00 0.25% 0.25% 0.25%
Apr 29, 2020 19:00 0.25% 0.25% 0.25%
Mar 15, 2020 22:00 0.25% — 1.25%
Mar 03, 2020 16:00 1.25% — 1.75%
Jan 29, 2020 20:00 1.75% 1.75% 1.75%
Dec 11, 2019 20:00 1.75% 1.75% 1.75%
Oct 30, 2019 19:00 1.75% 1.75% 2.00%
Sep 18, 2019 19:00 2.00% 2.00% 2.25%
Jul 31, 2019 19:00 2.25% 2.25% 2.50%
Jun 19, 2019 19:00 2.50% 2.50% 2.50%
May 01, 2019 19:00 2.50% 2.50% 2.50%
Mar 20, 2019 19:00 2.50% 2.50% 2.50%
Jan 30, 2019 20:00 2.50% 2.50% 2.50%
Dec 19, 2018 20:00 2.50% 2.50% 2.25%
Nov 08, 2018 20:00 2.25% 2.25% 2.25%
Sep 26, 2018 19:00 2.25% 2.25% 2.00%
Aug 01, 2018 19:00 2.00% 2.00% 2.00%
Jun 13, 2018 19:00 2.00% 2.00% 1.75%
May 02, 2018 19:00 1.75% 1.75% 1.75%
Mar 21, 2018 19:00 1.75% 1.75% 1.50%
Jan 31, 2018 20:00 1.50% 1.50% 1.50%
Dec 13, 2017 20:00 1.50% 1.50% 1.25%
Nov 01, 2017 19:00 1.25% 1.25% 1.25%
Sep 20, 2017 19:00 1.25% 1.25% 1.25%
Jul 26, 2017 19:00 1.25% 1.25% 1.25%
Jun 14, 2017 19:00 1.25% 1.25% 1.00%
May 03, 2017 19:00 1.00% 1.00% 1.00%
Mar 15, 2017 19:00 1.00% 1.00% 0.75%
Feb 01, 2017 20:00 0.75% 0.75% 0.75%
Dec 14, 2016 20:00 0.75% 0.75% 0.50%
Nov 02, 2016 19:00 0.50% 0.50% 0.50%
Sep 21, 2016 19:00 0.50% 0.50% 0.50%
Jul 27, 2016 19:00 0.50% 0.50% 0.50%
Jun 15, 2016 19:00 0.50% 0.50% 0.50%
Apr 27, 2016 19:00 0.50% 0.50% 0.50%
Mar 16, 2016 19:00 0.50% 0.50% 0.50%
Jan 27, 2016 20:00 0.50% 0.50% 0.50%
Dec 16, 2015 20:00 0.50% 0.50% 0.25%
Oct 28, 2015 19:00 0.25% 0.25% 0.25%
Sep 17, 2015 19:00 0.25% 0.25% 0.25%
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

const EVENT_ID = 168;
const CURRENCY = 'USD';
const CENTRAL_BANK = 'Federal Reserve (FOMC)';
const COUNTRY = 'United States';
const EVENT_NAME = 'Interest Rate Decision';
const SOURCE_URL = 'https://www.investing.com/economic-calendar/interest-rate-decision-168';

function computeBias(actual, forecast) {
  if (actual == null || forecast == null) return null;
  if (actual > forecast) return `Bullish ${CURRENCY}`;
  if (actual < forecast) return `Bearish ${CURRENCY}`;
  return `Neutral ${CURRENCY}`;
}

const rows = parseRows(PASTED);
console.log(`Parsed ${rows.length} USD rows`);

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
   VALUES ($1,$2, now(), now(), 'PASTE_IMPORT_USD', $3,$4,$5, null)`,
  [EVENT_ID, CURRENCY, rows.length, inserted, updated],
);

const count = await pool.query(`SELECT COUNT(*)::int AS count FROM central_bank_rate_history WHERE currency = 'USD'`);
console.log(JSON.stringify({ ok: true, parsed: rows.length, inserted, updated, usdTotal: count.rows[0]?.count }, null, 2));

await pool.end();
