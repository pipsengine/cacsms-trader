import { openDatabase, detectRuntimeMode } from './db.mjs';

const { db, dbPath, mode } = openDatabase({ readonly: true });
console.log(`[db:health] mode=${mode}`);
console.log(`[db:health] database=${dbPath}`);

const fk = db.pragma('foreign_key_check');
const integrity = db.pragma('integrity_check');
const journal = db.pragma('journal_mode')[0]?.journal_mode;
const instruments = db.prepare('SELECT COUNT(*) AS c FROM instruments').get().c;
const migrations = db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c;
const currencies = db.prepare('SELECT code FROM currencies ORDER BY code').all().map((r) => r.code);

const report = {
  ok: integrity?.[0]?.integrity_check === 'ok' && fk.length === 0 && instruments === 29,
  integrity: integrity?.[0]?.integrity_check,
  foreignKeyViolations: fk.length,
  journalMode: journal,
  migrations,
  instruments,
  currencies,
  vercelNote:
    mode === 'VERCEL_READONLY'
      ? 'Repository SQLite is not trusted as persistent writable storage on Vercel.'
      : 'Local/central SQLite is READ+WRITE.',
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
db.close();
