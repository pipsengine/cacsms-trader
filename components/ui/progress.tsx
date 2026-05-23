"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type ProgressProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  value?: number | null;
  max?: number;
};

function Progress({ className, value, max = 100, ...props }: ProgressProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const rawValue = value == null ? 0 : Number(value);
  const safeValue = Number.isFinite(rawValue) ? Math.min(Math.max(rawValue, 0), safeMax) : 0;
  const pct = (safeValue / safeMax) * 100;

  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={safeValue}
      className={cn("relative w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full w-full bg-primary transition-transform"
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </div>
  );
}

export { Progress };
