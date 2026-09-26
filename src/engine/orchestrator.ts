export type MarketEvent='TICK'|'H1_CLOSE'|'H8_CLOSE'|'D1_CLOSE'|'MONTH_CLOSE'|'CHANNEL_APPROACH'|'CHANNEL_BREAK'|'POSITION_EVENT';
export const stageTriggers:Record<MarketEvent,number[]>={TICK:[1,9],H1_CLOSE:[1,7,8],H8_CLOSE:[1,5,6],D1_CLOSE:[1,5,6],MONTH_CLOSE:[2,3,4],CHANNEL_APPROACH:[5,6,7],CHANNEL_BREAK:[5,6,7,8,9],POSITION_EVENT:[9,10]};
export interface GateResult{pass:boolean;stage:number;reason:string;confidence:number}
export function executionGate(gates:GateResult[]){const failed=gates.find(g=>!g.pass);return{permitted:!failed,blockedBy:failed?.stage??null,reason:failed?.reason??'All mandatory gates passed',confidence:Math.round(gates.reduce((a,g)=>a+g.confidence,0)/Math.max(1,gates.length))}}
export function routeEvent(event:MarketEvent){return{event,stages:stageTriggers[event],createdAt:new Date().toISOString(),priority:event==='CHANNEL_BREAK'||event==='POSITION_EVENT'?'HIGH':'NORMAL'}}
