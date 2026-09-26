import React from'react';import{ArrowUpRight,ArrowDownRight}from'lucide-react';
export const Card=({children,className=''}:{children:React.ReactNode,className?:string})=><section className={'card '+className}>{children}</section>;
export const PageHeader=({title,subtitle}:{title:string,subtitle:string})=><div className="page-head"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="live-pill"><span/> LIVE ENGINE</div></div>;
export const Badge=({children,tone='blue'}:{children:React.ReactNode,tone?:string})=><span className={'badge '+tone}>{children}</span>;
export const Metric=({label,value,sub,trend}:{label:string,value:string|number,sub?:string,trend?:number})=><Card className="metric"><div className="muted">{label}</div><div className="metric-row"><strong>{value}</strong>{trend!==undefined&&(trend>=0?<ArrowUpRight size={17}/>:<ArrowDownRight size={17}/>)}</div>{sub&&<small>{sub}</small>}</Card>;
export const Tabs=({items,active,onChange}:{items:string[],active:string,onChange:(x:string)=>void})=><div className="tabs">{items.map(x=><button key={x} className={active===x?'active':''} onClick={()=>onChange(x)}>{x}</button>)}</div>;
