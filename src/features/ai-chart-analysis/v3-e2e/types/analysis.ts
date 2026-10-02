export type Tone='bull'|'bear'|'neutral'|'warning';
export interface TimeframeState{tf:string;direction:string;state:string;score:number;tone:Tone;arrow:'up'|'down'|'flat'}
export interface EvidenceItem{id:string;text:string;tone:'support'|'conflict'|'missing'}
export interface AnalysisState{analysisId:string;symbol:string;timeframe:string;status:string;title:string;summary:string;direction:string;marketState:string;structure:string;evidenceScore:number;support:EvidenceItem[];conflict:EvidenceItem[];missing:EvidenceItem[];location:string;supertrend:string;alignment:string[];expectedPath:{label:string;state:'complete'|'current'|'pending'}[]}
