import { evaluatePropFirmRisk } from "../../../packages/risk-core";
import type { PropFirmRiskRules, RiskDecision, RiskState } from "../../../packages/shared-types";

export interface ExposureSnapshot {
  symbol: string;
  currency: string;
  exposurePercent: number;
  correlationGroup?: string;
}

export interface PropFirmRiskEvaluationInput {
  rules: PropFirmRiskRules;
  state: RiskState;
  requestedLots: number;
  rewardRiskRatio: number;
  exposures: ExposureSnapshot[];
}

export class RiskAndPropFirmEngine {
  evaluate(input: PropFirmRiskEvaluationInput): RiskDecision {
    const baseDecision = evaluatePropFirmRisk(input);
    if (!baseDecision.allowed) return baseDecision;

    const exposureDecision = this.evaluateExposure(input.rules, input.exposures);
    if (!exposureDecision.allowed) return exposureDecision;

    return baseDecision;
  }

  evaluateExposure(rules: PropFirmRiskRules, exposures: ExposureSnapshot[]): RiskDecision {
    const currencyExposure = maxBy(exposures, (exposure) => exposure.exposurePercent);
    if (currencyExposure && currencyExposure.exposurePercent > rules.maxCurrencyExposurePercent) {
      return blocked("max_open_exposure", `Currency exposure is above ${rules.maxCurrencyExposurePercent}%.`);
    }

    const correlated = groupExposure(exposures);
    if (correlated > rules.maxCorrelatedExposurePercent) {
      return blocked("correlation_protection", `Correlated exposure is above ${rules.maxCorrelatedExposurePercent}%.`);
    }

    return {
      allowed: true,
      code: "allowed",
      message: "Risk and prop firm checks passed.",
      remainingDailyLossAmount: 0,
    };
  }

  activateEmergencyKillSwitch(state: RiskState): RiskState {
    return { ...state, killSwitchActive: true };
  }
}

function blocked(code: string, message: string): RiskDecision {
  return {
    allowed: false,
    code: code as RiskDecision["code"],
    message,
    remainingDailyLossAmount: 0,
  };
}

function maxBy<T>(items: T[], selector: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>((highest, item) => {
    if (!highest || selector(item) > selector(highest)) return item;
    return highest;
  }, undefined);
}

function groupExposure(exposures: ExposureSnapshot[]): number {
  const groups = new Map<string, number>();
  for (const exposure of exposures) {
    const key = exposure.correlationGroup ?? exposure.currency;
    groups.set(key, (groups.get(key) ?? 0) + exposure.exposurePercent);
  }
  return Math.max(0, ...groups.values());
}
