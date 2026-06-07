import { spawn } from 'node:child_process';
import http from 'node:http';

const bridgePort = Number(process.env.MT5_BRIDGE_PORT ?? 8787);
const appPort = Number(process.env.PORT ?? 3000);
const children = [];

async function main() {
  console.log('[docker-start] Waiting for PostgreSQL and applying migrations...');
  await runNodeScript('scripts/apply-all-migrations.mjs');

  console.log(`[docker-start] Starting MT5 bridge on port ${bridgePort}...`);
  const bridge = startProcess('mt5-bridge', process.execPath, ['mt5/bridge/server.mjs'], {
    MT5_BRIDGE_PORT: String(bridgePort),
  });
  children.push(bridge);

  await waitForHttp(`http://127.0.0.1:${bridgePort}/health`, 30);
  console.log('[docker-start] MT5 bridge is healthy.');

  console.log(`[docker-start] Starting Next.js on port ${appPort}...`);
  const app = startProcess('next', process.execPath, ['server.js'], {
    PORT: String(appPort),
    HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0',
  });
  children.push(app);

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function startProcess(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => writePrefixed(name, chunk));
  child.stderr.on('data', (chunk) => writePrefixed(name, chunk));
  child.on('exit', (code, signal) => {
    if (code === 0 || signal) return;
    console.error(`[docker-start] ${name} exited with code ${code}`);
    shutdown(code ?? 1);
  });

  return child;
}

function writePrefixed(name, chunk) {
  for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
    console.log(`[${name}] ${line}`);
  }
}

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

function waitForHttp(url, maxAttempts) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryOnce = () => {
      attempt += 1;
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      request.on('error', retry);
      request.setTimeout(2000, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (attempt >= maxAttempts) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(tryOnce, 1000);
    };

    tryOnce();
  });
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

main().catch((error) => {
  console.error('[docker-start] Failed to start:', error);
  shutdown(1);
});
