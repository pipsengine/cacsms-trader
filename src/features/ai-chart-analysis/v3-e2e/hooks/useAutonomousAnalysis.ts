import {useCallback,useEffect,useRef,useState} from 'react';
import {fetchAutonomousSnapshot,requestRefresh} from '../api/autonomousClient';
import type {AutonomousSnapshot} from '../types/autonomous';
export function useAutonomousAnalysis(symbol:string,pollMs=3000){
 const [data,setData]=useState<AutonomousSnapshot|null>(null);const [error,setError]=useState<string|null>(null);const [loading,setLoading]=useState(false);const alive=useRef(true);
 const load=useCallback(async()=>{const c=new AbortController();setLoading(true);try{const d=await fetchAutonomousSnapshot(symbol,c.signal);if(alive.current){setData(d);setError(null)}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Analysis unavailable')}finally{if(alive.current)setLoading(false)}return()=>c.abort()},[symbol]);
 useEffect(()=>{alive.current=true;void load();const id=window.setInterval(()=>void load(),pollMs);return()=>{alive.current=false;window.clearInterval(id)}},[load,pollMs]);
 const refresh=useCallback(async()=>{await requestRefresh(symbol);await load()},[symbol,load]);
 return {data,error,loading,refresh};
}
