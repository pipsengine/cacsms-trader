import fs from 'node:fs';
import { Pool } from 'pg';

const migrationPath = process.argv[2];

if (!migrationPath) {
  console.error('Usage: node scripts/apply-sql-migration.mjs <migration.sql>');
  process.exit(1);
}

function cleanEnvValue(value) {
  let output = value.trim();
  while (output.startsWith('"') || output.startsWith("'") || output.startsWith('\\')) output = output.slice(1);
  while (output.endsWith('"') || output.endsWith("'") || output.endsWith('\\')) output = output.slice(0, -1);
  return output;
}

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    process.env[match[1]] = cleanEnvValue(match[2]);
  }
}

loadEnvFile('.env.local');

const sql = fs.readFileSync(migrationPath, 'utf8');
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'db_cacsms-trader',
  user: process.env.POSTGRES_USER || 'cacsms',
  password: String(process.env.POSTGRES_PASSWORD || ''),
});

try {
  await pool.query(sql);
  console.log(`Applied ${migrationPath}`);
} finally {
  await pool.end();
}
