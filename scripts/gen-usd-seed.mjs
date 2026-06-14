import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(resolve(__dirname, 'import-usd-rate-history.mjs'), 'utf8');
const m = text.match(/const PASTED = `([\s\S]*?)`;/);
if (!m) throw new Error('PASTED block not found');

const monthMap = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parseMdyDateToIso(value) {
  const raw = String(value ?? '').trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
  const mm = raw.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
  if (!mm) return null;
  const mon = monthMap[mm[1].toLowerCase()] ?? '';
  if (!mon) return null;
  return `${mm[3]}-${mon}-${String(Number(mm[2])).padStart(2, '0')}`;
}

function parseRateText(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '—' || raw.toLowerCase() === 'n/a') return null;
  const n = Number(raw.replaceAll('%', '').replaceAll(',', '').trim());
  return Number.isFinite(n) ? n : null;
}

function fmt(n) {
  return n == null ? 'null' : String(n);
}

const RATE = '(?:-?\\d+(?:\\.\\d+)?%)';
const ROW_RE = new RegExp(
  `([A-Za-z]{3}\\s+\\d{1,2},\\s+\\d{4}(?:\\s*\\([^)]+\\))?)\\s+(\\d{2}:\\d{2})\\s+(${RATE}|—|-|n\\/a)?\\s+(${RATE}|—|-|n\\/a)?\\s+(${RATE}|—|-|n\\/a)?`,
  'gi',
);

const normalized = m[1].replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n');
const rows = [];
for (const match of normalized.matchAll(ROW_RE)) {
  const releaseDate = parseMdyDateToIso(match[1] ?? '');
  const releaseTime = String(match[2] ?? '').trim();
  if (!releaseDate || !releaseTime) continue;
  rows.push({
    releaseDate,
    releaseTime,
    actualRate: parseRateText(match[3]),
    forecastRate: parseRateText(match[4]),
    previousRate: parseRateText(match[5]),
  });
}

const dedup = new Map();
for (const row of rows) dedup.set(`${row.releaseDate}|${row.releaseTime}`, row);
const list = Array.from(dedup.values());

const lines = list.map(
  (r) =>
    `  { releaseDate: '${r.releaseDate}', releaseTime: '${r.releaseTime}', actualRate: ${fmt(r.actualRate)}, forecastRate: ${fmt(r.forecastRate)}, previousRate: ${fmt(r.previousRate)} },`,
);

const out = `/** Full USD FOMC rate history from Investing.com event page 168 (Sep 2015 – Jun 2026). */\nexport const USD_RATE_HISTORY_SEED = [\n${lines.join('\n')}\n] as const;\n`;

writeFileSync(resolve(__dirname, '../lib/rates/usd-rate-history-seed-data.ts'), out);
console.log(`Wrote ${list.length} rows to lib/rates/usd-rate-history-seed-data.ts`);
