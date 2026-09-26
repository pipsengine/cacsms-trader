export const money=(n:number,c='USD')=>new Intl.NumberFormat('en-NG',{style:'currency',currency:c,maximumFractionDigits:c==='NGN'?0:2}).format(n);
export const ago=(iso?:string)=>{if(!iso)return '—';const s=Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/1000));return s<60?`${s}s ago`:s<3600?`${Math.floor(s/60)}m ago`:`${Math.floor(s/3600)}h ago`};
export const pct=(n:number)=>`${n.toFixed(2)}%`; export const cn=(...v:(string|false|undefined)[])=>v.filter(Boolean).join(' ');
