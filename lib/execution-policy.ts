import { isExecutionKillSwitchActive } from '@/lib/execution-kill-switch';

export type ExecutionCommandCategory = 'opening' | 'managing' | 'emergency' | 'chart' | 'unknown';

export type ExecutionPolicyInput = {
  commandType: string;
  environment?: string;
  sandboxMode?: boolean;
  requireDevToolAccess?: boolean;
};

export type ExecutionPolicyStatus = {
  executionEnabled: boolean;
  liveExecutionEnabled: boolean;
  killSwitchActive: boolean;
  killSwitchSource: string;
  killSwitchReason: string | null;
};

export class ExecutionPolicyBlockedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExecutionPolicyBlockedError';
    this.code = code;
  }
}

export function normalizeExecutionCommandType(type: string): string {
  return String(type ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_');
}

export function classifyExecutionCommandType(type: string): ExecutionCommandCategory {
  const normalized = normalizeExecutionCommandType(type);
  if (normalized === 'place_order' || normalized === 'placeorder' || normalized === 'test_hardcoded_order') {
    return 'opening';
  }
  if (
    normalized === 'modify_order' ||
    normalized === 'close_order' ||
    normalized === 'partial_close' ||
    normalized === 'move_to_breakeven' ||
    normalized === 'set_trailing_stop'
  ) {
    return 'managing';
  }
  if (normalized === 'emergency_close_all') {
    return 'emergency';
  }
  if (
    normalized === 'open_chart' ||
    normalized === 'set_timeframe' ||
    normalized === 'capture_chart' ||
    normalized === 'close_chart'
  ) {
    return 'chart';
  }
  return 'unknown';
}

function envBool(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

export function isExecutionEnabled(): boolean {
  return envBool('CACSMS_ENABLE_EXECUTION', false);
}

export function isLiveExecutionEnabled(): boolean {
  return envBool('CACSMS_ENABLE_LIVE_EXECUTION', false);
}

export async function getExecutionPolicyStatus(): Promise<ExecutionPolicyStatus> {
  const { getExecutionKillSwitchStatus } = await import('@/lib/execution-kill-switch');
  const killSwitch = await getExecutionKillSwitchStatus();
  return {
    executionEnabled: isExecutionEnabled(),
    liveExecutionEnabled: isLiveExecutionEnabled(),
    killSwitchActive: killSwitch.active,
    killSwitchSource: killSwitch.source,
    killSwitchReason: killSwitch.reason,
  };
}

export async function assertExecutionPolicy(input: ExecutionPolicyInput): Promise<void> {
  const category = classifyExecutionCommandType(input.commandType);
  const environment = String(input.environment ?? 'DEMO').toUpperCase();
  const sandboxMode = Boolean(input.sandboxMode ?? true);

  if (category === 'emergency') {
    return;
  }

  if (category === 'chart') {
    return;
  }

  if (!isExecutionEnabled() && category !== 'unknown') {
    throw new ExecutionPolicyBlockedError(
      'execution_disabled',
      'Execution is disabled. Set CACSMS_ENABLE_EXECUTION=true to allow trade commands.',
    );
  }

  if (category === 'opening') {
    if (await isExecutionKillSwitchActive()) {
      throw new ExecutionPolicyBlockedError(
        'kill_switch_active',
        'Execution kill switch is active. New orders are blocked until the switch is cleared.',
      );
    }

    if (environment !== 'DEMO' && !sandboxMode && !isLiveExecutionEnabled()) {
      throw new ExecutionPolicyBlockedError(
        'live_execution_disabled',
        'Live execution is disabled. Enable CACSMS_ENABLE_LIVE_EXECUTION=true or use sandbox mode.',
      );
    }
  }

  if (category === 'unknown') {
    throw new ExecutionPolicyBlockedError('unsupported_command_type', `Unsupported execution command type: ${input.commandType}`);
  }
}

export type CommandTimeoutPolicy = {
  ackTimeoutSec: number;
  executionTimeoutSec: number;
  totalTimeoutSec: number;
  maxAutoRetries: number;
  defaultTtlSec: number;
};

const DEFAULT_TIMEOUT_POLICY: CommandTimeoutPolicy = {
  ackTimeoutSec: 5,
  executionTimeoutSec: 15,
  totalTimeoutSec: 20,
  maxAutoRetries: 2,
  defaultTtlSec: 300,
};

const COMMAND_TIMEOUT_POLICIES: Record<string, CommandTimeoutPolicy> = {
  place_order: { ackTimeoutSec: 5, executionTimeoutSec: 15, totalTimeoutSec: 20, maxAutoRetries: 2, defaultTtlSec: 300 },
  modify_order: { ackTimeoutSec: 8, executionTimeoutSec: 20, totalTimeoutSec: 30, maxAutoRetries: 2, defaultTtlSec: 180 },
  close_order: { ackTimeoutSec: 8, executionTimeoutSec: 20, totalTimeoutSec: 30, maxAutoRetries: 3, defaultTtlSec: 180 },
  partial_close: { ackTimeoutSec: 8, executionTimeoutSec: 20, totalTimeoutSec: 30, maxAutoRetries: 2, defaultTtlSec: 180 },
  move_to_breakeven: { ackTimeoutSec: 8, executionTimeoutSec: 20, totalTimeoutSec: 30, maxAutoRetries: 2, defaultTtlSec: 180 },
  set_trailing_stop: { ackTimeoutSec: 8, executionTimeoutSec: 20, totalTimeoutSec: 30, maxAutoRetries: 2, defaultTtlSec: 180 },
  emergency_close_all: { ackTimeoutSec: 15, executionTimeoutSec: 45, totalTimeoutSec: 60, maxAutoRetries: 1, defaultTtlSec: 120 },
};

export function getCommandTimeoutPolicy(commandType: string): CommandTimeoutPolicy {
  const normalized = normalizeExecutionCommandType(commandType);
  return COMMAND_TIMEOUT_POLICIES[normalized] ?? DEFAULT_TIMEOUT_POLICY;
}

export function defaultCommandExpiresAt(commandType: string, from = new Date()): string {
  const policy = getCommandTimeoutPolicy(commandType);
  return new Date(from.getTime() + policy.defaultTtlSec * 1000).toISOString();
}

export function defaultMaxAttempts(commandType: string): number {
  return getCommandTimeoutPolicy(commandType).maxAutoRetries + 1;
}
