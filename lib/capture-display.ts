export function isDisplayableCaptureUrl(url?: string | null): boolean {
  if (!url?.trim()) return false;
  if (url.startsWith('memory://')) return false;
  return url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:');
}

export function resolveCaptureDisplayUrl(input: {
  imageUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}): string | null {
  if (isDisplayableCaptureUrl(input.imageUrl)) return String(input.imageUrl);
  const metadata = input.metadata ?? {};
  for (const key of ['processedImageUrl', 'originalImageUrl'] as const) {
    const value = metadata[key];
    if (typeof value === 'string' && isDisplayableCaptureUrl(value)) return value;
  }
  return null;
}
