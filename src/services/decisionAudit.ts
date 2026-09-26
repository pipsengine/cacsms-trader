export interface DecisionEvidence { source:string; value:string|number|boolean; confidence:number; timestamp:string; }
export interface DecisionRecord { id:string; symbol:string; decision:'WAIT'|'WATCH'|'QUALIFIED'|'BLOCKED'|'BUY'|'SELL'|'EXIT'; reason:string; confidence:number; evidence:DecisionEvidence[]; createdAt:string; }
export class DecisionAuditStore { private records:DecisionRecord[]=[]; append(r:DecisionRecord){this.records.unshift(r);this.records=this.records.slice(0,5000)} bySymbol(s:string){return this.records.filter(r=>r.symbol===s)} all(){return [...this.records]} }
export const decisionAudit=new DecisionAuditStore();
