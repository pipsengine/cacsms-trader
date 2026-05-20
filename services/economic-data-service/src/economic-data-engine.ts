export interface CotReportSnapshot {
  symbol: string;
  commercialNet: number;
  nonCommercialNet: number;
  reportedAt: string;
}

export interface InterestRateSnapshot {
  currency: string;
  centralBank: string;
  ratePercent: number;
  effectiveAt: string;
}

export interface EconomicCalendarEvent {
  eventId: string;
  currency: string;
  title: string;
  category: "cpi" | "nfp" | "gdp" | "rate_decision" | "central_bank" | "other";
  impact: "low" | "medium" | "high";
  startsAt: string;
}

export interface FundamentalBias {
  currency: string;
  score: number;
  direction: "bullish" | "bearish" | "neutral";
  reasons: string[];
  assessedAt: string;
}

export class EconomicDataEngine {
  syncCotReports(reports: CotReportSnapshot[]): CotReportSnapshot[] {
    return reports;
  }

  syncInterestRateHistory(rates: InterestRateSnapshot[]): InterestRateSnapshot[] {
    return rates.sort((a, b) => a.currency.localeCompare(b.currency) || a.effectiveAt.localeCompare(b.effectiveAt));
  }

  buildCentralBankCalendar(events: EconomicCalendarEvent[]): EconomicCalendarEvent[] {
    return events.filter((event) => event.category === "central_bank" || event.category === "rate_decision");
  }

  listMajorEvents(events: EconomicCalendarEvent[]): EconomicCalendarEvent[] {
    return events.filter((event) => ["cpi", "nfp", "gdp"].includes(event.category));
  }

  isNewsVolatilityBlocked(events: EconomicCalendarEvent[], currency: string, now = new Date(), windowMinutes = 30): boolean {
    return events.some((event) => {
      if (event.currency !== currency || event.impact !== "high") return false;
      const deltaMinutes = Math.abs(new Date(event.startsAt).getTime() - now.getTime()) / 60000;
      return deltaMinutes <= windowMinutes;
    });
  }

  scoreFundamentalBias(currency: string, rates: InterestRateSnapshot[], reports: CotReportSnapshot[], now = new Date()): FundamentalBias {
    const latestRate = rates.filter((rate) => rate.currency === currency).at(-1);
    const cotBias = reports.reduce((sum, report) => sum + report.nonCommercialNet - report.commercialNet, 0);
    const score = clamp((latestRate?.ratePercent ?? 0) * 10 + cotBias / 10000);

    return {
      currency,
      score,
      direction: score > 10 ? "bullish" : score < -10 ? "bearish" : "neutral",
      reasons: ["interest rate history reviewed", "COT positioning reviewed"],
      assessedAt: now.toISOString(),
    };
  }
}

function clamp(value: number): number {
  return Math.max(-100, Math.min(100, Number(value.toFixed(2))));
}
