export type TradingEventType = 'TICK'|'H1_CLOSE'|'H8_CLOSE'|'D1_CLOSE'|'MN_CLOSE'|'CHANNEL_APPROACH'|'CHANNEL_BREAK'|'STRENGTH_CHANGE'|'SPREAD_SPIKE'|'POSITION_EVENT'|'RISK_EVENT';
export interface TradingEvent { id:string; type:TradingEventType; symbol?:string; at:string; payload:Record<string,unknown>; }
type Handler=(event:TradingEvent)=>void;
export class EventBus { private handlers=new Map<TradingEventType,Set<Handler>>(); private history:TradingEvent[]=[];
 on(type:TradingEventType,handler:Handler){ if(!this.handlers.has(type))this.handlers.set(type,new Set()); this.handlers.get(type)!.add(handler); return()=>this.handlers.get(type)?.delete(handler);}
 emit(event:TradingEvent){this.history.unshift(event);this.history=this.history.slice(0,1000);this.handlers.get(event.type)?.forEach(h=>h(event));}
 recent(limit=100){return this.history.slice(0,limit)} }
export const eventBus=new EventBus();
