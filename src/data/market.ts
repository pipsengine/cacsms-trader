import{Instrument,CurrencyStrength,Position}from'../types';
export const strengths:CurrencyStrength[]=[
{code:'XAU',q:9.1,m:9.6,score:9.4,trend:'Strengthening',classification:'STRONG'},
{code:'EUR',q:7.8,m:8.2,score:8.0,trend:'Strengthening',classification:'STRONG'},
{code:'GBP',q:7.4,m:6.9,score:7.1,trend:'Weakening',classification:'STRONG'},
{code:'AUD',q:2.8,m:3.4,score:3.1,trend:'Recovering',classification:'IMPROVING'},
{code:'CAD',q:1.1,m:.8,score:.9,trend:'Stable',classification:'NEUTRAL'},
{code:'CHF',q:-2.8,m:-2.1,score:-2.4,trend:'Recovering',classification:'RECOVERING'},
{code:'NZD',q:-3.8,m:-4.3,score:-4.1,trend:'Weakening',classification:'WEAK'},
{code:'USD',q:-6.9,m:-7.4,score:-7.2,trend:'Weakening',classification:'WEAK'},
{code:'JPY',q:-7.6,m:-8.1,score:-7.9,trend:'Weakening',classification:'VERY WEAK'}];
const raw=[['EURUSD','FX',1.18421,1.18429,.8,.29,'BULLISH','BULLISH','Pullback',83,'WAIT',14.7,28,91],['GBPUSD','FX',1.27214,1.27225,1.1,.15,'BULLISH','BULLISH','Confirmed',86,'READY',14.0,35,88],['USDJPY','FX',149.321,149.339,1.8,-.18,'BEARISH','BEARISH','Confirmed',84,'READY',.7,48,86],['XAUUSD','GOLD',2036.12,2036.31,1.9,.42,'BULLISH','BULLISH','Pullback',89,'WAIT',16.6,31,93],['AUDUSD','FX',.65432,.65440,.8,.19,'BULLISH','BULLISH','Confirmed',78,'READY',10.3,42,82],['EURJPY','FX',176.82,176.84,2.0,.51,'BULLISH','BULLISH','Confirmed',92,'READY',15.9,22,94],['GBPJPY','FX',190.11,190.14,3.0,.37,'BULLISH','BULLISH','Confirmed',86,'READY',15.0,29,89],['AUDJPY','FX',97.64,97.66,2.0,.28,'BULLISH','BULLISH','Confirmed',80,'READY',11.0,62,81],['GBPNZD','FX',2.1032,2.1035,3.0,.12,'BULLISH','NEUTRAL','Waiting',72,'WAIT',11.2,55,75],['EURNZD','FX',1.9567,1.9570,3.0,.08,'NEUTRAL','NEUTRAL','Range',68,'WAIT',12.1,51,69],['USDCHF','FX',.8012,.8013,1.0,-.11,'BEARISH','BEARISH','Pullback',75,'WAIT',-4.8,44,77],['USDCAD','FX',1.3512,1.3513,1.0,-.05,'BEARISH','NEUTRAL','Range',65,'WAIT',-8.1,48,67]] as const;
export const instruments:Instrument[]=raw.map(r=>({symbol:r[0],kind:r[1],bid:r[2],ask:r[3],spread:r[4],change:r[5],d1:r[6],h8:r[7],h1:r[8],score:r[9],state:r[10],strengthDiff:r[11],channelPos:r[12],confidence:r[13]})) as Instrument[];
export const positions:Position[]=[{id:'TRD-1048',symbol:'GBPJPY',side:'BUY',entry:189.42,current:190.11,sl:188.91,tp:191.35,size:.22,risk:.45,pnl:128,status:'ACTIVE',opened:'14:08'},{id:'TRD-1049',symbol:'AUDJPY',side:'BUY',entry:96.21,current:97.64,sl:95.75,tp:97.10,size:.18,risk:.35,pnl:86,status:'ACTIVE',opened:'14:16'}];
export const allPairs=['EURUSD','EURGBP','EURJPY','EURCHF','EURCAD','EURAUD','EURNZD','GBPUSD','GBPJPY','GBPCHF','GBPCAD','GBPAUD','GBPNZD','USDJPY','USDCHF','USDCAD','AUDUSD','AUDJPY','AUDCHF','AUDCAD','AUDNZD','NZDUSD','NZDJPY','NZDCHF','NZDCAD','CADJPY','CADCHF','CHFJPY','XAUUSD'];
