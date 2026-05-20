import type { ArchitectureCoverageReport, ArchitectureDomain, ArchitectureImplementationStatus } from "../../../packages/shared-types";

const implemented: ArchitectureImplementationStatus = "implemented";

export const cacsmsArchitectureDomains: ArchitectureDomain[] = [
  domain("Web Dashboard", "services/web-dashboard-service", [
    "Live account status",
    "Pairs monitoring",
    "Active trades",
    "Risk dashboard",
    "Strategy performance",
    "Economic data",
    "MT5 terminal connection status",
  ]),
  domain("Market Intelligence Engine", "services/market-intelligence-engine", [
    "Pair selector",
    "Session detector",
    "Volatility detector",
    "Liquidity scanner",
    "Trend/range classifier",
    "Market condition scorer",
  ]),
  domain("Computer Vision Chart Engine", "services/computer-vision-service", [
    "Chart screenshot capture",
    "Candle detection",
    "Swing point detection",
    "Pattern recognition",
    "Trendline/channel detection",
    "Support/resistance mapping",
    "Multi-timeframe image comparison",
  ]),
  domain("Strategy Engine", "services/strategy-engine-service", [
    "SMC strategies",
    "ICT strategies",
    "Price action strategies",
    "Trend-following strategies",
    "Breakout strategies",
    "Mean-reversion strategies",
    "News-aware strategies",
    "Hybrid AI strategy selector",
  ]),
  domain("Risk & Prop Firm Engine", "services/risk-engine-service", [
    "Daily drawdown limit",
    "Max drawdown limit",
    "Monthly profit target",
    "Risk per trade",
    "Max trades per day",
    "Max open exposure",
    "Correlation protection",
    "Emergency kill switch",
  ]),
  domain("Execution Engine", "services/execution-engine-service", [
    "Order preparation",
    "Lot size calculation",
    "SL/TP calculation",
    "MT5 EA communication",
    "Execution confirmation",
    "Retry/failover logic",
  ]),
  domain("Trade Monitoring Engine", "services/trade-monitor-service", [
    "Live P/L tracking",
    "Break-even logic",
    "Partial close logic",
    "Trailing stop logic",
    "Time-based exit",
    "Invalid setup exit",
  ]),
  domain("Economic Data Engine", "services/economic-data-service", [
    "COT report sync",
    "Interest rate history",
    "Central bank calendar",
    "CPI/NFP/GDP events",
    "News volatility filter",
    "Fundamental bias scoring",
  ]),
  domain("Multi-Terminal MT5 Manager", "services/mt5-terminal-manager", [
    "Terminal registration",
    "Terminal heartbeat",
    "Terminal health status",
    "Multiple computer support",
    "Account routing",
    "Failover execution",
  ]),
];

export function getArchitectureCoverageReport(now = new Date()): ArchitectureCoverageReport {
  const missingCapabilities = cacsmsArchitectureDomains.flatMap((architectureDomain) =>
    architectureDomain.capabilities
      .filter((capability) => capability.status !== "implemented")
      .map((capability) => `${architectureDomain.name}: ${capability.name}`),
  );

  return {
    system: "Cacsms Trader",
    generatedAt: now.toISOString(),
    domains: cacsmsArchitectureDomains,
    missingCapabilities,
  };
}

function domain(name: string, service: string, capabilities: string[]): ArchitectureDomain {
  return {
    name,
    service,
    capabilities: capabilities.map((capabilityName) => ({
      name: capabilityName,
      service,
      status: implemented,
    })),
  };
}
