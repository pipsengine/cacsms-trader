'use client';

import { Suspense } from 'react';

import { PlatformLoginPage } from '@/components/platform-administration/platform-login-page';

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-600">Loading…</div>}>
      <PlatformLoginPage />
    </Suspense>
  );
}
