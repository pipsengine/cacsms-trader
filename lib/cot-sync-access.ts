import { assertDevToolEnabled, assertLocalToolAccess } from '@/lib/local-access';

export function assertCotSyncAccess(request: Request): void {
  assertDevToolEnabled('CACSMS_ENABLE_COT_TOOL', 'COT sync');
  assertLocalToolAccess(request, 'COT actions require local machine access.');
}
