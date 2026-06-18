import { NextResponse } from 'next/server';

import { resolvePermissions } from '@/lib/platform-auth/rbac';
import { getPlatformSessionUserFromRequest } from '@/lib/platform-auth/session';
import type { PlatformPermissionKey, PlatformUserPublic } from '@/lib/platform-auth/types';
import { isPlatformAuthEnabled } from '@/lib/platform-auth/constants';
import { bootstrapPlatformSuperAdmin } from '@/lib/platform-auth/bootstrap';

export type AuthContext = {
  user: PlatformUserPublic;
  permissions: ReturnType<typeof resolvePermissions>;
};

export async function requirePlatformAuth(
  request: Request,
  permission?: PlatformPermissionKey,
): Promise<AuthContext | Response> {
  await bootstrapPlatformSuperAdmin();

  if (!isPlatformAuthEnabled()) {
    return NextResponse.json({ ok: false, error: 'Platform authentication is disabled.' }, { status: 503 });
  }

  const user = await getPlatformSessionUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  }

  const permissions = resolvePermissions(user);
  if (permission && !permissions[permission]) {
    return NextResponse.json({ ok: false, error: 'Insufficient permissions.' }, { status: 403 });
  }

  return { user, permissions };
}

export function jsonOk<T extends Record<string, unknown>>(payload: T, status = 200): Response {
  return Response.json({ ok: true, ...payload }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ ok: false, error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function clientIp(request: Request): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? null;
}
