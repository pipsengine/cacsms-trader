/**
 * Portable database mode detection for Cacsms Trader.
 * Browser-safe: no native SQLite imports.
 *
 * LOCAL / CENTRAL SERVER  → SQLite READ + WRITE
 * VERCEL SERVERLESS       → repository SQLite is NOT persistent writable storage
 */
export type DatabaseRuntimeMode = 'LOCAL_WRITABLE' | 'VERCEL_READONLY' | 'UNKNOWN';

type EnvMap = Record<string, string | undefined>;

function readEnv(): EnvMap {
  try {
    const g = globalThis as { process?: { env?: EnvMap } };
    return g.process?.env ?? {};
  } catch {
    return {};
  }
}

export function getDatabaseRuntimeMode(env: EnvMap = readEnv()): DatabaseRuntimeMode {
  if (env.VERCEL === '1' || env.VERCEL_ENV) return 'VERCEL_READONLY';
  if (env.DATABASE_URL || env.NODE_ENV === 'development') return 'LOCAL_WRITABLE';
  return 'UNKNOWN';
}

export function isDatabaseWritable(mode = getDatabaseRuntimeMode()) {
  return mode === 'LOCAL_WRITABLE';
}

export const DATABASE_URL_DEFAULT = 'file:./database/cacsms-trader.db';

export function resolveDatabaseUrl(env: EnvMap = readEnv()) {
  return env.DATABASE_URL || DATABASE_URL_DEFAULT;
}
