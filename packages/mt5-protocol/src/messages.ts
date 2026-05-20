import type { ExecutionAck, TerminalHeartbeat, TradeIntent } from "../../shared-types";

export type Mt5CommandType =
  | "place_order"
  | "modify_order"
  | "close_order"
  | "partial_close"
  | "move_to_breakeven"
  | "set_trailing_stop"
  | "emergency_close_all"
  | "heartbeat";

export interface Mt5CommandEnvelope<TPayload> {
  commandId: string;
  terminalId: string;
  type: Mt5CommandType;
  payload: TPayload;
  createdAt: string;
  expiresAt: string;
}

export interface ModifyOrderPayload {
  ticket: string;
  stopLoss?: number;
  takeProfit?: number;
}

export interface CloseOrderPayload {
  ticket: string;
  volumeLots?: number;
  reason: string;
}

export type PlaceOrderCommand = Mt5CommandEnvelope<TradeIntent>;
export type ModifyOrderCommand = Mt5CommandEnvelope<ModifyOrderPayload>;
export type CloseOrderCommand = Mt5CommandEnvelope<CloseOrderPayload>;
export type HeartbeatCommand = Mt5CommandEnvelope<TerminalHeartbeat>;

export type Mt5Command = PlaceOrderCommand | ModifyOrderCommand | CloseOrderCommand | HeartbeatCommand;

export interface Mt5BridgeMessage {
  protocolVersion: "1.0";
  messageId: string;
  terminalId: string;
  sentAt: string;
  command?: Mt5Command;
  acknowledgment?: ExecutionAck;
  heartbeat?: TerminalHeartbeat;
}
