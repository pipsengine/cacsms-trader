import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const run = (script) => {
  const r = spawnSync(process.execPath, [path.join(dir, script)], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('migrate.mjs');
run('seed.mjs');
run('health.mjs');
run('test-crud.mjs');
console.log('[db:init] database ready');
