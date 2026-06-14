/**
 * Sync all 8 central-bank rate pages via the local app API.
 * Usage: node scripts/sync-central-bank-rates.mjs [latest|full|USD|EUR|...]
 */
const baseUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const arg = String(process.argv[2] ?? 'latest').trim();

const currencyPages = {
  USD: 168,
  EUR: 164,
  GBP: 170,
  JPY: 165,
  CAD: 166,
  AUD: 171,
  NZD: 167,
  CHF: 169,
};

let body;
if (arg.toLowerCase() === 'latest') body = { mode: 'latest' };
else if (arg.toLowerCase() === 'full') body = { mode: 'full' };
else if (currencyPages[arg.toUpperCase()]) body = { currency: arg.toUpperCase(), mode: 'latest' };
else throw new Error(`Unknown arg "${arg}". Use latest, full, or a currency code.`);

const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/rates/sync`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const payload = await res.json().catch(() => ({}));
console.log(JSON.stringify({ httpStatus: res.status, ...payload }, null, 2));
if (!payload.ok) process.exitCode = 1;
