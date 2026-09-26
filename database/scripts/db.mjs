import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(ROOT, '.env') });

/** @typedef {'LOCAL_WRITABLE' | 'VERCEL_READONLY' | 'CI_READONLY'} DbRuntimeMode */

export function detectRuntimeMode() {
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) return 'VERCEL_READONLY';
  if (process.env.CI === 'true' && process.env.DATABASE_WRITABLE !== '1') return 'CI_READONLY';
  return 'LOCAL_WRITABLE';
}

export function resolveDatabasePath() {
  const url = process.env.DATABASE_URL || 'file:./database/cacsms-trader.db';
  const file = url.startsWith('file:') ? url.slice('file:'.length) : url;
  return path.isAbsolute(file) ? file : path.resolve(ROOT, file);
}

export function assertWritable(mode = detectRuntimeMode()) {
  if (mode === 'VERCEL_READONLY') {
    throw new Error(
      'SQLite writes are disabled on Vercel serverless. The repository database file is not persistent writable storage. Use a central/local server or a managed database for production writes.',
    );
  }
}

export function openDatabase(options = {}) {
  const readonly = Boolean(options.readonly);
  const mode = detectRuntimeMode();
  const dbPath = resolveDatabasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const forceReadonly = readonly || mode === 'VERCEL_READONLY';
  if (!forceReadonly) assertWritable(mode);

  const db = new Database(dbPath, {
    readonly: forceReadonly,
    fileMustExist: forceReadonly && fs.existsSync(dbPath),
  });
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (!forceReadonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  return { db, dbPath, mode };
}

export function readSqlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      name: f,
      path: path.join(dir, f),
      sql: fs.readFileSync(path.join(dir, f), 'utf8'),
    }));
}

export const PATHS = {
  root: ROOT,
  migrations: path.join(ROOT, 'database', 'migrations'),
  seeds: path.join(ROOT, 'database', 'seeds'),
  backups: path.join(ROOT, 'database', 'backups'),
  schema: path.join(ROOT, 'database', 'schema'),
};
