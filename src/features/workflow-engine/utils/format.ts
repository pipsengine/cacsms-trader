export const ago=(iso:string)=>Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/1000))+'s ago'; export const pct=(n:number)=>n.toFixed(0)+'%';
