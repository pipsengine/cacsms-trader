export const CHART_W = 960;
export const CHART_H = 500;
export const MARGIN_L = 12;
export const MARGIN_R = 58;
export const MARGIN_T = 12;
export const MARGIN_B = 48;
export const VOL_MAX_H = 70;

export function plotWidth(): number {
  return CHART_W - MARGIN_L - MARGIN_R;
}

export function plotHeight(): number {
  return CHART_H - MARGIN_T - MARGIN_B;
}

export function makeIndexX(n: number): (i: number) => number {
  const pw = plotWidth();
  return (i: number) => MARGIN_L + (i / (n + 12)) * pw;
}

export function makePriceY(pMin: number, pMax: number): (p: number) => number {
  const ph = plotHeight();
  return (p: number) => MARGIN_T + ((pMax - p) / (pMax - pMin)) * ph;
}
