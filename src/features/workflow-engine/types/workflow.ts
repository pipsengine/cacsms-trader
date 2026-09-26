export type StageStatus='running'|'completed'|'waiting'|'blocked'|'error'|'paused';
export type Direction='BULLISH'|'BEARISH'|'RANGE'|'NEUTRAL';
export interface StageRuntime {id:number;name:string;status:StageStatus;confidence:number;latencyMs:number;freshnessSec:number;input:string[];output:string[];message:string;updatedAt:string;processed:number;failed:number;}
export interface InstrumentTrace {symbol:string;assetClass:'FX'|'METAL';macro:Direction;regime:string;d1:string;h8:string;h1:string;risk:string;decision:'WAIT'|'READY'|'BLOCKED'|'OPEN';confidence:number;updatedAt:string;stage:number;}
export interface WorkflowEvent {id:string;time:string;severity:'info'|'success'|'warning'|'error';stage:number;symbol?:string;event:string;detail:string;latencyMs?:number;}
export interface WorldModelRecord {symbol:string;bid:number;ask:number;spread:number;strength:string;regime:string;d1:string;h8:string;h1:string;exposure:string;riskAvailable:number;decision:string;confidence:number;version:number;updatedAt:string;}
export interface WorkflowSnapshot {stages:StageRuntime[];instruments:InstrumentTrace[];events:WorkflowEvent[];world:WorldModelRecord[];engine:{running:boolean;executionEnabled:boolean;mode:'SIMULATION'|'LIVE';cycle:number;lastHeartbeat:string;queueDepth:number;throughput:number;errors:number};}
