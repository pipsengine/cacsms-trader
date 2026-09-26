import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, readSqlFiles, PATHS, detectRuntimeMode } from './db.mjs';

const { db, dbPath, mode } = openDatabase();
console.log(`[db:migrate] mode=${mode}`);
console.log(`[db:migrate] database=${dbPath}`);

db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
const migrations = readSqlFiles(PATHS.migrations);

const migrate = db.transaction(() => {
  let version = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;
  for (const m of migrations) {
    if (applied.has(m.name)) {
      console.log(`  skip ${m.name}`);
      continue;
    }
    version += 1;
    db.exec(m.sql);
    db.prepare('INSERT INTO schema_migrations(version, name) VALUES (?, ?)').run(version, m.name);
    console.log(`  apply ${m.name} -> v${version}`);
  }
});

migrate();

// Keep a schema snapshot for version control reference
fs.mkdirSync(PATHS.schema, { recursive: true });
const tables = db
  .prepare(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
  .all();
const snapshot = tables.map((t) => `-- ${t.name}\n${t.sql};\n`).join('\n');
fs.writeFileSync(path.join(PATHS.schema, 'current_schema.sql'), snapshot, 'utf8');

console.log(`[db:migrate] complete · tables=${tables.length}`);
db.close();
