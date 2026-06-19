'use client';

import { useEffect, useState } from 'react';

/** Client-only clock — returns null until mounted to avoid React hydration text mismatches. */
export function useClientNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}

export function useClientDate(intervalMs = 1000): Date | null {
  const nowMs = useClientNow(intervalMs);
  return nowMs == null ? null : new Date(nowMs);
}
