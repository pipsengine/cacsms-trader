import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const normalized = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = '';
  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function generateTotpCode(secret: string, counter = Math.floor(Date.now() / 1000 / 30)): string {
  return hotp(secret, counter);
}

export function verifyTotpCode(secret: string, token: string, window = 1): boolean {
  const normalized = String(token ?? '').replace(/\s/g, '');
  if (!/^\d{6,8}$/.test(normalized)) return false;

  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(secret, counter + offset);
    try {
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalized.padStart(6, '0').slice(-6)))) {
        return true;
      }
    } catch {
      if (expected === normalized.slice(-6)) return true;
    }
  }
  return false;
}

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = createHmac('sha256', `${Date.now()}-${i}-${Math.random()}`).digest('hex');
    codes.push(raw.slice(0, 8).toUpperCase());
  }
  return codes;
}
