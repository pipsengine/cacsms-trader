import type {AutonomousSnapshot} from '../types/autonomous';

const API_BASE=(import.meta as any).env?.VITE_CACSMS_API_BASE || '';
export async function fetchAutonomousSnapshot(symbol:string,signal?:AbortSignal):Promise<AutonomousSnapshot>{
 const r=await fetch(`${API_BASE}/api/ai-chart-analysis/state?symbol=${encodeURIComponent(symbol)}`,{signal,headers:{Accept:'application/json'}});
 if(!r.ok)throw new Error(`Autonomous state request failed: ${r.status}`);
 return r.json();
}
export async function requestRefresh(symbol:string):Promise<void>{
 const r=await fetch(`${API_BASE}/api/ai-chart-analysis/refresh`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol})});
 if(!r.ok)throw new Error(`Refresh failed: ${r.status}`);
}
