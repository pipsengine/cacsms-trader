type QueryParam = string | number | boolean | Date | null | Record<string, unknown> | QueryParam[];

type PostgresPool = {
  query: (text: string, params?: QueryParam[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

type PostgresGlobal = typeof globalThis & {
  __cacsmsPostgresPool?: PostgresPool;
};

const { Pool } = require('pg') as {
  Pool: new (config: Record<string, unknown>) => PostgresPool;
};

const globalForPostgres = globalThis as PostgresGlobal;

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function stringFromEnv(name: string): string | undefined {
  const value = (process.env as Record<string, unknown>)[name];
  if (value == null) return undefined;
  return String(value);
}

function sslFromEnv(): false | { rejectUnauthorized: false } {
  const value = String(process.env.POSTGRES_SSL ?? '').toLowerCase();
  if (value === 'true' || value === 'require') {
    return { rejectUnauthorized: false };
  }
  return false;
}

function poolConfig(): Record<string, unknown> {
  const max = numberFromEnv('POSTGRES_POOL_MAX', 10);
  const idleTimeoutMillis = numberFromEnv('POSTGRES_IDLE_TIMEOUT_MS', 30_000);
  const connectionTimeoutMillis = numberFromEnv('POSTGRES_CONNECTION_TIMEOUT_MS', 5_000);

  const password = stringFromEnv('POSTGRES_PASSWORD') ?? '';
  const databaseUrl = stringFromEnv('DATABASE_URL');

  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      password,
      max,
      idleTimeoutMillis,
      connectionTimeoutMillis,
      ssl: sslFromEnv(),
    };
  }

  return {
    host: stringFromEnv('POSTGRES_HOST') ?? 'localhost',
    port: numberFromEnv('POSTGRES_PORT', 5432),
    database: stringFromEnv('POSTGRES_DB') ?? 'db_cacsms-trader',
    user: stringFromEnv('POSTGRES_USER') ?? 'cacsms',
    password,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    ssl: sslFromEnv(),
  };
}

export function getPostgresPool(): PostgresPool {
  if (!globalForPostgres.__cacsmsPostgresPool) {
    globalForPostgres.__cacsmsPostgresPool = new Pool(poolConfig());
  }

  return globalForPostgres.__cacsmsPostgresPool;
}

export function queryPostgres(text: string, params?: QueryParam[]) {
  return getPostgresPool().query(text, params);
}

export async function checkPostgresConnection() {
  const startedAt = Date.now();
  const result = await queryPostgres(`
    SELECT
      current_database() AS database_name,
      current_user AS user_name,
      inet_server_addr()::text AS host,
      inet_server_port() AS port,
      version() AS version
  `);

  return {
    ...result.rows[0],
    latencyMs: Date.now() - startedAt,
  };
}
