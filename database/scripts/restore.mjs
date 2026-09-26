import fs from 'node:fs';
import path from 'node:path';
import { resolveDatabasePath, assertWritable, detectRuntimeMode, PATHS } from './db.mjs';

const src = process.argv[2];
if (!src) {
  console.error('Usage: npm run db:restore -- <backup.db>');
  process.exit(1);
}

assertWritable();
const mode = detectRuntimeMode();
const abs = path.isAbsolute(src) ? src : path.resolve(process.cwd(), src);
if (!fs.existsSync(abs)) {
  console.error(`[db:restore] missing backup: ${abs}`);
  process.exit(1);
}

const dbPath = resolveDatabasePath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
fs.copyFileSync(abs, dbPath);
console.log(`[db:restore] mode=${mode}`);
console.log(`[db:restore] ${abs} -> ${dbPath}`);
console.log(`[db:restore] Tip: run npm run db:health after restore`);
