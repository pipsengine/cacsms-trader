import { assertDevToolEnabled, assertLocalToolAccess } from '@/lib/local-access';

export function assertEconomicCalendarAccess(
  request: Request,
  message = 'Economic Calendar requires local machine access.',
): void {
  assertDevToolEnabled('CACSMS_ENABLE_ECONOMIC_CALENDAR_TOOL', 'Economic Calendar');
  assertLocalToolAccess(request, message);
}
