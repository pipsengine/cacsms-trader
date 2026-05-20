import type { Timeframe } from "../../../packages/shared-types";

export interface ChartScreenshot {
  screenshotId: string;
  symbol: string;
  timeframe: Timeframe;
  imageUri: string;
  capturedAt: string;
}

export interface CandleDetection {
  open: number;
  high: number;
  low: number;
  close: number;
  confidence: number;
}

export interface ChartVisionAnalysis {
  screenshot: ChartScreenshot;
  candles: CandleDetection[];
  swingPoints: SwingPoint[];
  patterns: PatternRecognition[];
  trendlines: TrendlineDetection[];
  supportResistance: PriceLevel[];
  comparedTimeframes: Timeframe[];
  confidence: number;
}

export interface SwingPoint {
  kind: "high" | "low";
  price: number;
  index: number;
  confidence: number;
}

export interface PatternRecognition {
  pattern: "breakout" | "reversal" | "continuation" | "liquidity_sweep" | "none";
  confidence: number;
}

export interface TrendlineDetection {
  kind: "trendline" | "channel";
  slope: number;
  touchCount: number;
  confidence: number;
}

export interface PriceLevel {
  kind: "support" | "resistance";
  price: number;
  touches: number;
  confidence: number;
}

export class ComputerVisionChartEngine {
  captureChartScreenshot(input: Omit<ChartScreenshot, "screenshotId" | "capturedAt">, now = new Date()): ChartScreenshot {
    return {
      ...input,
      screenshotId: `${input.symbol}-${input.timeframe}-${now.getTime()}`,
      capturedAt: now.toISOString(),
    };
  }

  detectCandles(): CandleDetection[] {
    return [];
  }

  detectSwingPoints(candles: CandleDetection[]): SwingPoint[] {
    return candles.flatMap<SwingPoint>((candle, index, list) => {
      if (index === 0 || index === list.length - 1) return [];
      const previous = list[index - 1];
      const next = list[index + 1];
      if (candle.high > previous.high && candle.high > next.high) {
        return [{ kind: "high", price: candle.high, index, confidence: candle.confidence }];
      }
      if (candle.low < previous.low && candle.low < next.low) {
        return [{ kind: "low", price: candle.low, index, confidence: candle.confidence }];
      }
      return [];
    });
  }

  recognizePatterns(swingPoints: SwingPoint[]): PatternRecognition[] {
    if (swingPoints.length < 2) {
      return [{ pattern: "none", confidence: 0 }];
    }

    return [{ pattern: "continuation", confidence: averageConfidence(swingPoints) }];
  }

  detectTrendlines(swingPoints: SwingPoint[]): TrendlineDetection[] {
    if (swingPoints.length < 3) return [];
    const first = swingPoints[0];
    const last = swingPoints[swingPoints.length - 1];
    return [{
      kind: "trendline",
      slope: (last.price - first.price) / Math.max(1, last.index - first.index),
      touchCount: swingPoints.length,
      confidence: averageConfidence(swingPoints),
    }];
  }

  mapSupportResistance(swingPoints: SwingPoint[]): PriceLevel[] {
    return swingPoints.map((point) => ({
      kind: point.kind === "low" ? "support" : "resistance",
      price: point.price,
      touches: 1,
      confidence: point.confidence,
    }));
  }

  compareTimeframes(analyses: ChartVisionAnalysis[]): Timeframe[] {
    return Array.from(new Set(analyses.map((analysis) => analysis.screenshot.timeframe)));
  }

  analyzeScreenshot(screenshot: ChartScreenshot, candles = this.detectCandles()): ChartVisionAnalysis {
    const swingPoints = this.detectSwingPoints(candles);
    const patterns = this.recognizePatterns(swingPoints);
    const trendlines = this.detectTrendlines(swingPoints);

    return {
      screenshot,
      candles,
      swingPoints,
      patterns,
      trendlines,
      supportResistance: this.mapSupportResistance(swingPoints),
      comparedTimeframes: [screenshot.timeframe],
      confidence: averageConfidence([...candles, ...swingPoints, ...patterns, ...trendlines]),
    };
  }
}

function averageConfidence(items: Array<{ confidence: number }>): number {
  if (items.length === 0) return 0;
  return Number((items.reduce((sum, item) => sum + item.confidence, 0) / items.length).toFixed(2));
}
