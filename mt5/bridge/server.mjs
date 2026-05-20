import http from "node:http";

const PORT = Number(process.env.MT5_BRIDGE_PORT ?? 8787);
const HEARTBEAT_TIMEOUT_MS = Number(process.env.MT5_HEARTBEAT_TIMEOUT_MS ?? 15000);
const DEGRADED_LATENCY_MS = Number(process.env.MT5_DEGRADED_LATENCY_MS ?? 2500);
const MAX_EVENT_COUNT = Number(process.env.MT5_BRIDGE_MAX_EVENTS ?? 300);
const MAX_TERMINAL_HISTORY = Number(process.env.MT5_BRIDGE_TERMINAL_HISTORY ?? 100);
const SHARED_SECRET = process.env.MT5_BRIDGE_SHARED_SECRET ?? "";

const terminals = new Map();
const events = [];
const startedAt = new Date();

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        mode: "demo",
        service: "cacsms-mt5-bridge",
        heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
        degradedLatencyMs: DEGRADED_LATENCY_MS,
        terminalCount: terminals.size,
        connectedTerminalCount: listTerminalViews().filter((terminal) => terminal.status === "connected").length,
        degradedTerminalCount: listTerminalViews().filter((terminal) => terminal.status === "degraded").length,
        disconnectedTerminalCount: listTerminalViews().filter((terminal) => terminal.status === "disconnected").length,
        uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
        serverTime: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/terminals") {
      sendJson(response, 200, {
        terminals: listTerminalViews(),
        events: events.slice(-50).reverse(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/terminal-operations") {
      const terminalViews = listTerminalViews();
      sendJson(response, 200, {
        ok: true,
        service: "cacsms-mt5-bridge",
        mode: "terminal-operations",
        heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
        degradedLatencyMs: DEGRADED_LATENCY_MS,
        server: {
          startedAt: startedAt.toISOString(),
          uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
          serverTime: new Date().toISOString(),
        },
        summary: summarizeTerminals(terminalViews),
        terminals: terminalViews,
        events: events.slice(-100).reverse(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/terminals/")) {
      const terminalId = decodeURIComponent(url.pathname.replace("/terminals/", ""));
      const terminal = terminals.get(terminalId);
      if (!terminal) {
        sendJson(response, 404, { ok: false, error: "Terminal not found", terminalId });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        terminal: toTerminalView(terminal),
        history: terminal.history.slice(-MAX_TERMINAL_HISTORY).reverse(),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/heartbeat") {
      assertAuthorized(request);
      const payload = await readJson(request);
      const existing = terminals.get(requiredString(payload.terminalId, "terminalId"));
      const heartbeat = normalizeHeartbeat(payload, existing);
      terminals.set(heartbeat.terminalId, heartbeat);
      pushEvent("HEARTBEAT", `Received heartbeat from ${heartbeat.terminalId} (${heartbeat.latencyMs}ms latency, sequence ${heartbeat.sequence}).`);
      sendJson(response, 200, {
        ok: true,
        terminalId: heartbeat.terminalId,
        receivedAt: heartbeat.receivedAt,
        sequence: heartbeat.sequence,
        serverTime: heartbeat.receivedAt,
        heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
      });
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected bridge error";
    pushEvent("ERROR", message);
    sendJson(response, 400, { ok: false, error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Cacsms MT5 bridge listening on http://localhost:${PORT}`);
  console.log("Mode: broker demo account readiness. Live order execution is disabled.");
});

function normalizeHeartbeat(payload, existing) {
  const now = new Date().toISOString();
  const terminalId = requiredString(payload.terminalId, "terminalId");
  const previousSequence = Number(existing?.sequence ?? 0);
  const sequence = Number.isFinite(Number(payload.sequence)) ? Number(payload.sequence) : previousSequence + 1;
  const latencyMs = resolveLatencyMs(payload, now);
  const historyItem = {
    sequence,
    receivedAt: now,
    latencyMs,
    balance: finiteNumber(payload.balance, "balance"),
    equity: finiteNumber(payload.equity, "equity"),
    openOrders: Number(payload.openOrders ?? 0),
  };
  const history = [...(existing?.history ?? []), historyItem].slice(-MAX_TERMINAL_HISTORY);

  return {
    terminalId,
    computerName: String(payload.computerName ?? ""),
    accountNumber: String(payload.accountNumber ?? ""),
    brokerName: String(payload.brokerName ?? ""),
    serverName: String(payload.serverName ?? ""),
    balance: historyItem.balance,
    equity: historyItem.equity,
    margin: finiteNumber(payload.margin, "margin"),
    freeMargin: finiteNumber(payload.freeMargin, "freeMargin"),
    openOrders: historyItem.openOrders,
    lastTickTime: String(payload.lastTickTime ?? now),
    mt5ServerTime: String(payload.mt5ServerTime ?? now),
    terminalTime: String(payload.terminalTime ?? now),
    sentAt: String(payload.sentAt ?? ""),
    latencyMs,
    heartbeatIntervalSeconds: Number(payload.heartbeatIntervalSeconds ?? 0),
    sequence,
    missedSequenceCount: calculateMissedSequenceCount(existing, sequence),
    version: String(payload.version ?? "unknown"),
    receivedAt: now,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastStatus: existing ? toTerminalView(existing).status : "new",
    history,
  };
}

function toTerminalView(heartbeat) {
  const heartbeatAgeMs = Date.now() - new Date(heartbeat.receivedAt).getTime();
  const status = resolveTerminalStatus(heartbeat, heartbeatAgeMs);
  const averageLatencyMs = calculateAverageLatency(heartbeat.history);
  const jitterMs = calculateJitter(heartbeat.history);

  return {
    ...heartbeat,
    status,
    heartbeatAgeMs,
    averageLatencyMs,
    jitterMs,
    stabilityScore: calculateStabilityScore({
      status,
      heartbeatAgeMs,
      latencyMs: heartbeat.latencyMs,
      averageLatencyMs,
      jitterMs,
      missedSequenceCount: heartbeat.missedSequenceCount,
    }),
  };
}

function listTerminalViews() {
  return Array.from(terminals.values()).map(toTerminalView).sort((a, b) => a.terminalId.localeCompare(b.terminalId));
}

function summarizeTerminals(terminalViews) {
  return {
    total: terminalViews.length,
    connected: terminalViews.filter((terminal) => terminal.status === "connected").length,
    degraded: terminalViews.filter((terminal) => terminal.status === "degraded").length,
    disconnected: terminalViews.filter((terminal) => terminal.status === "disconnected").length,
    averageLatencyMs: calculateAverageLatency(terminalViews),
    lowestStabilityScore: terminalViews.length
      ? Math.min(...terminalViews.map((terminal) => terminal.stabilityScore))
      : 0,
  };
}

function resolveTerminalStatus(heartbeat, heartbeatAgeMs) {
  if (heartbeatAgeMs > HEARTBEAT_TIMEOUT_MS) {
    return "disconnected";
  }

  if (heartbeat.latencyMs > DEGRADED_LATENCY_MS || calculateJitter(heartbeat.history) > DEGRADED_LATENCY_MS) {
    return "degraded";
  }

  return "connected";
}

function resolveLatencyMs(payload, receivedAt) {
  const explicitLatency = Number(payload.latencyMs);
  if (Number.isFinite(explicitLatency) && explicitLatency >= 0) {
    return Math.round(explicitLatency);
  }

  const sentAt = Date.parse(String(payload.sentAt ?? ""));
  const receivedAtMs = Date.parse(receivedAt);
  if (Number.isFinite(sentAt) && Number.isFinite(receivedAtMs)) {
    return Math.max(0, receivedAtMs - sentAt);
  }

  return 0;
}

function calculateAverageLatency(items) {
  if (!items.length) {
    return 0;
  }

  const total = items.reduce((sum, item) => sum + Number(item.latencyMs ?? 0), 0);
  return Math.round(total / items.length);
}

function calculateJitter(history) {
  if (history.length < 2) {
    return 0;
  }

  const recent = history.slice(-20);
  const average = calculateAverageLatency(recent);
  const variance = recent.reduce((sum, item) => sum + Math.abs(item.latencyMs - average), 0) / recent.length;
  return Math.round(variance);
}

function calculateMissedSequenceCount(existing, sequence) {
  if (!existing || !Number.isFinite(existing.sequence)) {
    return 0;
  }

  const missed = Math.max(0, sequence - existing.sequence - 1);
  return Number(existing.missedSequenceCount ?? 0) + missed;
}

function calculateStabilityScore(input) {
  if (input.status === "disconnected") {
    return 0;
  }

  const latencyPenalty = Math.min(35, Math.round(input.averageLatencyMs / 100));
  const jitterPenalty = Math.min(25, Math.round(input.jitterMs / 100));
  const heartbeatPenalty = Math.min(25, Math.round(input.heartbeatAgeMs / 1000));
  const sequencePenalty = Math.min(15, input.missedSequenceCount * 3);
  const degradedPenalty = input.status === "degraded" ? 15 : 0;
  return Math.max(0, 100 - latencyPenalty - jitterPenalty - heartbeatPenalty - sequencePenalty - degradedPenalty);
}

function assertAuthorized(request) {
  if (!SHARED_SECRET) {
    return;
  }

  const providedSecret = request.headers["x-cacsms-secret"];
  if (providedSecret !== SHARED_SECRET) {
    throw new Error("Unauthorized heartbeat: invalid bridge secret.");
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error("Payload too large."));
      }
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON payload."));
      }
    });

    request.on("error", reject);
  });
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${name}.`);
  }

  return value.trim();
}

function finiteNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric field: ${name}.`);
  }

  return parsed;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Cacsms-Secret");
}

function pushEvent(type, message) {
  events.push({
    type,
    message,
    time: new Date().toISOString(),
  });

  if (events.length > MAX_EVENT_COUNT) {
    events.splice(0, events.length - MAX_EVENT_COUNT);
  }
}
