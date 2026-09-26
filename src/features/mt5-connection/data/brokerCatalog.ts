/** Known MT5 brokers and their common trade servers (extensible catalog). */
export type BrokerCatalogEntry = {
  id: string;
  name: string;
  kind: 'RETAIL' | 'PROP' | 'DEMO';
  servers: string[];
};

export const MT5_BROKER_CATALOG: BrokerCatalogEntry[] = [
  {
    id: 'metaquotes-demo',
    name: 'MetaQuotes-Demo',
    kind: 'DEMO',
    servers: ['MetaQuotes-Demo', 'MetaQuotes-Demo2'],
  },
  {
    id: 'ic-markets',
    name: 'IC Markets',
    kind: 'RETAIL',
    servers: ['ICMarketsSC-Demo', 'ICMarketsSC-MT5', 'ICMarketsSC-MT5-2', 'ICMarketsEU-MT5'],
  },
  {
    id: 'exness',
    name: 'Exness',
    kind: 'RETAIL',
    servers: ['Exness-MT5Trial', 'Exness-MT5Real', 'Exness-MT5Real2', 'Exness-MT5Real3', 'Exness-MT5Real4'],
  },
  {
    id: 'fxtm',
    name: 'FXTM',
    kind: 'RETAIL',
    servers: ['FXTM-Demo', 'FXTM-MT5Real', 'FXTM-MT5Standard'],
  },
  {
    id: 'xm',
    name: 'XM',
    kind: 'RETAIL',
    servers: ['XMGlobal-MT5', 'XMGlobal-MT5 2', 'XMTrading-MT5', 'XMTrading-MT5 2'],
  },
  {
    id: 'pepperstone',
    name: 'Pepperstone',
    kind: 'RETAIL',
    servers: ['Pepperstone-Demo', 'Pepperstone-MT5-Live', 'Pepperstone-MT5-Live01'],
  },
  {
    id: 'fbs',
    name: 'FBS',
    kind: 'RETAIL',
    servers: ['FBS-Demo', 'FBS-Real', 'FBS-MT5Real'],
  },
  {
    id: 'deriv',
    name: 'Deriv',
    kind: 'RETAIL',
    servers: ['Deriv-Demo', 'DerivSVG-Server', 'DerivSVG-Server-02'],
  },
  {
    id: 'ftmo',
    name: 'FTMO',
    kind: 'PROP',
    servers: ['FTMO-Demo', 'FTMO-Server', 'FTMO-Server2', 'FTMO-Server3'],
  },
  {
    id: 'fundednext',
    name: 'FundedNext',
    kind: 'PROP',
    servers: ['FundedNext-Server', 'FundedNext-Server02', 'FundedNext-Demo'],
  },
  {
    id: 'the-funded-trader',
    name: 'The Funded Trader',
    kind: 'PROP',
    servers: ['TFT-Demo', 'TFT-Server', 'TFT-Server2'],
  },
  {
    id: 'fundingpips',
    name: 'FundingPips',
    kind: 'PROP',
    servers: ['FundingPips-Demo', 'FundingPips-Live'],
  },
  {
    id: 'nigeria-broker',
    name: 'Nigeria Broker',
    kind: 'RETAIL',
    servers: ['Live-NGN', 'Live-NGN-02', 'Demo-NGN'],
  },
  {
    id: 'global-broker',
    name: 'Global Broker',
    kind: 'RETAIL',
    servers: ['Live-01', 'Live-02', 'Demo-MT5'],
  },
];

export function brokersForAccountClass(accountClass: 'DEMO' | 'LIVE' | 'PROP') {
  if (accountClass === 'PROP') return MT5_BROKER_CATALOG.filter((b) => b.kind === 'PROP' || b.kind === 'DEMO');
  if (accountClass === 'DEMO') return MT5_BROKER_CATALOG.filter((b) => b.kind === 'DEMO' || b.servers.some((s) => /demo/i.test(s)));
  return MT5_BROKER_CATALOG.filter((b) => b.kind !== 'DEMO');
}

export function serversForBroker(brokerName: string) {
  const entry = MT5_BROKER_CATALOG.find((b) => b.name === brokerName);
  return entry?.servers ?? [];
}
