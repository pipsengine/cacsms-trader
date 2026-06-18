import { randomUUID } from 'node:crypto';

import { queryPostgres } from './postgres';

export type PairSelectionEventType =
  | 'scan_started'
  | 'scan_completed'
  | 'symbol_selected'
  | 'symbol_rejected'
  | 'symbol_blocked_correlation'
  | 'symbol_deferred_correlation'
  | 'symbol_blocked_limit'
  | 'symbol_filtered';

export interface PairSelectionEvent {
  id: string;
  eventType: PairSelectionEventType;
  symbol: string | null;
  selected: boolean;
  message: string;
  reasons: string[];
  metadata: Record<string, unknown>;
  selectionId: string | null;
  createdAt: string;
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS pair_selection_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  symbol TEXT,
  selected BOOLEAN NOT NULL DEFAULT false,
  message TEXT NOT NULL,
  reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  selection_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pair_selection_events_created ON pair_selection_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pair_selection_events_selection ON pair_selection_events(selection_id);
`;

let schemaReady: Promise<void> | null = null;

export async function ensurePairSelectionAuditSchema() {
  if (!schemaReady) {
    schemaReady = queryPostgres(schemaSql).then(() => undefined);
  }
  return schemaReady;
}

export type PairSelectionEventInput = {
  eventType: PairSelectionEventType;
  symbol?: string | null;
  selected?: boolean;
  message: string;
  reasons?: string[];
  metadata?: Record<string, unknown>;
  selectionId?: string | null;
};

export async function logPairSelectionEvent(input: PairSelectionEventInput) {
  const [id] = await logPairSelectionEventsBatch([input]);
  return id;
}

export async function logPairSelectionEventsBatch(inputs: PairSelectionEventInput[]) {
  if (inputs.length === 0) return [] as string[];
  await ensurePairSelectionAuditSchema();
  const ids = inputs.map(() => randomUUID());
  const values: Array<string | boolean | null> = [];
  const placeholders = inputs.map((input, index) => {
    const offset = index * 8;
    values.push(
      ids[index],
      input.eventType,
      input.symbol ?? null,
      Boolean(input.selected),
      input.message,
      JSON.stringify(input.reasons ?? []),
      JSON.stringify(input.metadata ?? {}),
      input.selectionId ?? null,
    );
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6}::jsonb,$${offset + 7}::jsonb,$${offset + 8})`;
  });
  await queryPostgres(
    `INSERT INTO pair_selection_events (id, event_type, symbol, selected, message, reasons_json, metadata_json, selection_id)
     VALUES ${placeholders.join(',')}`,
    values,
  );
  return ids;
}

export async function listPairSelectionEvents(limit = 30): Promise<PairSelectionEvent[]> {
  await ensurePairSelectionAuditSchema();
  const result = await queryPostgres(
    `SELECT * FROM pair_selection_events ORDER BY created_at DESC LIMIT $1`,
    [Math.min(200, Math.max(1, limit))],
  );
  return result.rows.map(mapEvent);
}

export async function listPairSelectionHistory(input?: { limit?: number; offset?: number }) {
  await ensurePairSelectionAuditSchema();
  const limit = Math.min(200, Math.max(1, input?.limit ?? 50));
  const offset = Math.max(0, input?.offset ?? 0);
  const [events, selections] = await Promise.all([
    queryPostgres(
      `SELECT * FROM pair_selection_events ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    queryPostgres(
      `SELECT id, selected_symbol, selected_symbols_json, session, source, composite_score, created_at
       FROM autonomous_pair_selections ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
  ]);
  return {
    events: events.rows.map(mapEvent),
    selections: selections.rows.map((row) => ({
      id: String(row.id),
      selectedSymbol: String(row.selected_symbol),
      selectedSymbols: Array.isArray(row.selected_symbols_json) ? row.selected_symbols_json.map(String) : [],
      session: String(row.session ?? ''),
      source: String(row.source ?? ''),
      compositeScore: row.composite_score == null ? null : Number(row.composite_score),
      createdAt: String(row.created_at),
    })),
  };
}

function mapEvent(row: Record<string, unknown>): PairSelectionEvent {
  return {
    id: String(row.id),
    eventType: String(row.event_type) as PairSelectionEventType,
    symbol: row.symbol ? String(row.symbol) : null,
    selected: Boolean(row.selected),
    message: String(row.message),
    reasons: Array.isArray(row.reasons_json) ? row.reasons_json.map(String) : [],
    metadata: (row.metadata_json as Record<string, unknown>) ?? {},
    selectionId: row.selection_id ? String(row.selection_id) : null,
    createdAt: String(row.created_at),
  };
}
