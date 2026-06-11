import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const bridgePort = Number(process.env.MT5_BRIDGE_PORT ?? 8787);
const appPort = Number(process.env.PORT ?? 3000);
const children = [];

async function main() {
  console.log('[docker-start] Waiting for PostgreSQL and applying migrations...');
  await runNodeScript('scripts/apply-all-migrations.mjs');
  try {
    await runNodeScript('scripts/sync-bridge-secret.mjs');
  } catch (error) {
    console.warn('[docker-start] Bridge secret sync skipped:', error instanceof Error ? error.message : error);
  }
  hydrateBridgeSecretFromRuntimeFile();

  console.log(`[docker-start] Starting MT5 bridge on port ${bridgePort}...`);
  const bridge = startProcess('mt5-bridge', process.execPath, ['mt5/bridge/server.mjs'], {
    MT5_BRIDGE_PORT: String(bridgePort),
    MT5_BRIDGE_SHARED_SECRET: process.env.MT5_BRIDGE_SHARED_SECRET ?? '',
  });
  children.push(bridge);

  await waitForHttp(`http://127.0.0.1:${bridgePort}/health`, 30);
  console.log('[docker-start] MT5 bridge is healthy.');

  console.log(`[docker-start] Starting Next.js on port ${appPort}...`);
  const app = startProcess('next', process.execPath, ['server.js'], {
    PORT: String(appPort),
    HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0',
    MT5_BRIDGE_SHARED_SECRET: process.env.MT5_BRIDGE_SHARED_SECRET ?? '',
  });
  children.push(app);

  startChartCaptureCleanupScheduler(appPort);

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

function chartCaptureCleanupIntervalMs() {
  const minutes = Number(process.env.CACSMS_CAPTURE_CLEANUP_INTERVAL_MINUTES ?? 60);
  const safeMinutes = Number.isFinite(minutes) && minutes >= 15 ? minutes : 60;
  return safeMinutes * 60_000;
}

function startChartCaptureCleanupScheduler(appPort) {
  const triggerCleanup = async (force = false) => {
    const suffix = force ? '?force=true' : '';
    const url = `http://127.0.0.1:${appPort}/api/system/chart-capture-cleanup${suffix}`;
    try {
      await waitForHttp(`http://127.0.0.1:${appPort}`, 60);
      const response = await fetch(url, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      console.log(`[capture-cleanup] ${response.status} ${JSON.stringify(body)}`);
    } catch (error) {
      console.warn('[capture-cleanup] skipped:', error instanceof Error ? error.message : error);
    }
  };

  setTimeout(() => {
    void triggerCleanup(true);
  }, 45_000);
  setInterval(() => {
    void triggerCleanup(false);
  }, chartCaptureCleanupIntervalMs());
}

function hydrateBridgeSecretFromRuntimeFile() {
  const secretFile = path.join(process.cwd(), 'data', 'mt5-bridge-secret');
  try {
    const secret = fs.readFileSync(secretFile, 'utf8').trim();
    if (secret) {
      process.env.MT5_BRIDGE_SHARED_SECRET = secret;
      console.log('[docker-start] Bridge secret loaded from runtime file.');
    }
  } catch {
    // runtime secret file not present yet; keep env default
  }
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
