import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function deriveKey(secret: string, userId: string): Buffer {
  return createHash('sha256').update(`${secret}:${userId}:mt5`).digest();
}

function authSecret(): string {
  const secret = process.env.PLATFORM_AUTH_SECRET ?? process.env.AUTH_SECRET ?? '';
  if (!secret) {
    throw new Error('PLATFORM_AUTH_SECRET or AUTH_SECRET must be set for MT5 credential encryption.');
  }
  return secret;
}

export function encryptSecret(plaintext: string, userId: string): string {
  if (!plaintext) return '';
  const key = deriveKey(authSecret(), userId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string, userId: string): string {
  if (!payload) return '';
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted credential format.');
  }
  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const encrypted = Buffer.from(parts[3], 'hex');
  const key = deriveKey(authSecret(), userId);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
