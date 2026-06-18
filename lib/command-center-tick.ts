import { getBridgeExecutionMetrics } from './autonomous-pipeline-risk-execution';
import { buildFundedNextCompliance, type PropFirmComplianceView } from './prop-firm-profiles';
import { getLiveTerminalFeed, type LiveTerminalFeed } from './live-terminal-feed';
import { getContinuousTradingSessionStatus } from './continuous-trading-session';
import { getTradingPeriodPnl } from './trading-period-pnl';

let tickSequence = 0;

export interface CommandCenterTick {
  sequence: number;
  tickAt: string;
  bridge: {
    online: boolean;
    connected: number;
    degraded: number;
    disconnected: number;
  };
  trading: {
    totalEquity: number;
    totalBalance: number;
    connectedTerminals: number;
    degradedTerminals: number;
    openPositions: number;
    terminalOpen: number;
    trackedOpen: number;
    terminals: LiveTerminalFeed['terminals'];
    openPositionDetails: Array<{
      ticket: string;
      symbol: string | null;
      side: string | null;
      volumeLots: number | null;
      profitLoss: number;
    }>;
  };
  propFirm: PropFirmComplianceView;
  continuousTrading: {
    active: boolean;
    startedAt: string | null;
    stoppedAt: string | null;
    periodPnl: {
      todayUsd: number;
      weekUsd: number;
      monthUsd: number;
    };
  };
}

export interface CommandCenterTickOptions {
  syncHeartbeats?: boolean;
  includePositionDetails?: boolean;
}

export async function getCommandCenterTick(options: CommandCenterTickOptions = {}): Promise<CommandCenterTick> {
  tickSequence += 1;
  const syncHeartbeats = options.syncHeartbeats ?? false;
  const includePositionDetails = options.includePositionDetails ?? true;

  const liveFeed = await getLiveTerminalFeed({ syncHeartbeats });
  if (includePositionDetails) {
    const { runTradeMonitorTick } = await import('./trade-monitor-runtime');
    await runTradeMonitorTick(Date.now()).catch(() => null);
  }

  const execution = includePositionDetails
    ? await getBridgeExecutionMetrics()
    : {
        terminalOpen: 0,
        openOrders: 0,
        trackedOpen: 0,
        openPositions: [] as CommandCenterTick['trading']['openPositionDetails'],
      };

  const activeTerminals = liveFeed.terminals.filter((terminal) => terminal.status !== 'disconnected');
  const primaryAccount = activeTerminals[0]?.accountNumber ?? liveFeed.terminals[0]?.accountNumber ?? null;
  const trackedCount = Math.max(execution.trackedOpen, execution.openPositions.length);
  const openPositions = Math.max(liveFeed.totalOpenOrders, execution.terminalOpen, execution.openOrders, trackedCount);

  const [propFirm, continuousTrading, periodPnl] = await Promise.all([
    buildFundedNextCompliance({
      accountNumber: primaryAccount,
      liveEquity: liveFeed.totalEquity,
      liveBalance: liveFeed.totalBalance,
      liveOpenTrades: openPositions,
    }),
    getContinuousTradingSessionStatus(),
    getTradingPeriodPnl({
      accountNumber: primaryAccount,
      liveEquity: liveFeed.totalEquity,
    }),
  ]);

  return {
    sequence: tickSequence,
    tickAt: liveFeed.syncedAt,
    bridge: {
      online: liveFeed.bridgeOnline,
      connected: liveFeed.connectedCount,
      degraded: liveFeed.degradedCount,
      disconnected: liveFeed.disconnectedCount,
    },
    trading: {
      totalEquity: liveFeed.totalEquity,
      totalBalance: liveFeed.totalBalance,
      connectedTerminals: liveFeed.connectedCount,
      degradedTerminals: liveFeed.degradedCount,
      openPositions,
      terminalOpen: Math.max(execution.terminalOpen, liveFeed.totalOpenOrders),
      trackedOpen: execution.trackedOpen,
      terminals: liveFeed.terminals,
      openPositionDetails: execution.openPositions,
    },
    propFirm,
    continuousTrading: {
      active: continuousTrading.active,
      startedAt: continuousTrading.startedAt,
      stoppedAt: continuousTrading.stoppedAt,
      periodPnl: {
        todayUsd: periodPnl.todayUsd,
        weekUsd: periodPnl.weekUsd,
        monthUsd: periodPnl.monthUsd,
      },
    },
  };
}
