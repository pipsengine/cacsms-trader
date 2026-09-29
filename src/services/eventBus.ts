export type TradingEventType = 'TICK'|'H1_CLOSE'|'H8_CLOSE'|'D1_CLOSE'|'W1_CLOSE'|'MN_CLOSE'|'M15_CLOSE'|'M5_CLOSE'|'DATA_EVENT'|'CHANNEL_APPROACH'|'CHANNEL_BREAK'|'STRENGTH_CHANGE'|'SCANNER_CHANGE'|'STRUCTURE_CHANGE'|'DIRECTION_CHANGE'|'CONFIRMATION_CHANGE'|'RISK_CHANGE'|'SPREAD_SPIKE'|'POSITION_EVENT'|'RISK_EVENT'|'ECON_EVENT_UPCOMING'|'ECON_EVENT_WATCH'|'ECON_PRE_EVENT_GATE'|'ECON_RELEASED'|'ECON_RELEASE_WINDOW'|'ECON_ACTUAL_RECEIVED'|'ECON_SURPRISE_CALCULATED'|'ECON_VOLATILITY_SPIKE'|'ECON_MARKET_SHOCK'|'ECON_SPREAD_SPIKE'|'ECON_REVALIDATION_REQUESTED'|'ECON_STRUCTURE_INVALIDATED'|'ECON_NORMALIZED'|'ECON_FEED_SYNCED'|'ECON_FEED_STALE'|'ECON_FEED_FAILED';
export interface TradingEvent { id:string; type:TradingEventType; symbol?:string; at:string; payload:Record<string,unknown>; }
type Handler=(event:TradingEvent)=>void;
export class EventBus { private handlers=new Map<TradingEventType,Set<Handler>>(); private history:TradingEvent[]=[];
 on(type:TradingEventType,handler:Handler){ if(!this.handlers.has(type))this.handlers.set(type,new Set()); this.handlers.get(type)!.add(handler); return()=>this.handlers.get(type)?.delete(handler);}
 emit(event:TradingEvent){this.history.unshift(event);this.history=this.history.slice(0,1000);this.handlers.get(event.type)?.forEach(h=>h(event));}
 recent(limit=100){return this.history.slice(0,limit)} }
export const eventBus=new EventBus();
