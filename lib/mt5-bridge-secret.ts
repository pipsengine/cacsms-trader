import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { queryPostgres } from '@/lib/postgres';

export const BRIDGE_SECRET_SETTING_KEY = 'shared_secret';
export const BRIDGE_SECRET_FILE = path.join(process.cwd(), 'data', 'mt5-bridge-secret');

export function generateMt5BridgeSecret(): string {
  return `mt5_${crypto.randomBytes(18).toString('hex')}`;
}

export function maskMt5BridgeSecret(secret: string): string {
  const normalized = secret.trim();
  if (!normalized) return '—';
  if (normalized.length <= 6) return '******';
  return `${'*'.repeat(Math.max(normalized.length - 4, 4))}${normalized.slice(-4)}`;
}

export async function readMt5BridgeSharedSecretFromDatabase(): Promise<string> {
  try {
    const result = await queryPostgres(
      `
        SELECT value
        FROM mt5_bridge_settings
        WHERE key = $1
        LIMIT 1
      `,
      [BRIDGE_SECRET_SETTING_KEY],
    );
    return String(result.rows[0]?.value ?? '').trim();
  } catch {
    return '';
  }
}

export async function writeMt5BridgeSecretRuntimeFile(secret: string): Promise<void> {
  const normalized = secret.trim();
  if (!normalized) return;
  await fs.mkdir(path.dirname(BRIDGE_SECRET_FILE), { recursive: true });
  await fs.writeFile(BRIDGE_SECRET_FILE, normalized, 'utf8');
}

export async function persistMt5BridgeSharedSecret(secret: string): Promise<void> {
  const normalized = secret.trim();
  if (normalized.length < 8) {
    throw new Error('Bridge secret must be at least 8 characters.');
  }

  await queryPostgres(
    `
      INSERT INTO mt5_bridge_settings (key, value, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
    `,
    [BRIDGE_SECRET_SETTING_KEY, normalized],
  );

  await writeMt5BridgeSecretRuntimeFile(normalized);
  process.env.MT5_BRIDGE_SHARED_SECRET = normalized;
}

export async function resolveMt5BridgeSharedSecret(): Promise<string> {
  const databaseSecret = await readMt5BridgeSharedSecretFromDatabase();
  if (databaseSecret) {
    if (process.env.MT5_BRIDGE_SHARED_SECRET !== databaseSecret) {
      process.env.MT5_BRIDGE_SHARED_SECRET = databaseSecret;
    }
    await writeMt5BridgeSecretRuntimeFile(databaseSecret).catch(() => null);
    return databaseSecret;
  }

  const envSecret = String(process.env.MT5_BRIDGE_SHARED_SECRET ?? '').trim();
  if (envSecret) {
    await writeMt5BridgeSecretRuntimeFile(envSecret).catch(() => null);
  }
  return envSecret;
}

export async function getMt5BridgeSecretStatus(): Promise<{
  secret: string;
  masked: string;
  source: 'database' | 'environment' | 'unset';
  configured: boolean;
  updatedAt: string | null;
}> {
  let updatedAt: string | null = null;
  let source: 'database' | 'environment' | 'unset' = 'unset';

  try {
    const result = await queryPostgres(
      `
        SELECT value, updated_at::text AS updated_at
        FROM mt5_bridge_settings
        WHERE key = $1
        LIMIT 1
      `,
      [BRIDGE_SECRET_SETTING_KEY],
    );
    const row = result.rows[0] as { value?: string; updated_at?: string } | undefined;
    const databaseSecret = String(row?.value ?? '').trim();
    if (databaseSecret) {
      source = 'database';
      updatedAt = row?.updated_at ?? null;
      await writeMt5BridgeSecretRuntimeFile(databaseSecret).catch(() => null);
      process.env.MT5_BRIDGE_SHARED_SECRET = databaseSecret;
      return {
        secret: databaseSecret,
        masked: maskMt5BridgeSecret(databaseSecret),
        source,
        configured: true,
        updatedAt,
      };
    }
  } catch {
    // fall through to environment secret
  }

  const envSecret = String(process.env.MT5_BRIDGE_SHARED_SECRET ?? '').trim();
  if (envSecret) {
    source = 'environment';
    await writeMt5BridgeSecretRuntimeFile(envSecret).catch(() => null);
    return {
      secret: envSecret,
      masked: maskMt5BridgeSecret(envSecret),
      source,
      configured: true,
      updatedAt: null,
    };
  }

  return {
    secret: '',
    masked: '—',
    source,
    configured: false,
    updatedAt: null,
  };
}
