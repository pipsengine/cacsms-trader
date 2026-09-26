export type GatewayMode='SIMULATION'|'PAPER'|'LIVE'; export interface OrderRequest{symbol:string;side:'BUY'|'SELL';size:number;sl:number;tp:number;clientOrderId:string}
export interface OrderResult{accepted:boolean;brokerOrderId?:string;reason?:string;filledPrice?:number}
export class BrokerGateway{constructor(public mode:GatewayMode='SIMULATION'){} async validate(){return{connected:true,latencyMs:28,mode:this.mode}} async placeOrder(o:OrderRequest):Promise<OrderResult>{if(this.mode==='LIVE')return{accepted:false,reason:'Live broker adapter not configured'};return{accepted:true,brokerOrderId:`SIM-${o.clientOrderId}`,filledPrice:0}} async cancelOrder(){return true}}
export const brokerGateway=new BrokerGateway();
