import { openDatabase, readSqlFiles, PATHS, detectRuntimeMode } from './db.mjs';

const { db, dbPath, mode } = openDatabase();
console.log(`[db:seed] mode=${mode}`);
console.log(`[db:seed] database=${dbPath}`);

const seeds = readSqlFiles(PATHS.seeds);
const seed = db.transaction(() => {
  for (const s of seeds) {
    db.exec(s.sql);
    console.log(`  seeded ${s.name}`);
  }
});
seed();

const instrumentCount = db.prepare('SELECT COUNT(*) AS c FROM instruments').get().c;
const currencyCount = db.prepare('SELECT COUNT(*) AS c FROM currencies').get().c;
if (instrumentCount !== 29) {
  console.error(`[db:seed] ERROR expected 29 instruments, found ${instrumentCount}`);
  process.exitCode = 1;
} else {
  console.log(`[db:seed] instruments=${instrumentCount} currencies=${currencyCount}`);
}

db.prepare(
  `INSERT INTO audit_logs(action, entity_type, entity_id, details_json, severity)
   VALUES ('SEED','database','cacsms-trader.db', ?, 'INFO')`,
).run(JSON.stringify({ instruments: instrumentCount, currencies: currencyCount }));

db.close();
