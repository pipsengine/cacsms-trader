/**
 * One-off import: GBP rate history from Investing.com event page 170.
 * Usage: node scripts/import-gbp-rate-history.mjs
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

const PASTED = `
Release date Time Actual Forecast Previous
Jun 18, 2026 (Jun) 12:00 — 3.75% 3.75%
Apr 30, 2026 (Apr) 12:00 3.75% 3.75% 3.75%
Mar 19, 2026 (Mar) 13:00 3.75% 3.75% 3.75%
Feb 05, 2026 (Feb) 13:00 3.75% 3.75% 3.75%
Dec 18, 2025 (Dec) 13:00 3.75% 3.75% 4.00%
Nov 06, 2025 (Nov) 13:00 4.00% 4.00% 4.00%
Sep 18, 2025 (Sep) 12:00 4.00% 4.00% 4.00%
Aug 07, 2025 (Aug) 12:00 4.00% 4.00% 4.25%
Jun 19, 2025 (Jun) 12:00 4.25% 4.25% 4.25%
May 08, 2025 (May) 12:02 4.25% 4.25% 4.50%
Mar 20, 2025 (Mar) 13:00 4.50% 4.50% 4.50%
Feb 06, 2025 (Feb) 13:00 4.50% 4.50% 4.75%
Dec 19, 2024 (Dec) 13:00 4.75% 4.75% 4.75%
Nov 07, 2024 (Nov) 13:00 4.75% 4.75% 5.00%
Sep 19, 2024 (Sep) 12:00 5.00% 5.00% 5.00%
Aug 01, 2024 (Aug) 12:00 5.00% 5.00% 5.25%
Jun 20, 2024 (Jun) 12:00 5.25% 5.25% 5.25%
May 09, 2024 (Apr) 12:00 5.25% 5.25% 5.25%
Mar 21, 2024 (Mar) 13:00 5.25% 5.25% 5.25%
Feb 01, 2024 (Jan) 13:00 5.25% 5.25% 5.25%
Dec 14, 2023 (Dec) 13:00 5.25% 5.25% 5.25%
Nov 02, 2023 (Nov) 13:00 5.25% 5.25% 5.25%
Sep 21, 2023 (Sep) 12:00 5.25% 5.50% 5.25%
Aug 03, 2023 (Aug) 12:00 5.25% 5.25% 5.00%
Jun 22, 2023 (Jun) 12:00 5.00% 4.75% 4.50%
May 11, 2023 (May) 12:00 4.50% 4.50% 4.25%
Mar 23, 2023 (Mar) 13:00 4.25% 4.25% 4.00%
Feb 02, 2023 (Jan) 13:00 4.00% 4.00% 3.50%
Dec 15, 2022 (Dec) 13:00 3.50% 3.50% 3.00%
Nov 03, 2022 (Nov) 13:00 3.00% 3.00% 2.25%
Sep 22, 2022 (Sep) 12:00 2.25% 2.25% 1.75%
Aug 04, 2022 (Aug) 12:00 1.75% 1.75% 1.25%
Jun 16, 2022 (Jun) 12:00 1.25% 1.25% 1.00%
May 05, 2022 (May) 12:00 1.00% 1.00% 0.75%
Mar 17, 2022 (Mar) 13:00 0.75% 0.75% 0.50%
Feb 03, 2022 (Feb) 13:00 0.50% 0.50% 0.25%
Dec 16, 2021 (Dec) 13:00 0.25% 0.10% 0.10%
Nov 04, 2021 (Nov) 13:00 0.10% 0.10% 0.10%
Sep 23, 2021 (Sep) 12:00 0.10% 0.10% 0.10%
Aug 05, 2021 (Aug) 12:00 0.10% 0.10% 0.10%
Jun 24, 2021 (Jun) 12:00 0.10% 0.10% 0.10%
May 06, 2021 (May) 12:00 0.10% 0.10% 0.10%
Mar 18, 2021 (Mar) 13:00 0.10% 0.10% 0.10%
Feb 04, 2021 (Feb) 13:00 0.10% 0.10% 0.10%
Dec 17, 2020 (Dec) 13:00 0.10% 0.10% 0.10%
Nov 05, 2020 (Nov) 08:00 0.10% 0.10% 0.10%
Sep 17, 2020 (Sep) 12:00 0.10% 0.10% 0.10%
Aug 06, 2020 (Jul) 07:00 0.10% 0.10% 0.10%
Jun 18, 2020 (Jun) 12:00 0.10% 0.10% 0.10%
May 07, 2020 (May) 07:00 0.10% 0.10% 0.10%
Mar 26, 2020 (Mar) 13:00 0.10% 0.10% 0.10%
Mar 19, 2020 (Mar) 13:00 0.10% 0.25% 0.25%
Mar 11, 2020 (Mar) 08:00 0.25% — 0.75%
Jan 30, 2020 (Jan) 13:00 0.75% 0.75% 0.75%
Dec 19, 2019 (Dec) 13:00 0.75% 0.75% 0.75%
Nov 07, 2019 (Nov) 13:00 0.75% 0.75% 0.75%
Sep 19, 2019 (Sep) 12:00 0.75% 0.75% 0.75%
Aug 01, 2019 (Aug) 12:00 0.75% 0.75% 0.75%
Jun 20, 2019 (Jun) 12:00 0.75% 0.75% 0.75%
May 02, 2019 (May) 12:00 0.75% 0.75% 0.75%
Mar 21, 2019 (Mar) 13:00 0.75% 0.75% 0.75%
Feb 07, 2019 (Feb) 13:00 0.75% 0.75% 0.75%
Dec 20, 2018 (Dec) 13:00 0.75% 0.75% 0.75%
Nov 01, 2018 (Nov) 13:00 0.75% 0.75% 0.75%
Sep 13, 2018 (Sep) 12:00 0.75% 0.75% 0.75%
Aug 02, 2018 (Aug) 12:00 0.75% 0.75% 0.50%
Jun 21, 2018 (Jun) 12:00 0.50% 0.50% 0.50%
May 10, 2018 (May) 12:00 0.50% 0.50% 0.50%
Mar 22, 2018 (Mar) 13:00 0.50% 0.50% 0.50%
Feb 08, 2018 (Feb) 13:00 0.50% 0.50% 0.50%
Dec 14, 2017 (Dec) 13:00 0.50% 0.50% 0.50%
Nov 02, 2017 (Oct) 13:00 0.50% 0.50% 0.25%
Sep 14, 2017 (Sep) 12:00 0.25% 0.25% 0.25%
Aug 03, 2017 (Jul) 12:00 0.25% 0.25% 0.25%
Jun 15, 2017 (Jun) 12:00 0.25% 0.25% 0.25%
May 11, 2017 (May) 12:00 0.25% 0.25% 0.25%
Mar 16, 2017 (Mar) 13:00 0.25% 0.25% 0.25%
Feb 02, 2017 (Jan) 13:00 0.25% 0.25% 0.25%
Dec 15, 2016 (Dec) 13:00 0.25% 0.25% 0.25%
Nov 03, 2016 (Nov) 13:00 0.25% 0.25% 0.25%
`;

function parseRows(inputText) {
  const normalized = inputText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n');
  const re = /([A-Za-z]{3}\s+\d{1,2},\s+\d{4}(?:\s*\([^)]+\))?)\s+(\d{2}:\d{2})\s+((?:\d+(?:\.\d+)?%)|—|-|n\/a)?\s*((?:\d+(?:\.\d+)?%)|—|-|n\/a)?\s*((?:\d+(?:\.\d+)?%)|—|-|n\/a)?/gi;
  const rows = [];
  for (const m of normalized.matchAll(re)) {
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

const EVENT_ID = 170;
const CURRENCY = 'GBP';
const CENTRAL_BANK = 'Bank of England (BoE)';
const COUNTRY = 'United Kingdom';
const EVENT_NAME = 'Interest Rate Decision';
const SOURCE_URL = 'https://www.investing.com/economic-calendar/interest-rate-decision-170';

function computeBias(actual, forecast) {
  if (actual == null || forecast == null) return null;
  if (actual > forecast) return `Bullish ${CURRENCY}`;
  if (actual < forecast) return `Bearish ${CURRENCY}`;
  return `Neutral ${CURRENCY}`;
}

const rows = parseRows(PASTED);
console.log(`Parsed ${rows.length} GBP rows`);

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
   VALUES ($1,$2, now(), now(), 'PASTE_IMPORT_GBP', $3,$4,$5, null)`,
  [EVENT_ID, CURRENCY, rows.length, inserted, updated],
);

const count = await pool.query(`SELECT COUNT(*)::int AS count FROM central_bank_rate_history WHERE currency = 'GBP'`);
console.log(JSON.stringify({ ok: true, parsed: rows.length, inserted, updated, gbpTotal: count.rows[0]?.count }, null, 2));

await pool.end();
