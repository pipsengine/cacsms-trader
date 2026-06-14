/**
 * One-off import: CAD rate history from Investing.com event page 166.
 * Usage: node scripts/import-cad-rate-history.mjs
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
Jul 15, 2026 14:45 — — 2.25%
Jun 10, 2026 14:45 2.25% 2.25% 2.25%
Apr 29, 2026 14:45 2.25% 2.25% 2.25%
Mar 18, 2026 14:45 2.25% 2.25% 2.25%
Jan 28, 2026 15:45 2.25% 2.25% 2.25%
Dec 10, 2025 15:45 2.25% 2.25% 2.25%
Oct 29, 2025 14:45 2.25% 2.25% 2.50%
Sep 17, 2025 14:45 2.50% 2.50% 2.75%
Jul 30, 2025 14:45 2.75% 2.75% 2.75%
Jun 04, 2025 14:45 2.75% 2.75% 2.75%
Apr 16, 2025 14:45 2.75% 2.75% 2.75%
Mar 12, 2025 14:45 2.75% 2.75% 3.00%
Jan 29, 2025 15:45 3.00% 3.00% 3.25%
Dec 11, 2024 15:45 3.25% 3.25% 3.75%
Oct 23, 2024 14:45 3.75% 3.75% 4.25%
Sep 04, 2024 14:45 4.25% 4.25% 4.50%
Jul 24, 2024 14:45 4.50% 4.50% 4.75%
Jun 05, 2024 14:45 4.75% 4.75% 5.00%
Apr 10, 2024 14:45 5.00% 5.00% 5.00%
Mar 06, 2024 15:45 5.00% 5.00% 5.00%
Jan 24, 2024 15:45 5.00% 5.00% 5.00%
Dec 06, 2023 16:00 5.00% 5.00% 5.00%
Oct 25, 2023 15:00 5.00% 5.00% 5.00%
Sep 06, 2023 15:00 5.00% 5.00% 5.00%
Jul 12, 2023 15:00 5.00% 5.00% 4.75%
Jun 07, 2023 15:00 4.75% 4.50% 4.50%
Apr 12, 2023 15:00 4.50% 4.50% 4.50%
Mar 08, 2023 16:00 4.50% 4.50% 4.50%
Jan 25, 2023 16:00 4.50% 4.50% 4.25%
Dec 07, 2022 16:00 4.25% 4.25% 3.75%
Oct 26, 2022 15:00 3.75% 4.00% 3.25%
Sep 07, 2022 15:00 3.25% 3.25% 2.50%
Jul 13, 2022 15:00 2.50% 2.25% 1.50%
Jun 01, 2022 15:00 1.50% 1.50% 1.00%
Apr 13, 2022 15:00 1.00% 1.00% 0.50%
Mar 02, 2022 16:00 0.50% 0.50% 0.25%
Jan 26, 2022 16:00 0.25% 0.25% 0.25%
Dec 08, 2021 16:00 0.25% 0.25% 0.25%
Oct 27, 2021 15:00 0.25% 0.25% 0.25%
Sep 08, 2021 15:00 0.25% 0.25% 0.25%
Jul 14, 2021 15:00 0.25% 0.25% 0.25%
Jun 09, 2021 15:00 0.25% 0.25% 0.25%
Apr 21, 2021 15:00 0.25% 0.25% 0.25%
Mar 10, 2021 16:00 0.25% 0.25% 0.25%
Jan 20, 2021 16:00 0.25% 0.25% 0.25%
Dec 09, 2020 16:00 0.25% 0.25% 0.25%
Oct 28, 2020 15:00 0.25% 0.25% 0.25%
Sep 09, 2020 15:00 0.25% 0.25% 0.25%
Jul 15, 2020 15:00 0.25% 0.25% 0.25%
Jun 03, 2020 15:00 0.25% 0.25% 0.25%
Apr 15, 2020 15:00 0.25% 0.25% 0.25%
Mar 27, 2020 14:00 0.25% — 0.75%
Mar 13, 2020 16:00 0.75% 1.75% 1.25%
Mar 04, 2020 16:00 1.25% 1.75% 1.75%
Jan 22, 2020 16:00 1.75% 1.75% 1.75%
Dec 04, 2019 16:00 1.75% 1.75% 1.75%
Oct 30, 2019 15:00 1.75% 1.75% 1.75%
Sep 04, 2019 15:00 1.75% 1.75% 1.75%
Jul 10, 2019 15:00 1.75% 1.75% 1.75%
May 29, 2019 15:00 1.75% 1.75% 1.75%
Apr 24, 2019 15:00 1.75% 1.75% 1.75%
Mar 06, 2019 16:00 1.75% 1.75% 1.75%
Jan 09, 2019 16:00 1.75% 1.75% 1.75%
Dec 05, 2018 16:00 1.75% 1.75% 1.75%
Oct 24, 2018 15:00 1.75% 1.75% 1.50%
Sep 05, 2018 15:00 1.50% 1.50% 1.50%
Jul 11, 2018 15:00 1.50% 1.50% 1.25%
May 30, 2018 15:00 1.25% 1.25% 1.25%
Apr 18, 2018 15:00 1.25% 1.25% 1.25%
Mar 07, 2018 16:00 1.25% 1.25% 1.25%
Jan 17, 2018 16:00 1.25% 1.25% 1.00%
Dec 06, 2017 16:00 1.00% 1.00% 1.00%
Oct 25, 2017 15:00 1.00% 1.00% 1.00%
Sep 06, 2017 15:00 1.00% 0.75% 0.75%
Jul 12, 2017 15:00 0.75% 0.75% 0.50%
May 24, 2017 15:00 0.50% 0.50% 0.50%
Apr 12, 2017 15:00 0.50% 0.50% 0.50%
Mar 01, 2017 16:00 0.50% 0.50% 0.50%
Jan 18, 2017 16:00 0.50% 0.50% 0.50%
Dec 07, 2016 16:00 0.50% 0.50% 0.50%
Oct 19, 2016 15:00 0.50% 0.50% 0.50%
Sep 07, 2016 15:00 0.50% 0.50% 0.50%
Jul 13, 2016 15:00 0.50% 0.50% 0.50%
May 25, 2016 15:00 0.50% 0.50% 0.50%
Apr 13, 2016 15:00 0.50% 0.50% 0.50%
Mar 09, 2016 16:00 0.50% 0.50% 0.50%
Jan 20, 2016 16:00 0.50% 0.50% 0.50%
Dec 02, 2015 16:00 0.50% 0.50% 0.50%
Oct 21, 2015 15:00 0.50% 0.50% 0.50%
Sep 09, 2015 15:00 0.50% 0.50% 0.50%
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

const EVENT_ID = 166;
const CURRENCY = 'CAD';
const CENTRAL_BANK = 'Bank of Canada (BoC)';
const COUNTRY = 'Canada';
const EVENT_NAME = 'Interest Rate Decision';
const SOURCE_URL = 'https://www.investing.com/economic-calendar/interest-rate-decision-166';

function computeBias(actual, forecast) {
  if (actual == null || forecast == null) return null;
  if (actual > forecast) return `Bullish ${CURRENCY}`;
  if (actual < forecast) return `Bearish ${CURRENCY}`;
  return `Neutral ${CURRENCY}`;
}

const rows = parseRows(PASTED);
console.log(`Parsed ${rows.length} CAD rows`);

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
   VALUES ($1,$2, now(), now(), 'PASTE_IMPORT_CAD', $3,$4,$5, null)`,
  [EVENT_ID, CURRENCY, rows.length, inserted, updated],
);

const count = await pool.query(`SELECT COUNT(*)::int AS count FROM central_bank_rate_history WHERE currency = 'CAD'`);
console.log(JSON.stringify({ ok: true, parsed: rows.length, inserted, updated, cadTotal: count.rows[0]?.count }, null, 2));

await pool.end();
