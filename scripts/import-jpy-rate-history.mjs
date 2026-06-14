/**
 * One-off import: JPY rate history from Investing.com event page 165.
 * Usage: node scripts/import-jpy-rate-history.mjs
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
Jun 16, 2026 04:00 — 1.00% 0.75%
Apr 28, 2026 04:00 0.75% 0.75% 0.75%
Mar 19, 2026 03:30 0.75% 0.75% 0.75%
Jan 23, 2026 04:00 0.75% 0.75% 0.75%
Dec 19, 2025 04:00 0.75% 0.75% 0.50%
Oct 30, 2025 04:00 0.50% 0.50% 0.50%
Sep 19, 2025 04:00 0.50% 0.50% 0.50%
Jul 31, 2025 04:00 0.50% 0.50% 0.50%
Jun 17, 2025 04:00 0.50% 0.50% 0.50%
May 01, 2025 04:00 0.50% 0.50% 0.50%
Mar 19, 2025 03:30 0.50% 0.50% 0.50%
Jan 24, 2025 04:20 0.50% 0.50% 0.25%
Dec 19, 2024 03:55 0.25% 0.25% 0.25%
Oct 31, 2024 04:00 0.25% 0.25% 0.25%
Sep 20, 2024 04:00 0.25% 0.25% 0.25%
Jul 31, 2024 05:00 0.25% 0.10% 0.10%
Jun 14, 2024 04:25 0.10% 0.10% 0.10%
Apr 26, 2024 04:00 0.10% 0.10% 0.10%
Mar 19, 2024 04:35 0.10% 0.10% -0.10%
Jan 23, 2024 04:00 -0.10% -0.10% -0.10%
Dec 19, 2023 03:49 -0.10% -0.10% -0.10%
Oct 31, 2023 04:30 -0.10% -0.10% -0.10%
Sep 22, 2023 03:52 -0.10% -0.10% -0.10%
Jul 28, 2023 04:00 -0.10% -0.10% -0.10%
Jun 16, 2023 03:47 -0.10% -0.10% -0.10%
Apr 28, 2023 05:00 -0.10% -0.10% -0.10%
Mar 10, 2023 03:30 -0.10% -0.10% -0.10%
Jan 18, 2023 03:40 -0.10% -0.10% -0.10%
Dec 20, 2022 04:01 -0.10% -0.10% -0.10%
Oct 28, 2022 03:50 -0.10% -0.10% -0.10%
Sep 22, 2022 03:51 -0.10% -0.10% -0.10%
Jul 21, 2022 04:04 -0.10% -0.10% -0.10%
Jun 17, 2022 04:00 -0.10% — -0.10%
Jun 17, 2022 03:43 -0.10% -0.10% -0.10%
Apr 28, 2022 04:09 -0.10% -0.10% -0.10%
Mar 18, 2022 03:51 -0.10% -0.10% -0.10%
Jan 18, 2022 03:46 -0.10% -0.10% -0.10%
Dec 17, 2021 03:57 -0.10% -0.10% -0.10%
Oct 28, 2021 03:45 -0.10% -0.10% -0.10%
Sep 22, 2021 03:47 -0.10% — -0.10%
Jul 16, 2021 04:00 -0.10% -0.10% -0.10%
Jun 18, 2021 04:30 -0.10% -0.10% -0.10%
Apr 27, 2021 04:00 -0.10% -0.10% -0.10%
Mar 19, 2021 04:39 -0.10% -0.10% -0.10%
Jan 21, 2021 03:38 -0.10% -0.10% -0.10%
Dec 18, 2020 04:13 -0.10% -0.10% -0.10%
Oct 29, 2020 04:12 -0.10% -0.10% -0.10%
Sep 17, 2020 06:15 -0.10% -0.10% -0.10%
Jul 15, 2020 03:57 -0.10% -0.10% -0.10%
Jun 16, 2020 03:33 -0.10% — -0.10%
May 22, 2020 02:01 -0.10% — -0.10%
Apr 27, 2020 05:00 -0.10% -0.10% -0.10%
Mar 16, 2020 06:00 -0.10% -0.10% -0.10%
Jan 21, 2020 04:00 -0.10% -0.10% -0.10%
Dec 19, 2019 04:00 -0.10% -0.10% -0.10%
Oct 31, 2019 04:00 -0.10% -0.10% -0.10%
Sep 19, 2019 04:00 -0.10% -0.10% -0.10%
Jul 30, 2019 04:00 -0.10% -0.10% -0.10%
Jun 20, 2019 04:00 -0.10% -0.10% -0.10%
Apr 25, 2019 04:00 -0.10% -0.10% -0.10%
Mar 15, 2019 04:00 -0.10% -0.10% -0.10%
Jan 23, 2019 04:00 -0.10% -0.10% -0.10%
Dec 20, 2018 04:00 -0.10% -0.10% -0.10%
Oct 31, 2018 04:00 -0.10% -0.10% -0.10%
Sep 19, 2018 04:00 -0.10% -0.10% -0.10%
Jul 31, 2018 05:05 -0.10% -0.10% -0.10%
Jun 15, 2018 04:00 -0.10% -0.10% -0.10%
Apr 27, 2018 04:00 -0.10% -0.10% -0.10%
Mar 09, 2018 06:00 -0.10% -0.10% -0.10%
Jan 23, 2018 04:15 -0.10% -0.10% -0.10%
Dec 21, 2017 04:00 -0.10% -0.10% -0.10%
Oct 31, 2017 04:05 -0.10% -0.10% -0.10%
Sep 21, 2017 04:00 -0.10% -0.10% -0.10%
Jul 20, 2017 04:10 -0.10% -0.10% -0.10%
Jun 16, 2017 03:00 -0.10% -0.10% -0.10%
Apr 27, 2017 04:15 -0.10% -0.10% -0.10%
Mar 16, 2017 03:55 -0.10% -0.10% -0.10%
Jan 31, 2017 04:00 -0.10% -0.10% -0.10%
Dec 20, 2016 03:55 -0.10% -0.10% -0.10%
Nov 01, 2016 03:55 -0.10% -0.10% -0.10%
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

const EVENT_ID = 165;
const CURRENCY = 'JPY';
const CENTRAL_BANK = 'Bank of Japan (BoJ)';
const COUNTRY = 'Japan';
const EVENT_NAME = 'Interest Rate Decision';
const SOURCE_URL = 'https://www.investing.com/economic-calendar/interest-rate-decision-165';

function computeBias(actual, forecast) {
  if (actual == null || forecast == null) return null;
  if (actual > forecast) return `Bullish ${CURRENCY}`;
  if (actual < forecast) return `Bearish ${CURRENCY}`;
  return `Neutral ${CURRENCY}`;
}

const rows = parseRows(PASTED);
console.log(`Parsed ${rows.length} JPY rows`);

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
   VALUES ($1,$2, now(), now(), 'PASTE_IMPORT_JPY', $3,$4,$5, null)`,
  [EVENT_ID, CURRENCY, rows.length, inserted, updated],
);

const count = await pool.query(`SELECT COUNT(*)::int AS count FROM central_bank_rate_history WHERE currency = 'JPY'`);
console.log(JSON.stringify({ ok: true, parsed: rows.length, inserted, updated, jpyTotal: count.rows[0]?.count }, null, 2));

await pool.end();
