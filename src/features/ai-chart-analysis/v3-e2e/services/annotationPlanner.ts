import type {Marker,Level,Zone} from '../types/chart';
export type PlannedAnnotation={id:string;kind:'marker'|'level'|'zone';priority:number};
export function planAnnotations(markers:Marker[],levels:Level[],zones:Zone[]):PlannedAnnotation[]{
 const out:PlannedAnnotation[]=[];
 levels.forEach(l=>out.push({id:l.id,kind:'level',priority:l.tone==='invalid'?100:l.tone==='target'?90:80}));
 markers.forEach(m=>out.push({id:m.id,kind:'marker',priority:m.tone==='choch'||m.tone==='bos'?85:60}));
 zones.forEach(z=>out.push({id:z.id,kind:'zone',priority:75}));
 return out.sort((a,b)=>b.priority-a.priority);
}
