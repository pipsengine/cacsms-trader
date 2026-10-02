import type {ChartModel,Point} from '../types/chart';

export type PriceDomain={min:number;max:number;range:number;rejected:number};
const isFiniteNumber=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);

/**
 * Price-domain guard for the autonomous chart.
 * Candle OHLC is the authoritative visible-price anchor. Overlays are admitted only
 * when they are finite and plausibly related to the candle domain. This prevents a
 * stale target, percentage, score or malformed annotation from flattening FX candles.
 */
export function buildPriceDomain(model:ChartModel):PriceDomain{
  const candlePrices=model.candles.flatMap(c=>[c.low,c.high]).filter(isFiniteNumber);
  if(!candlePrices.length)return {min:0,max:1,range:1,rejected:0};
  const baseMin=Math.min(...candlePrices),baseMax=Math.max(...candlePrices);
  const mid=(baseMin+baseMax)/2;
  const observed=Math.max(baseMax-baseMin,Math.abs(mid)*0.0025,0.0001);
  const guard=Math.max(observed*5,Math.abs(mid)*0.035);
  const accepted=[...candlePrices];let rejected=0;
  const add=(v:unknown)=>{if(!isFiniteNumber(v)){rejected++;return} if(v<baseMin-guard||v>baseMax+guard){rejected++;return} accepted.push(v)};
  model.levels.forEach(l=>add(l.price));
  model.zones.forEach(z=>{add(z.low);add(z.high)});
  model.scenario.forEach(s=>add(s.price));
  const points:Point[]=[...model.channel.upper,...model.channel.lower,...(model.channel.mid||[])];
  points.forEach(p=>add(p.price));
  model.supertrend.forEach(s=>s.points.forEach(p=>add(p.price)));
  model.markers.forEach(m=>add(m.price));
  let min=Math.min(...accepted),max=Math.max(...accepted);
  let range=Math.max(max-min,observed);
  const pad=Math.max(range*.065,Math.abs(mid)*0.0008);
  min-=pad;max+=pad;range=max-min;
  return {min,max,range,rejected};
}
