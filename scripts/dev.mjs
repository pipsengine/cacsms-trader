import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { startBridgeControlServer } from './bridge-control-server.mjs';

const root = new URL('../', import.meta.url);
const children = new Set();
let stopping = false;
/** @type {import('node:child_process').ChildProcess | null} */
let bridgeChild = null;

function start(command, args, label, { restart = false, trackBridge = false } = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, CACSMS_ENV: process.env.CACSMS_ENV || 'development' },
    stdio: 'inherit',
    shell: false,
  });

  if (trackBridge) bridgeChild = child;

  children.add(child);
  child.once('error', (error) => {
    console.error(`[dev] Failed to start ${label}: ${error.message}`);
    if (!restart) stop(1);
  });
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (trackBridge && bridgeChild === child) bridgeChild = null;
    if (stopping) return;
    if (restart) {
      console.error(`[dev] ${label} stopped (${signal ?? `exit ${code ?? 1}`}). Restarting in 3 seconds. The website stays open.`);
      setTimeout(() => {
        if (!stopping) start(command, args, label, { restart: true, trackBridge });
      }, 3000);
      return;
    }
    console.error(`[dev] ${label} stopped unexpectedly (${signal ?? `exit ${code ?? 1}`})`);
    stop(code ?? 1);
  });
  return child;
}

async function restartBridgeFromUi() {
  if (!bridgeChild) {
    const python = process.platform === 'win32' ? 'py.exe' : 'python3';
    start(python, ['-u', 'bridge/mt5/server.py'], 'MT5 bridge', { restart: true, trackBridge: true });
    return { message: 'Bridge was not running — started a new process' };
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
      resolve({ message: 'Bridge restart requested — dev will respawn it in a few seconds' });
    });
    try {
      child.kill('SIGTERM');
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 250).unref();
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

const python = process.platform === 'win32' ? 'py.exe' : 'python3';
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

console.log('[dev] Starting MT5 bridge and web app...');
console.log('[dev] The trading engine is the bridge. Leave this window open. Ctrl+C stops both.');
startBridgeControlServer({ onRestart: restartBridgeFromUi });
start(python, ['-u', 'bridge/mt5/server.py'], 'MT5 bridge', { restart: true, trackBridge: true });
start(process.execPath, [vite, ...process.argv.slice(2)], 'Vite');
