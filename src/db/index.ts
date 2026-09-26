import { createFixtureDataAccess } from './fixtureAccess';
import { getDatabaseRuntimeMode, isDatabaseWritable, resolveDatabaseUrl, DATABASE_URL_DEFAULT } from './mode';
import type { DataAccessLayer } from './ports';

export type { DataAccessLayer, InstrumentRecord } from './ports';
export { getDatabaseRuntimeMode, isDatabaseWritable, resolveDatabaseUrl, DATABASE_URL_DEFAULT } from './mode';
export { createFixtureDataAccess } from './fixtureAccess';

let cached: DataAccessLayer | null = null;

/**
 * Central data-access entrypoint for application modules.
 * Browser builds always receive the fixture fallback (SQLite is Node-side).
 * Server/local Node processes should use `database/scripts/*` or a future server DAL
 * bound to better-sqlite3 — never scatter direct DB calls through UI modules.
 */
export function getDataAccess(): DataAccessLayer {
  if (!cached) cached = createFixtureDataAccess();
  return cached;
}

/** Explicitly inject a DAL (tests / future Node server). */
export function setDataAccess(dal: DataAccessLayer) {
  cached = dal;
}

export function getDatabaseStatus() {
  const mode = getDatabaseRuntimeMode();
  return {
    mode,
    writable: isDatabaseWritable(mode),
    databaseUrl: resolveDatabaseUrl(),
    guidance:
      mode === 'VERCEL_READONLY'
        ? 'Vercel serverless must not treat repository SQLite as persistent writable storage.'
        : 'Local/central SQLite supports READ+WRITE via database/scripts and future server adapters.',
  };
}
