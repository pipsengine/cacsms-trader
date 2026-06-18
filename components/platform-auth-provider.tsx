'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { PlatformPermissionKey, PlatformPermissions, PlatformUserPublic } from '@/lib/platform-auth/types';

type PlatformAuthState = {
  loaded: boolean;
  authenticated: boolean;
  authEnabled: boolean;
  user: PlatformUserPublic | null;
  permissions: PlatformPermissions | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  hasPermission: (key: PlatformPermissionKey) => boolean;
};

const PlatformAuthContext = createContext<PlatformAuthState | null>(null);

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(true);
  const [user, setUser] = useState<PlatformUserPublic | null>(null);
  const [permissions, setPermissions] = useState<PlatformPermissions | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/platform-auth/me', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    setLoaded(true);
    setAuthenticated(Boolean(payload.authenticated));
    setAuthEnabled(payload.authEnabled !== false);
    setUser(payload.user ?? null);
    setPermissions(payload.permissions ?? null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await fetch('/api/platform-auth/logout', { method: 'POST' });
    await refresh();
  }, [refresh]);

  const hasPermission = useCallback(
    (key: PlatformPermissionKey) => Boolean(permissions?.[key]),
    [permissions],
  );

  const value = useMemo(
    () => ({ loaded, authenticated, authEnabled, user, permissions, refresh, signOut, hasPermission }),
    [loaded, authenticated, authEnabled, user, permissions, refresh, signOut, hasPermission],
  );

  return <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>;
}

export function usePlatformAuth(): PlatformAuthState {
  const context = useContext(PlatformAuthContext);
  if (!context) {
    throw new Error('usePlatformAuth must be used within PlatformAuthProvider');
  }
  return context;
}
