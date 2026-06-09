import type { ExecutionEnvironment } from '@/lib/execution-bridge-store';
import { isLiveExecutionEnabled } from '@/lib/execution-policy';
import { listTerminalSnapshots } from '@/lib/mt5-heartbeat-store';
import { queryPostgres } from '@/lib/postgres';

export type TradingAccountClass = 'demo' | 'prop_firm' | 'live' | 'large_equity';

export interface ExecutionAccountContext {
  terminalId: string;
  accountNumber: string;
  accountClass: TradingAccountClass;
  environment: ExecutionEnvironment;
  sandboxMode: boolean;
  equity: number;
  balance: number;
  currency: string;
  enableExecution: boolean;
  liveExecutionAllowed: boolean;
  accountTradeAllowed: boolean;
}

function envBool(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeTradingAccountClass(value: unknown): 'demo' | 'prop_firm' | 'live' | 'unknown' {
  const raw = String(value ?? '').trim().toLowerCase().replaceAll('-', '_');
  if (raw === 'demo' || raw === 'contest') return 'demo';
  if (raw === 'live' || raw === 'real') return 'live';
  if (raw === 'prop' || raw === 'prop_firm' || raw === 'propfirm') return 'prop_firm';
  return 'unknown';
}

function largeEquityThreshold(): number {
  return envNumber('CACSMS_LARGE_EQUITY_THRESHOLD', 100_000);
}

function classifyAccount(base: 'demo' | 'prop_firm' | 'live' | 'unknown', equity: number): TradingAccountClass {
  if (base === 'unknown') {
    const assumedDemo = String(process.env.NEXT_PUBLIC_TRADING_MODE ?? '').trim().toLowerCase() === 'demo';
    return assumedDemo ? 'demo' : 'live';
  }
  if (equity >= largeEquityThreshold() && base !== 'demo') {
    return 'large_equity';
  }
  return base;
}

function environmentForClass(accountClass: TradingAccountClass): ExecutionEnvironment {
  if (accountClass === 'demo') return 'DEMO';
  if (accountClass === 'prop_firm') return 'PROP';
  return 'LIVE';
}

function sandboxForClass(accountClass: TradingAccountClass): boolean {
  if (accountClass === 'demo') return true;
  return envBool('CACSMS_FORCE_SANDBOX_EXECUTION', false);
}

async function loadBridgeTerminal(terminalId?: string | null): Promise<Record<string, unknown> | null> {
  const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
  try {
    const response = await fetch(`${bridgeUrl}/terminal-operations`, { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    const terminals = Array.isArray(payload.terminals) ? payload.terminals : [];
    if (terminalId) {
      return terminals.find((terminal: { terminalId?: string }) => String(terminal.terminalId) === terminalId) ?? null;
    }
    const connected = terminals.filter((terminal: { connectionStatus?: string }) => terminal.connectionStatus === 'connected');
    const withExecution = connected.find((terminal: { enableExecution?: boolean }) => terminal.enableExecution);
    return withExecution ?? connected[0] ?? null;
  } catch {
    return null;
  }
}

async function loadAccountFromDb(accountNumber: string) {
  const result = await queryPostgres(
    `SELECT balance, equity, mode, currency FROM trading_accounts WHERE account_number = $1 LIMIT 1`,
    [accountNumber],
  );
  return result.rows[0] as { balance?: string | number; equity?: string | number; mode?: string; currency?: string } | undefined;
}

export async function resolveExecutionAccountContext(terminalId?: string | null): Promise<ExecutionAccountContext | null> {
  const bridgeTerminal = await loadBridgeTerminal(terminalId);
  let resolvedTerminalId = terminalId ? String(terminalId) : bridgeTerminal?.terminalId ? String(bridgeTerminal.terminalId) : null;

  if (!resolvedTerminalId) {
    const snapshots = await listTerminalSnapshots();
    const connected = snapshots.find((terminal) => terminal.status === 'connected');
    resolvedTerminalId = connected?.terminalId ?? null;
  }

  if (!resolvedTerminalId) return null;

  const accountNumber = String(
    bridgeTerminal?.accountNumber
    ?? (await queryPostgres('SELECT account_number FROM mt5_terminals WHERE terminal_id = $1 LIMIT 1', [resolvedTerminalId])).rows[0]?.account_number
    ?? '',
  ).trim();

  const accountRow = accountNumber ? await loadAccountFromDb(accountNumber) : undefined;
  const equity = Number(accountRow?.equity ?? bridgeTerminal?.equity ?? 0);
  const balance = Number(accountRow?.balance ?? bridgeTerminal?.balance ?? equity);
  const currency = String(accountRow?.currency ?? bridgeTerminal?.currency ?? 'USD');
  const baseClass = normalizeTradingAccountClass(
    bridgeTerminal?.accountType ?? bridgeTerminal?.accountMode ?? accountRow?.mode ?? process.env.NEXT_PUBLIC_TRADING_MODE,
  );
  const accountClass = classifyAccount(baseClass, equity);
  const environment = environmentForClass(accountClass);
  const sandboxMode = sandboxForClass(accountClass);
  const liveExecutionAllowed = isLiveExecutionEnabled();

  return {
    terminalId: resolvedTerminalId,
    accountNumber: accountNumber || 'unknown',
    accountClass,
    environment,
    sandboxMode,
    equity,
    balance,
    currency,
    enableExecution: bridgeTerminal?.enableExecution == null ? true : Boolean(bridgeTerminal.enableExecution),
    liveExecutionAllowed,
    accountTradeAllowed: bridgeTerminal?.accountTradeAllowed == null ? true : Boolean(bridgeTerminal.accountTradeAllowed),
  };
}

export function liveExecutionBlockReason(context: ExecutionAccountContext): string | null {
  if (context.environment === 'LIVE' && !context.sandboxMode && !context.liveExecutionAllowed) {
    return 'Live execution is disabled. Set CACSMS_ENABLE_LIVE_EXECUTION=true after operational approval.';
  }
  if (!context.enableExecution) {
    return 'Terminal execution is disabled in terminal operations settings.';
  }
  if (!context.accountTradeAllowed) {
    return 'Account trade permission is disabled on the connected terminal.';
  }
  return null;
}
