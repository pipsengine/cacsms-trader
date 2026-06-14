/**
 * One-off import: EUR rate history from Investing.com event page 164.
 * Usage: node scripts/import-eur-rate-history.mjs
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
Jun 11, 2026 (Jun) 13:15 2.40% 2.40% 2.15%
Apr 30, 2026 (Apr) 13:15 2.15% 2.15% 2.15%
Mar 19, 2026 (Mar) 14:15 2.15% 2.15% 2.15%
Feb 05, 2026 (Feb) 14:15 2.15% 2.15% 2.15%
Dec 18, 2025 (Dec) 14:15 2.15% 2.15% 2.15%
Oct 30, 2025 (Oct) 14:15 2.15% 2.15% 2.15%
Sep 11, 2025 (Sep) 13:15 2.15% 2.15% 2.15%
Jul 24, 2025 (Jul) 13:15 2.15% 2.15% 2.15%
Jun 05, 2025 (Jun) 13:15 2.15% 2.15% 2.40%
Apr 17, 2025 (Apr) 13:15 2.40% 2.40% 2.65%
Mar 06, 2025 (Mar) 14:15 2.65% 2.65% 2.90%
Jan 30, 2025 (Jan) 14:15 2.90% 2.90% 3.15%
Dec 12, 2024 (Dec) 14:15 3.15% 3.15% 3.40%
Oct 17, 2024 (Oct) 13:15 3.40% 3.40% 3.65%
Sep 12, 2024 (Sep) 13:15 3.65% 3.65% 4.25%
Jul 18, 2024 (Jul) 13:15 4.25% 4.25% 4.25%
Jun 06, 2024 (Jun) 13:15 4.25% 4.25% 4.50%
Apr 11, 2024 (Apr) 13:15 4.50% 4.50% 4.50%
Mar 07, 2024 (Mar) 14:15 4.50% 4.50% 4.50%
Jan 25, 2024 (Jan) 14:15 4.50% 4.50% 4.50%
Dec 14, 2023 (Dec) 14:15 4.50% 4.50% 4.50%
Oct 26, 2023 (Oct) 13:15 4.50% 4.50% 4.50%
Sep 14, 2023 (Sep) 13:15 4.50% 4.25% 4.25%
Jul 27, 2023 (Jul) 13:15 4.25% 4.25% 4.00%
Jun 15, 2023 (Jun) 13:15 4.00% 4.00% 3.75%
May 04, 2023 (May) 13:15 3.75% 3.75% 3.50%
Mar 16, 2023 (Mar) 14:15 3.50% 3.50% 3.00%
Feb 02, 2023 (Feb) 14:15 3.00% 3.00% 2.50%
Dec 15, 2022 (Dec) 14:15 2.50% 2.50% 2.00%
Oct 27, 2022 (Oct) 13:15 2.00% 2.00% 1.25%
Sep 08, 2022 (Sep) 13:15 1.25% 1.25% 0.50%
Jul 21, 2022 (Jul) 13:15 0.50% 0.25% 0.00%
Jun 09, 2022 (Jun) 12:45 0.00% 0.00% 0.00%
Apr 14, 2022 (Apr) 12:45 0.00% 0.00% 0.00%
Mar 10, 2022 (Mar) 13:45 0.00% 0.00% 0.00%
Feb 03, 2022 (Feb) 13:45 0.00% 0.00% 0.00%
Dec 16, 2021 (Dec) 13:45 0.00% 0.00% 0.00%
Oct 28, 2021 (Oct) 12:45 0.00% 0.00% 0.00%
Sep 09, 2021 (Aug) 12:45 0.00% 0.00% 0.00%
Jul 22, 2021 (Jul) 12:45 0.00% 0.00% 0.00%
Jun 10, 2021 (Jun) 12:45 0.00% 0.00% 0.00%
Apr 22, 2021 (Apr) 12:45 0.00% 0.00% 0.00%
Mar 11, 2021 (Mar) 13:45 0.00% 0.00% 0.00%
Jan 21, 2021 (Jan) 13:45 0.00% 0.00% 0.00%
Dec 10, 2020 (Dec) 13:45 0.00% 0.00% 0.00%
Oct 29, 2020 (Oct) 13:45 0.00% 0.00% 0.00%
Sep 10, 2020 (Sep) 12:45 0.00% 0.00% 0.00%
Jul 16, 2020 (Jul) 12:45 0.00% 0.00% 0.00%
Jun 04, 2020 (Jun) 12:45 0.00% 0.00% 0.00%
Apr 30, 2020 (Apr) 12:45 0.00% 0.00% 0.00%
Mar 12, 2020 (Mar) 13:45 0.00% 0.00% 0.00%
Jan 23, 2020 (Jan) 13:45 0.00% 0.00% 0.00%
Dec 12, 2019 (Dec) 13:45 0.00% 0.00% 0.00%
Oct 24, 2019 (Oct) 12:45 0.00% 0.00% 0.00%
Sep 12, 2019 (Sep) 12:45 0.00% 0.00% 0.00%
Jul 25, 2019 (Jul) 12:45 0.00% 0.00% 0.00%
Jun 06, 2019 (Jun) 12:45 0.00% 0.00% 0.00%
Apr 10, 2019 (Apr) 12:45 0.00% 0.00% 0.00%
Mar 07, 2019 (Mar) 13:45 0.00% 0.00% 0.00%
Jan 24, 2019 (Jan) 13:45 0.00% 0.00% 0.00%
Dec 13, 2018 (Dec) 13:45 0.00% 0.00% 0.00%
Oct 25, 2018 (Oct) 12:45 0.00% 0.00% 0.00%
Sep 13, 2018 (Sep) 12:45 0.00% 0.00% 0.00%
Jul 26, 2018 (Jul) 12:45 0.00% 0.00% 0.00%
Jun 14, 2018 (Jun) 12:45 0.00% 0.00% 0.00%
Apr 26, 2018 (Apr) 12:45 0.00% 0.00% 0.00%
Mar 08, 2018 (Mar) 13:45 0.00% 0.00% 0.00%
Jan 25, 2018 (Jan) 13:45 0.00% 0.00% 0.00%
Dec 14, 2017 (Dec) 13:45 0.00% 0.00% 0.00%
Oct 26, 2017 (Oct) 12:45 0.00% 0.00% 0.00%
Sep 07, 2017 (Sep) 12:45 0.00% 0.00% 0.00%
Jul 20, 2017 (Jul) 12:45 0.00% 0.00% 0.00%
Jun 08, 2017 (Jun) 12:45 0.00% 0.00% 0.00%
Apr 27, 2017 (Apr) 12:45 0.00% 0.00% 0.00%
Mar 09, 2017 (Mar) 13:45 0.00% 0.00% 0.00%
Jan 19, 2017 (Jan) 13:45 0.00% 0.00% 0.00%
Dec 08, 2016 (Dec) 13:45 0.00% 0.00% 0.00%
Oct 20, 2016 (Oct) 12:45 0.00% 0.00% 0.00%
Sep 08, 2016 (Sep) 12:45 0.00% 0.00% 0.00%
Jul 21, 2016 (Jul) 12:45 0.00% 0.00% 0.00%
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

const EVENT_ID = 164;
const CURRENCY = 'EUR';
const CENTRAL_BANK = 'European Central Bank (ECB)';
const COUNTRY = 'Eurozone';
const EVENT_NAME = 'Interest Rate Decision';
const SOURCE_URL = 'https://www.investing.com/economic-calendar/interest-rate-decision-164';

function computeBias(actual, forecast) {
  if (actual == null || forecast == null) return null;
  if (actual > forecast) return `Bullish ${CURRENCY}`;
  if (actual < forecast) return `Bearish ${CURRENCY}`;
  return `Neutral ${CURRENCY}`;
}

const rows = parseRows(PASTED);
console.log(`Parsed ${rows.length} EUR rows`);

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
   VALUES ($1,$2, now(), now(), 'PASTE_IMPORT_EUR', $3,$4,$5, null)`,
  [EVENT_ID, CURRENCY, rows.length, inserted, updated],
);

const count = await pool.query(`SELECT COUNT(*)::int AS count FROM central_bank_rate_history WHERE currency = 'EUR'`);
console.log(JSON.stringify({ ok: true, parsed: rows.length, inserted, updated, eurTotal: count.rows[0]?.count }, null, 2));

await pool.end();
