export type Direction='BULLISH'|'BEARISH'|'NEUTRAL';export type TradeState='WAIT'|'READY'|'ACTIVE'|'BLOCKED';
export interface Instrument{symbol:string;kind:'FX'|'GOLD';bid:number;ask:number;spread:number;change:number;d1:Direction;h8:Direction;h1:string;score:number;state:TradeState;strengthDiff:number;channelPos:number;confidence:number;lastTickAt?:string;}
export interface Position{id:string;symbol:string;side:'BUY'|'SELL';entry:number;current:number;sl:number;tp:number;size:number;risk:number;pnl:number;status:'ACTIVE'|'CLOSED';opened:string;}
export interface CurrencyStrength{code:string;q:number;m:number;score:number;trend:'Strengthening'|'Stable'|'Weakening'|'Recovering';classification:string;}
