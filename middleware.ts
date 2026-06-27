import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  isPlatformAuthEnabledEdge,
  isPlatformPublicApiEdge,
  isPlatformPublicPageEdge,
  PLATFORM_SESSION_COOKIE,
} from '@/lib/platform-auth/route-policy-edge';

export function middleware(request: NextRequest) {
  if (!isPlatformAuthEnabledEdge()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/_next') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    if (isPlatformPublicApiEdge(pathname)) {
      return NextResponse.next();
    }
    const session = request.cookies.get(PLATFORM_SESSION_COOKIE);
    if (!session?.value) {
      return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (isPlatformPublicPageEdge(pathname)) {
    return NextResponse.next();
  }

  const session = request.cookies.get(PLATFORM_SESSION_COOKIE);
  if (!session?.value) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/platform-administration/login';
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
