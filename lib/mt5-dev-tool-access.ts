import { assertDevToolEnabled, assertLocalToolAccess } from '@/lib/local-access';

export function assertExecutionBridgeToolAccess(request: Request): void {
  assertDevToolEnabled('CACSMS_ENABLE_EXECUTION_BRIDGE_TOOL', 'Execution Bridge tool');
  assertLocalToolAccess(request, 'Execution Bridge tool requires local machine access.');
}

export function assertExecutionAuditToolAccess(request: Request): void {
  assertDevToolEnabled('CACSMS_ENABLE_EXECUTION_AUDIT_TOOL', 'Execution Audit Journal tool');
  assertLocalToolAccess(request, 'Execution Audit Journal requires local machine access.');
}

export function assertEaCommunicationToolAccess(request: Request): void {
  assertDevToolEnabled('CACSMS_ENABLE_EA_COMM_TOOL', 'EA Communication Engine tool');
  assertLocalToolAccess(request, 'EA Communication Engine requires local machine access.');
}
