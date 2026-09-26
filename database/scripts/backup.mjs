import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, PATHS, detectRuntimeMode } from './db.mjs';

const { db, dbPath, mode } = openDatabase({ readonly: true });
console.log(`[db:backup] mode=${mode}`);

fs.mkdirSync(PATHS.backups, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(PATHS.backups, `cacsms-trader-${stamp}.db`);

await db.backup(dest);
db.close();

const meta = {
  source: dbPath,
  backup: dest,
  createdAt: new Date().toISOString(),
  note: 'Runtime backups are local artifacts and should not be committed.',
};
fs.writeFileSync(`${dest}.json`, JSON.stringify(meta, null, 2));
console.log(`[db:backup] wrote ${dest}`);
