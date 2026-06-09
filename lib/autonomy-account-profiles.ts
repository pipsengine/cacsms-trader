import type { TradingAccountClass } from '@/lib/execution-account-context';
import { isAutonomyDemoMode } from '@/lib/autonomy-demo-config';
import type { AutonomyConfig } from '@/lib/autonomy-types';

export interface AutonomyThresholdProfile {
  accountClass: TradingAccountClass;
  tradeExecutionMode: AutonomyConfig['tradeExecutionMode'];
  confidenceThreshold: number;
  alertThreshold: number;
  riskThreshold: number;
  decisionConfidenceThreshold: number;
  decisionReadinessThreshold: number;
  visualReadinessThreshold: number;
  riskPerTradePercent: number;
  requireTimeframeAlignment: boolean;
  allowDemoFusionOverrides: boolean;
  signalCooldownMinutes: number;
  dispatchCooldownMinutes: number;
  mtfRefreshCooldownMinutes: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const PROFILES: Record<TradingAccountClass, AutonomyThresholdProfile> = {
  demo: {
    accountClass: 'demo',
    tradeExecutionMode: 'full_auto',
    confidenceThreshold: envNumber('CACSMS_DEMO_CONFIDENCE_THRESHOLD', 42),
    alertThreshold: envNumber('CACSMS_DEMO_ALERT_THRESHOLD', 55),
    riskThreshold: 75,
    decisionConfidenceThreshold: envNumber('CACSMS_DEMO_DECISION_CONFIDENCE_THRESHOLD', 42),
    decisionReadinessThreshold: envNumber('CACSMS_DEMO_DECISION_READINESS_THRESHOLD', 42),
    visualReadinessThreshold: envNumber('CACSMS_DEMO_VISUAL_READINESS_THRESHOLD', 48),
    riskPerTradePercent: envNumber('CACSMS_DEMO_RISK_PER_TRADE_PERCENT', 0.5),
    requireTimeframeAlignment: false,
    allowDemoFusionOverrides: true,
    signalCooldownMinutes: envNumber('CACSMS_DEMO_SIGNAL_COOLDOWN_MINUTES', 15),
    dispatchCooldownMinutes: envNumber('CACSMS_DEMO_DISPATCH_COOLDOWN_MINUTES', 30),
    mtfRefreshCooldownMinutes: envNumber('CACSMS_DEMO_MTF_REFRESH_MINUTES', 30),
  },
  prop_firm: {
    accountClass: 'prop_firm',
    tradeExecutionMode: 'full_auto',
    confidenceThreshold: envNumber('CACSMS_PROP_CONFIDENCE_THRESHOLD', 58),
    alertThreshold: envNumber('CACSMS_PROP_ALERT_THRESHOLD', 68),
    riskThreshold: envNumber('CACSMS_PROP_RISK_THRESHOLD', 65),
    decisionConfidenceThreshold: envNumber('CACSMS_PROP_DECISION_CONFIDENCE_THRESHOLD', 55),
    decisionReadinessThreshold: envNumber('CACSMS_PROP_DECISION_READINESS_THRESHOLD', 55),
    visualReadinessThreshold: envNumber('CACSMS_PROP_VISUAL_READINESS_THRESHOLD', 58),
    riskPerTradePercent: envNumber('CACSMS_PROP_RISK_PER_TRADE_PERCENT', 0.35),
    requireTimeframeAlignment: true,
    allowDemoFusionOverrides: false,
    signalCooldownMinutes: envNumber('CACSMS_PROP_SIGNAL_COOLDOWN_MINUTES', 20),
    dispatchCooldownMinutes: envNumber('CACSMS_PROP_DISPATCH_COOLDOWN_MINUTES', 60),
    mtfRefreshCooldownMinutes: envNumber('CACSMS_PROP_MTF_REFRESH_MINUTES', 45),
  },
  live: {
    accountClass: 'live',
    tradeExecutionMode: 'full_auto',
    confidenceThreshold: envNumber('CACSMS_LIVE_CONFIDENCE_THRESHOLD', 62),
    alertThreshold: envNumber('CACSMS_LIVE_ALERT_THRESHOLD', 72),
    riskThreshold: envNumber('CACSMS_LIVE_RISK_THRESHOLD', 60),
    decisionConfidenceThreshold: envNumber('CACSMS_LIVE_DECISION_CONFIDENCE_THRESHOLD', 58),
    decisionReadinessThreshold: envNumber('CACSMS_LIVE_DECISION_READINESS_THRESHOLD', 58),
    visualReadinessThreshold: envNumber('CACSMS_LIVE_VISUAL_READINESS_THRESHOLD', 62),
    riskPerTradePercent: envNumber('CACSMS_LIVE_RISK_PER_TRADE_PERCENT', 0.25),
    requireTimeframeAlignment: true,
    allowDemoFusionOverrides: false,
    signalCooldownMinutes: envNumber('CACSMS_LIVE_SIGNAL_COOLDOWN_MINUTES', 30),
    dispatchCooldownMinutes: envNumber('CACSMS_LIVE_DISPATCH_COOLDOWN_MINUTES', 120),
    mtfRefreshCooldownMinutes: envNumber('CACSMS_LIVE_MTF_REFRESH_MINUTES', 60),
  },
  large_equity: {
    accountClass: 'large_equity',
    tradeExecutionMode: 'full_auto',
    confidenceThreshold: envNumber('CACSMS_LARGE_EQUITY_CONFIDENCE_THRESHOLD', 65),
    alertThreshold: envNumber('CACSMS_LARGE_EQUITY_ALERT_THRESHOLD', 75),
    riskThreshold: envNumber('CACSMS_LARGE_EQUITY_RISK_THRESHOLD', 55),
    decisionConfidenceThreshold: envNumber('CACSMS_LARGE_EQUITY_DECISION_CONFIDENCE_THRESHOLD', 60),
    decisionReadinessThreshold: envNumber('CACSMS_LARGE_EQUITY_DECISION_READINESS_THRESHOLD', 60),
    visualReadinessThreshold: envNumber('CACSMS_LARGE_EQUITY_VISUAL_READINESS_THRESHOLD', 65),
    riskPerTradePercent: envNumber('CACSMS_LARGE_EQUITY_RISK_PER_TRADE_PERCENT', 0.15),
    requireTimeframeAlignment: true,
    allowDemoFusionOverrides: false,
    signalCooldownMinutes: envNumber('CACSMS_LARGE_EQUITY_SIGNAL_COOLDOWN_MINUTES', 45),
    dispatchCooldownMinutes: envNumber('CACSMS_LARGE_EQUITY_DISPATCH_COOLDOWN_MINUTES', 180),
    mtfRefreshCooldownMinutes: envNumber('CACSMS_LARGE_EQUITY_MTF_REFRESH_MINUTES', 90),
  },
};

export function getAutonomyThresholdProfile(accountClass: TradingAccountClass = 'demo'): AutonomyThresholdProfile {
  if (accountClass === 'demo' && !isAutonomyDemoMode()) {
    return {
      ...PROFILES.demo,
      tradeExecutionMode: 'assisted_trade',
      allowDemoFusionOverrides: false,
      confidenceThreshold: 60,
      decisionConfidenceThreshold: 55,
      decisionReadinessThreshold: 55,
      visualReadinessThreshold: 62,
      requireTimeframeAlignment: true,
    };
  }
  return PROFILES[accountClass] ?? PROFILES.demo;
}

export function applyAutonomyAccountProfile(config: AutonomyConfig, accountClass: TradingAccountClass = 'demo'): AutonomyConfig {
  const profile = getAutonomyThresholdProfile(accountClass);
  return {
    ...config,
    mode: profile.tradeExecutionMode,
    tradeExecutionMode: profile.tradeExecutionMode,
    confidenceThreshold: profile.confidenceThreshold,
    alertThreshold: profile.alertThreshold,
    riskThreshold: profile.riskThreshold,
    signalGenerationRules: {
      ...config.signalGenerationRules,
      requireTimeframeAlignment: profile.requireTimeframeAlignment,
      accountClass: profile.accountClass,
    },
  };
}

export function shouldUseDemoFusionOverrides(accountClass: TradingAccountClass = 'demo'): boolean {
  return getAutonomyThresholdProfile(accountClass).allowDemoFusionOverrides;
}

export function getDecisionThresholds(accountClass: TradingAccountClass = 'demo') {
  const profile = getAutonomyThresholdProfile(accountClass);
  return {
    confidence: profile.decisionConfidenceThreshold,
    readiness: profile.decisionReadinessThreshold,
    visualReadiness: profile.visualReadinessThreshold,
  };
}
