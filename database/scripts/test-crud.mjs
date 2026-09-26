import { openDatabase } from './db.mjs';

const { db } = openDatabase();

const tx = db.transaction(() => {
  const before = db.prepare('SELECT COUNT(*) AS c FROM instruments').get().c;
  db.prepare(
    `INSERT INTO system_events(category, event_type, message, payload_json, severity)
     VALUES ('DATABASE','CRUD_TEST','transactional CRUD smoke test', ?, 'INFO')`,
  ).run(JSON.stringify({ before }));

  const row = db
    .prepare(`SELECT id, message FROM system_events WHERE event_type='CRUD_TEST' ORDER BY id DESC LIMIT 1`)
    .get();
  if (!row) throw new Error('insert failed');

  db.prepare(`UPDATE system_events SET message = ? WHERE id = ?`).run('transactional CRUD smoke test · ok', row.id);
  const updated = db.prepare(`SELECT message FROM system_events WHERE id = ?`).get(row.id);
  if (!updated.message.includes('ok')) throw new Error('update failed');

  // Keep the audit trail; do not delete seed instruments.
  const after = db.prepare('SELECT COUNT(*) AS c FROM instruments').get().c;
  if (after !== 29) throw new Error(`instrument count drifted: ${after}`);
});

tx();
console.log('[db:test] CRUD + transaction + FK instrument count OK (29)');
db.close();
