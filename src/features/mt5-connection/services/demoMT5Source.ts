import type { MT5ConnectionSource } from '../types/mt5.types';
import { createCacsmsMT5Source } from './cacsmsMT5Source';

/**
 * @deprecated Prefer createCacsmsMT5Source(). Kept as an alias so opt-in
 * useDemoFallback no longer injects seeded mock accounts/positions.
 */
export function createDemoMT5Source(): MT5ConnectionSource {
  return createCacsmsMT5Source();
}
