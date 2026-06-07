import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

function cleanEnvValue(value) {
  let output = value.trim();
  while (output.startsWith('"') || output.startsWith("'") || output.startsWith('\\')) output = output.slice(1);
  while (output.endsWith('"') || output.endsWith("'") || output.endsWith('\\')) output = output.slice(0, -1);
  return output;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined && process.env[key] !== '') continue;
    process.env[key] = cleanEnvValue(match[2]);
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const migrationsDir = path.resolve('database/migrations');
const files = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'db_cacsms-trader',
  user: process.env.POSTGRES_USER || 'cacsms',
  password: String(process.env.POSTGRES_PASSWORD || ''),
});

async function waitForPostgres(maxAttempts = 30) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function ensureMigrationTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations() {
  const result = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((row) => String(row.filename)));
}

try {
  await waitForPostgres();
  await ensureMigrationTable();
  const completed = await appliedMigrations();
  let appliedCount = 0;

  for (const file of files) {
    if (completed.has(file)) {
      continue;
    }

    const migrationPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrations] Applied ${file}`);
      appliedCount += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(`[migrations] ${appliedCount} new migration(s); ${files.length} total tracked.`);
} finally {
  await pool.end();
}
