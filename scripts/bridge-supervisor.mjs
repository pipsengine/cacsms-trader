import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { startBridgeControlServer } from './bridge-control-server.mjs';

const root = new URL('../', import.meta.url);
const python = process.platform === 'win32' ? 'py.exe' : 'python3';

let bridgeChild = null;
let stopping = false;

function spawnBridge() {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-u', 'bridge/mt5/server.py'], {
      cwd: root,
      env: { ...process.env, CACSMS_ENV: process.env.CACSMS_ENV || 'development' },
      stdio: 'inherit',
      shell: false,
    });
    bridgeChild = child;
    child.once('error', reject);
    child.once('spawn', () => resolve(child));
    child.once('exit', (code, signal) => {
      bridgeChild = null;
      if (stopping) return;
      console.error(`[bridge-supervisor] MT5 bridge stopped (${signal ?? `exit ${code ?? 1}`}). Restarting in 3 seconds.`);
      setTimeout(() => {
        if (!stopping) void spawnBridge();
      }, 3000);
    });
  });
}

async function restartBridge() {
  if (!bridgeChild) {
    await spawnBridge();
    return { message: 'Bridge process started' };
  }
  return new Promise((resolve, reject) => {
    const child = bridgeChild;
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      reject(new Error('Bridge did not stop in time'));
    }, 15_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve({ message: 'Bridge restart requested — process will respawn automatically' });
    });
    try {
      child.kill('SIGTERM');
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

function stop() {
  stopping = true;
  if (bridgeChild && !bridgeChild.killed) bridgeChild.kill('SIGTERM');
  setTimeout(() => process.exit(0), 300).unref();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

console.log('[bridge-supervisor] Starting MT5 bridge with local restart control…');
startBridgeControlServer({ onRestart: restartBridge });
void spawnBridge();
