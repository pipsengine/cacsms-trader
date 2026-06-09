import type { AutonomyConfig } from './autonomy-types';

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

export function isAutonomyDemoMode(): boolean {
  return envBool('CACSMS_PIPELINE_DEMO_MODE', false);
}

export function applyAutonomyDemoOverrides(config: AutonomyConfig): AutonomyConfig {
  if (!isAutonomyDemoMode()) return config;
  return {
    ...config,
    mode: 'full_auto',
    tradeExecutionMode: 'full_auto',
    confidenceThreshold: envNumber('CACSMS_DEMO_CONFIDENCE_THRESHOLD', 42),
    alertThreshold: envNumber('CACSMS_DEMO_ALERT_THRESHOLD', 55),
    riskThreshold: envNumber('CACSMS_DEMO_RISK_THRESHOLD', 75),
    signalGenerationRules: {
      ...config.signalGenerationRules,
      requireTimeframeAlignment: false,
    },
  };
}

export function demoDecisionConfidenceThreshold(): number {
  return envNumber('CACSMS_DEMO_DECISION_CONFIDENCE_THRESHOLD', 42);
}

export function demoDecisionReadinessThreshold(): number {
  return envNumber('CACSMS_DEMO_DECISION_READINESS_THRESHOLD', 42);
}

export function demoVisualReadinessThreshold(): number {
  return envNumber('CACSMS_DEMO_VISUAL_READINESS_THRESHOLD', 48);
}
