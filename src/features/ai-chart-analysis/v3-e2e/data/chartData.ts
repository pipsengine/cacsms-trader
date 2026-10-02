import type {ChartModel,Candle} from '../types/chart';
const N=86, start=Date.UTC(2026,8,25,0), step=3600_000;
let p=2629; const candles:Candle[]=[];
for(let i=0;i<N;i++){
  const drift=i<34?.72:i<54?-.45:i<68?-.15:.36;
  const wave=Math.sin(i*.63)*2.7+Math.sin(i*.17)*1.3;
  const o=p; const c=o+drift+wave*.42; const h=Math.max(o,c)+1.7+Math.abs(Math.sin(i))*1.5; const l=Math.min(o,c)-1.8-Math.abs(Math.cos(i*.7))*1.5;
  candles.push({time:start+i*step,open:o,high:h,low:l,close:c,volume:20+Math.round(Math.abs(Math.sin(i*.41))*74)}); p=c;
}
// shape last candles to resemble reference
const tail=[2641,2645,2649,2644,2642,2643,2645.81];
for(let j=0;j<tail.length;j++){const i=N-tail.length+j; const o=j?tail[j-1]:candles[i].open; const c=tail[j]; candles[i]={...candles[i],open:o,close:c,high:Math.max(o,c)+2.1,low:Math.min(o,c)-2.3};}
const pt=(i:number,price:number)=>({time:candles[Math.max(0,Math.min(N-1,i))].time,price});
export const demoModel:ChartModel={
 symbol:'XAUUSD',name:'Gold vs US Dollar',timeframe:'H1',ohlc:{...candles[N-1],open:2645.32,high:2646.18,low:2642.76,close:2645.81,volume:candles[N-1].volume},candles,
 supertrend:[
  {id:'st1',tone:'bull',width:2,points:[pt(8,2618),pt(18,2628),pt(28,2639),pt(37,2652)]},
  {id:'st2',tone:'bear',width:2,points:[pt(38,2656),pt(50,2655),pt(58,2646),pt(68,2645)]},
  {id:'st3',tone:'bull',width:2,points:[pt(67,2635),pt(78,2639),pt(85,2648)]}
 ],
 channel:{upper:[pt(0,2644),pt(85,2684)],lower:[pt(8,2609),pt(85,2648)],mid:[pt(0,2625),pt(85,2666)]},
 zones:[
  {id:'supply',from:candles[45].time,to:candles[77].time,low:2667.5,high:2673,label:'H1 Supply',tone:'supply'},
  {id:'demand',from:candles[64].time,to:candles[85].time,low:2631.5,high:2639,label:'H1 ERZ / Demand',tone:'demand'}
 ],
 levels:[
  {id:'t2',price:2670.5,label:'T2 2,670.50',tone:'target'},
  {id:'t1',price:2658.2,label:'T1 2,658.20',tone:'target'},
  {id:'inv',price:2618.4,label:'Invalidation 2,618.40',tone:'invalid'},
  {id:'p2',price:2642.1,label:'P2 Break',tone:'break'},
  {id:'price',price:2645.81,label:'2,645.81',tone:'price'}
 ],
 markers:[
  {id:'m3',time:candles[39].time,price:2662,label:'3',tone:'number',number:3},
  {id:'ch',time:candles[49].time,price:2643.8,label:'CHoCH',tone:'choch'},
  {id:'m4',time:candles[66].time,price:2630.2,label:'4',tone:'number',number:4},
  {id:'bos',time:candles[69].time,price:2651,label:'BOS',tone:'bos'},
  {id:'m5',time:candles[76].time,price:2652.8,label:'5',tone:'number',number:5}
 ],
 scenario:[pt(78,2643),pt(80,2652),pt(82,2646),pt(84,2656),pt(85,2661),{time:candles[85].time+5*step,price:2670.5,label:'T2'}]
};
