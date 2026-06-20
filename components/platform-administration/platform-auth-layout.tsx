'use client';

import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

export function PlatformAuthLayout(props: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-6 sm:px-8">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-700 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-950">{props.title}</h1>
            {props.subtitle ? <p className="text-sm text-slate-500">{props.subtitle}</p> : null}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-8">{props.children}</main>
    </div>
  );
}
