import { calculateLotSize } from "../../../packages/risk-core";
import type { ExecutionAck, LotSizeInput, LotSizeResult, TradeIntent } from "../../../packages/shared-types";

export interface ExecutionCommand {
  commandId: string;
  intent: TradeIntent;
  payload: {
    symbol: string;
    side: TradeIntent["side"];
    orderKind: TradeIntent["orderKind"];
    volumeLots: number;
    stopLoss: number;
    takeProfit: number;
  };
  preparedAt: string;
}

export interface StopTargetInput {
  side: "buy" | "sell";
  entryPrice: number;
  stopDistance: number;
  rewardRiskRatio: number;
}

export class ExecutionEngine {
  prepareOrder(intent: TradeIntent, now = new Date()): ExecutionCommand {
    return {
      commandId: `${intent.intentId}-command`,
      intent,
      payload: {
        symbol: intent.symbol,
        side: intent.side,
        orderKind: intent.orderKind,
        volumeLots: intent.requestedVolumeLots,
        stopLoss: intent.stopLoss,
        takeProfit: intent.takeProfit,
      },
      preparedAt: now.toISOString(),
    };
  }

  calculateLotSize(input: LotSizeInput): LotSizeResult {
    return calculateLotSize(input);
  }

  calculateStopLossTakeProfit(input: StopTargetInput): Pick<TradeIntent, "stopLoss" | "takeProfit"> {
    const direction = input.side === "buy" ? 1 : -1;
    return {
      stopLoss: input.entryPrice - direction * input.stopDistance,
      takeProfit: input.entryPrice + direction * input.stopDistance * input.rewardRiskRatio,
    };
  }

  buildMt5Command(command: ExecutionCommand): string {
    return JSON.stringify({
      commandId: command.commandId,
      type: "PLACE_ORDER",
      payload: command.payload,
    });
  }

  confirmExecution(ack: ExecutionAck): boolean {
    return ack.status === "accepted" || ack.status === "filled";
  }

  shouldRetry(ack: ExecutionAck, attempt: number, maxAttempts = 3): boolean {
    return ["failed", "rejected"].includes(ack.status) && attempt < maxAttempts;
  }
}
