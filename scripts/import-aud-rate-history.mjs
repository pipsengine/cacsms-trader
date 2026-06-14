/**
 * One-off import: AUD rate history from Investing.com event page 171.
 * Usage: node scripts/import-aud-rate-history.mjs
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
Jun 16, 2026 (Jun) 05:30 — 4.35% 4.35%
May 05, 2026 (May) 05:30 4.35% 4.35% 4.10%
Mar 17, 2026 (Mar) 04:30 4.10% 4.10% 3.85%
Feb 03, 2026 (Feb) 04:30 3.85% 3.85% 3.60%
Dec 09, 2025 (Dec) 04:30 3.60% 3.60% 3.60%
Nov 04, 2025 (Nov) 04:30 3.60% 3.60% 3.60%
Sep 30, 2025 (Oct) 05:30 3.60% 3.60% 3.60%
Aug 12, 2025 (Aug) 05:30 3.60% 3.60% 3.85%
Jul 08, 2025 (Jul) 05:30 3.85% 3.60% 3.85%
May 20, 2025 (May) 05:30 3.85% 3.85% 4.10%
Apr 01, 2025 (Apr) 04:30 4.10% 4.10% 4.10%
Feb 18, 2025 (Feb) 04:30 4.10% 4.10% 4.35%
Dec 10, 2024 (Dec) 04:30 4.35% 4.35% 4.35%
Nov 05, 2024 (Nov) 04:30 4.35% 4.35% 4.35%
Sep 24, 2024 (Sep) 05:30 4.35% 4.35% 4.35%
Aug 06, 2024 (Aug) 05:30 4.35% 4.35% 4.35%
Jun 18, 2024 (Jun) 05:30 4.35% 4.35% 4.35%
May 07, 2024 (May) 05:30 4.35% 4.35% 4.35%
Mar 19, 2024 (Mar) 04:30 4.35% 4.35% 4.35%
Feb 06, 2024 (Feb) 04:30 4.35% 4.35% 4.35%
Dec 05, 2023 (Dec) 04:30 4.35% 4.35% 4.35%
Nov 07, 2023 (Nov) 04:30 4.35% 4.35% 4.10%
Oct 03, 2023 (Oct) 04:30 4.10% 4.10% 4.10%
Sep 05, 2023 (Sep) 05:30 4.10% 4.10% 4.10%
Aug 01, 2023 (Aug) 05:30 4.10% 4.35% 4.10%
Jul 04, 2023 (Jul) 05:30 4.10% 4.35% 4.10%
Jun 06, 2023 (Jun) 05:30 4.10% 3.85% 3.85%
May 02, 2023 (May) 05:30 3.85% 3.60% 3.60%
Apr 04, 2023 (Apr) 05:30 3.60% 3.60% 3.60%
Mar 07, 2023 (Mar) 04:30 3.60% 3.60% 3.35%
Feb 07, 2023 (Feb) 04:30 3.35% 3.35% 3.10%
Dec 06, 2022 (Dec) 04:30 3.10% 3.10% 2.85%
Nov 01, 2022 (Nov) 04:30 2.85% 2.85% 2.60%
Oct 04, 2022 (Oct) 04:30 2.60% 2.85% 2.35%
Sep 06, 2022 (Sep) 05:30 2.35% 2.35% 1.85%
Aug 02, 2022 (Aug) 05:30 1.85% 1.85% 1.35%
Jul 05, 2022 (Jul) 05:30 1.35% 1.35% 0.85%
Jun 07, 2022 (Jun) 05:30 0.85% 0.60% 0.35%
May 03, 2022 (May) 05:30 0.35% 0.25% 0.10%
Apr 05, 2022 (Apr) 05:30 0.10% 0.10% 0.10%
Mar 01, 2022 (Mar) 04:30 0.10% 0.10% 0.10%
Feb 01, 2022 (Feb) 04:30 0.10% 0.10% 0.10%
Dec 07, 2021 (Dec) 04:30 0.10% 0.10% 0.10%
Nov 02, 2021 (Nov) 04:30 0.10% 0.10% 0.10%
Oct 05, 2021 (Oct) 04:30 0.10% 0.10% 0.10%
Sep 07, 2021 (Sep) 05:30 0.10% 0.10% 0.10%
Aug 03, 2021 (Aug) 05:30 0.10% 0.10% 0.10%
Jul 06, 2021 (Jul) 05:30 0.10% 0.10% 0.10%
Jun 01, 2021 (Jun) 05:30 0.10% 0.10% 0.10%
May 04, 2021 (May) 05:30 0.10% 0.10% 0.10%
Apr 06, 2021 (Apr) 05:30 0.10% 0.10% 0.10%
Mar 02, 2021 (Mar) 04:30 0.10% 0.10% 0.10%
Feb 02, 2021 (Jan) 04:30 0.10% 0.10% 0.10%
Dec 01, 2020 (Dec) 04:30 0.10% 0.10% 0.10%
Nov 03, 2020 (Nov) 04:30 0.10% 0.10% 0.25%
Oct 06, 2020 (Oct) 04:30 0.25% 0.25% 0.25%
Sep 01, 2020 (Sep) 05:30 0.25% 0.25% 0.25%
Aug 04, 2020 (Aug) 05:30 0.25% 0.25% 0.25%
Jul 07, 2020 (Jul) 05:30 0.25% 0.25% 0.25%
Jun 02, 2020 (Jun) 05:30 0.25% 0.25% 0.25%
May 05, 2020 (May) 05:30 0.25% 0.25% 0.25%
Apr 07, 2020 (Apr) 05:30 0.25% 0.25% 0.25%
Mar 19, 2020 (May) 04:30 0.25% — 0.50%
Mar 03, 2020 (Mar) 04:30 0.50% 0.75% 0.75%
Feb 04, 2020 (Feb) 04:30 0.75% 0.75% 0.75%
Dec 03, 2019 (Dec) 04:30 0.75% 0.75% 0.75%
Nov 05, 2019 (Nov) 04:30 0.75% 0.75% 0.75%
Oct 01, 2019 (Oct) 05:30 0.75% 0.75% 1.00%
Sep 03, 2019 (Sep) 05:30 1.00% 1.00% 1.00%
Aug 06, 2019 (Aug) 05:30 1.00% 1.00% 1.00%
Jul 02, 2019 (Jul) 05:30 1.00% 1.00% 1.25%
Jun 04, 2019 (Jun) 05:30 1.25% 1.25% 1.50%
May 07, 2019 (May) 05:30 1.50% 1.50% 1.50%
Apr 02, 2019 (Apr) 04:30 1.50% 1.50% 1.50%
Mar 05, 2019 (Mar) 04:30 1.50% 1.50% 1.50%
Feb 05, 2019 (Feb) 04:30 1.50% 1.50% 1.50%
Dec 04, 2018 (Dec) 04:30 1.50% 1.50% 1.50%
Nov 06, 2018 (Nov) 04:30 1.50% 1.50% 1.50%
Oct 02, 2018 (Oct) 05:30 1.50% 1.50% 1.50%
Sep 04, 2018 (Sep) 05:30 1.50% 1.50% 1.50%
Aug 07, 2018 (Aug) 05:30 1.50% 1.50% 1.50%
Jul 03, 2018 (Jul) 05:30 1.50% 1.50% 1.50%
Jun 05, 2018 (Jun) 05:30 1.50% 1.50% 1.50%
May 01, 2018 (May) 05:30 1.50% 1.50% 1.50%
Apr 03, 2018 (Apr) 05:30 1.50% 1.50% 1.50%
Mar 06, 2018 (Mar) 04:30 1.50% 1.50% 1.50%
Feb 06, 2018 (Feb) 04:30 1.50% 1.50% 1.50%
Dec 05, 2017 (Dec) 04:30 1.50% 1.50% 1.50%
Nov 07, 2017 (Nov) 04:30 1.50% 1.50% 1.50%
Oct 03, 2017 (Oct) 04:30 1.50% 1.50% 1.50%
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

const EVENT_ID = 171;
const CURRENCY = 'AUD';
const CENTRAL_BANK = 'Reserve Bank of Australia (RBA)';
const COUNTRY = 'Australia';
const EVENT_NAME = 'Interest Rate Decision';
const SOURCE_URL = 'https://www.investing.com/economic-calendar/interest-rate-decision-171';

function computeBias(actual, forecast) {
  if (actual == null || forecast == null) return null;
  if (actual > forecast) return `Bullish ${CURRENCY}`;
  if (actual < forecast) return `Bearish ${CURRENCY}`;
  return `Neutral ${CURRENCY}`;
}

const rows = parseRows(PASTED);
console.log(`Parsed ${rows.length} AUD rows`);

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
   VALUES ($1,$2, now(), now(), 'PASTE_IMPORT_AUD', $3,$4,$5, null)`,
  [EVENT_ID, CURRENCY, rows.length, inserted, updated],
);

const count = await pool.query(`SELECT COUNT(*)::int AS count FROM central_bank_rate_history WHERE currency = 'AUD'`);
console.log(JSON.stringify({ ok: true, parsed: rows.length, inserted, updated, audTotal: count.rows[0]?.count }, null, 2));

await pool.end();
