import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const secretFile = path.join(process.cwd(), 'data', 'mt5-bridge-secret');

async function main() {
  const envSecret = String(process.env.MT5_BRIDGE_SHARED_SECRET ?? '').trim();
  let secret = envSecret;

  const client = new Client({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'db_cacsms-trader',
    user: process.env.POSTGRES_USER ?? 'cacsms',
    password: process.env.POSTGRES_PASSWORD ?? '',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    const result = await client.query(
      `
        SELECT value
        FROM mt5_bridge_settings
        WHERE key = 'shared_secret'
        LIMIT 1
      `,
    );
    const databaseSecret = String(result.rows[0]?.value ?? '').trim();
    if (databaseSecret) {
      secret = databaseSecret;
    }
  } catch (error) {
    console.warn('[sync-bridge-secret] Database lookup skipped:', error instanceof Error ? error.message : error);
  } finally {
    await client.end().catch(() => null);
  }

  if (!secret) {
    console.log('[sync-bridge-secret] No bridge secret configured.');
    return;
  }

  await fs.mkdir(path.dirname(secretFile), { recursive: true });
  await fs.writeFile(secretFile, secret, 'utf8');
  process.env.MT5_BRIDGE_SHARED_SECRET = secret;
  console.log('[sync-bridge-secret] Bridge secret runtime file updated.');
}

main().catch((error) => {
  console.warn('[sync-bridge-secret] Non-fatal warning:', error instanceof Error ? error.message : error);
});
