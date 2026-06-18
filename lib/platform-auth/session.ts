import { cookies } from 'next/headers';

import { PLATFORM_SESSION_COOKIE, PLATFORM_SESSION_TTL_HOURS } from '@/lib/platform-auth/constants';
import { generateToken, hashToken } from '@/lib/platform-auth/password';
import {
  createSession,
  deleteSession,
  getSessionUserId,
  getUserById,
  touchUserLogin,
} from '@/lib/platform-auth/store';
import type { PlatformUserPublic } from '@/lib/platform-auth/types';

export async function createPlatformSession(
  userId: string,
  meta?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<string> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + PLATFORM_SESSION_TTL_HOURS * 60 * 60 * 1000);

  await createSession({
    userId,
    tokenHash,
    expiresAt,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
  });
  await touchUserLogin(userId);

  const cookieStore = await cookies();
  cookieStore.set(PLATFORM_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  return token;
}

export async function clearPlatformSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value;
  if (token) {
    await deleteSession(hashToken(token));
  }
  cookieStore.set(PLATFORM_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export async function getPlatformSessionUser(): Promise<PlatformUserPublic | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value;
  if (!token) return null;

  const userId = await getSessionUserId(hashToken(token));
  if (!userId) return null;

  const user = await getUserById(userId);
  if (!user || user.status !== 'active') return null;
  return user;
}

export function readSessionTokenFromRequest(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  const match = header.match(new RegExp(`${PLATFORM_SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export async function getPlatformSessionUserFromRequest(request: Request): Promise<PlatformUserPublic | null> {
  const token = readSessionTokenFromRequest(request);
  if (!token) return null;
  const userId = await getSessionUserId(hashToken(token));
  if (!userId) return null;
  const user = await getUserById(userId);
  if (!user || user.status !== 'active') return null;
  return user;
}
