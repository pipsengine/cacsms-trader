import http from "node:http";

const PORT = Number(process.env.MT5_BRIDGE_PORT ?? 8787);
const HEARTBEAT_TIMEOUT_MS = Number(process.env.MT5_HEARTBEAT_TIMEOUT_MS ?? 15000);
const SHARED_SECRET = process.env.MT5_BRIDGE_SHARED_SECRET ?? "";

const terminals = new Map();
const events = [];

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
        terminalCount: terminals.size,
        serverTime: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/terminals") {
      sendJson(response, 200, {
        terminals: Array.from(terminals.values()).map(toTerminalView),
        events: events.slice(-50).reverse(),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/heartbeat") {
      assertAuthorized(request);
      const payload = await readJson(request);
      const heartbeat = normalizeHeartbeat(payload);
      terminals.set(heartbeat.terminalId, heartbeat);
      pushEvent("HEARTBEAT", `Received heartbeat from ${heartbeat.terminalId}`);
      sendJson(response, 200, {
        ok: true,
        terminalId: heartbeat.terminalId,
        receivedAt: heartbeat.receivedAt,
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

function normalizeHeartbeat(payload) {
  const now = new Date().toISOString();
  const terminalId = requiredString(payload.terminalId, "terminalId");

  return {
    terminalId,
    accountNumber: String(payload.accountNumber ?? ""),
    brokerName: String(payload.brokerName ?? ""),
    serverName: String(payload.serverName ?? ""),
    balance: finiteNumber(payload.balance, "balance"),
    equity: finiteNumber(payload.equity, "equity"),
    margin: finiteNumber(payload.margin, "margin"),
    freeMargin: finiteNumber(payload.freeMargin, "freeMargin"),
    openOrders: Number(payload.openOrders ?? 0),
    lastTickTime: String(payload.lastTickTime ?? now),
    mt5ServerTime: String(payload.mt5ServerTime ?? now),
    terminalTime: String(payload.terminalTime ?? now),
    latencyMs: Number(payload.latencyMs ?? 0),
    version: String(payload.version ?? "unknown"),
    receivedAt: now,
  };
}

function toTerminalView(heartbeat) {
  const heartbeatAgeMs = Date.now() - new Date(heartbeat.receivedAt).getTime();
  const status = heartbeatAgeMs > HEARTBEAT_TIMEOUT_MS ? "disconnected" : "connected";

  return {
    ...heartbeat,
    status,
    heartbeatAgeMs,
  };
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

  if (events.length > 200) {
    events.shift();
  }
}
