import React from'react';import{ArrowUpRight,ArrowDownRight}from'lucide-react';
export const Card=({children,className=''}:{children:React.ReactNode,className?:string})=><section className={'card '+className}>{children}</section>;
export const PageHeader=({title,subtitle}:{title:string,subtitle:string})=><div className="page-head"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="live-pill"><span/> LIVE ENGINE</div></div>;
export const Badge=({children,tone='blue'}:{children:React.ReactNode,tone?:string})=><span className={'badge '+tone}>{children}</span>;
export const Metric=({label,value,sub,trend}:{label:string,value:string|number,sub?:string,trend?:number})=><Card className="metric"><div className="muted">{label}</div><div className="metric-row"><strong>{value}</strong>{trend!==undefined&&(trend>=0?<ArrowUpRight size={17}/>:<ArrowDownRight size={17}/>)}</div>{sub&&<small>{sub}</small>}</Card>;
const tabSlug=(x:string)=>x.toLowerCase().replace(/[^a-z0-9]+/g,'-');
export const tabIds=(idPrefix:string,x:string)=>({tab:`${idPrefix}-tab-${tabSlug(x)}`,panel:`${idPrefix}-panel-${tabSlug(x)}`});
export const Tabs=({items,active,onChange,idPrefix,label}:{items:string[],active:string,onChange:(x:string)=>void,idPrefix?:string,label?:string})=>{
 const onKey=(e:React.KeyboardEvent<HTMLButtonElement>,i:number)=>{
  const next=e.key==='ArrowRight'?(i+1)%items.length:e.key==='ArrowLeft'?(i-1+items.length)%items.length:e.key==='Home'?0:e.key==='End'?items.length-1:-1;
  if(next<0)return;
  e.preventDefault();
  onChange(items[next]);
  (e.currentTarget.parentElement?.children[next] as HTMLButtonElement|undefined)?.focus();
 };
 return <div className="tabs" role="tablist" aria-label={label}>{items.map((x,i)=>{const on=active===x;const ids=idPrefix?tabIds(idPrefix,x):undefined;return <button key={x} type="button" role="tab" id={ids?.tab} aria-controls={ids?.panel} aria-selected={on} tabIndex={on?0:-1} className={on?'active':''} onClick={()=>onChange(x)} onKeyDown={e=>onKey(e,i)}>{x}</button>})}</div>;
};
