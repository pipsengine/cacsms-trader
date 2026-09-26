import { detectRuntimeMode } from './db.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = detectRuntimeMode();
const dir = path.dirname(fileURLToPath(import.meta.url));

if (mode === 'VERCEL_READONLY') {
  console.log('[db:postinstall] Vercel detected — skipping SQLite migrate/seed (no persistent writable store).');
  process.exit(0);
}

const run = (script) => {
  const r = spawnSync(process.execPath, [path.join(dir, script)], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('migrate.mjs');
run('seed.mjs');
console.log('[db:postinstall] local/central SQLite initialized');
