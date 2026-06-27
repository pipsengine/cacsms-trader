type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function bucketKey(scope: string, identifier: string): string {
  return `${scope}:${identifier}`;
}

export function checkRateLimit(input: {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
}): { allowed: boolean; retryAfterMs: number } {
  const key = bucketKey(input.scope, input.identifier);
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + input.windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count >= input.limit) {
    return { allowed: false, retryAfterMs: Math.max(0, existing.resetAt - now) };
  }

  existing.count += 1;
  buckets.set(key, existing);
  return { allowed: true, retryAfterMs: 0 };
}

export function rateLimitResponse(retryAfterMs: number): Response {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    { ok: false, error: `Too many attempts. Retry in ${retryAfterSec}s.` },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfterSec),
      },
    },
  );
}
