/** Portable repository contracts — implementations live in Node scripts / future server. */

export interface InstrumentRecord {
  symbol: string;
  assetClass: 'FX' | 'METAL';
  baseCurrency: string;
  quoteCurrency: string;
  digits: number;
  pipSize: number;
  enabled: boolean;
}

export interface InstrumentRepository {
  list(): Promise<InstrumentRecord[]> | InstrumentRecord[];
  get(symbol: string): Promise<InstrumentRecord | null> | InstrumentRecord | null;
  count(): Promise<number> | number;
}

export interface SystemSettingsRepository {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
}

export interface AuditRepository {
  append(entry: {
    action: string;
    entityType: string;
    entityId?: string;
    details?: unknown;
    severity?: string;
    actorUserId?: string;
  }): Promise<void> | void;
}

export interface DataAccessLayer {
  mode: 'LOCAL_WRITABLE' | 'VERCEL_READONLY' | 'UNKNOWN' | 'UNAVAILABLE';
  writable: boolean;
  instruments: InstrumentRepository;
  settings: SystemSettingsRepository;
  audit: AuditRepository;
}
