import http from "node:http";

const PORT = Number(process.env.MT5_BRIDGE_PORT ?? 8787);
const HEARTBEAT_TIMEOUT_MS = Number(process.env.MT5_HEARTBEAT_TIMEOUT_MS ?? 15000);
const DEGRADED_LATENCY_MS = Number(process.env.MT5_DEGRADED_LATENCY_MS ?? 2500);
const MAX_EVENT_COUNT = Number(process.env.MT5_BRIDGE_MAX_EVENTS ?? 300);
const MAX_TERMINAL_HISTORY = Number(process.env.MT5_BRIDGE_TERMINAL_HISTORY ?? 100);
const MAX_COMMAND_COUNT = Number(process.env.MT5_BRIDGE_MAX_COMMANDS ?? 500);
const MAX_ACK_COUNT = Number(process.env.MT5_BRIDGE_MAX_ACKS ?? 300);
const COMMAND_LEASE_MS = Number(process.env.MT5_COMMAND_LEASE_MS ?? 12000);
const COMMAND_MAX_ATTEMPTS = Number(process.env.MT5_COMMAND_MAX_ATTEMPTS ?? 5);
const SHARED_SECRET = process.env.MT5_BRIDGE_SHARED_SECRET ?? "";

const terminals = new Map();
const registrations = new Map();
const accountRouting = new Map();
const vpsRegistry = new Map();
const commandsById = new Map();
const terminalQueues = new Map();
const acknowledgments = [];
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
        commandCount: commandsById.size,
        uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
        serverTime: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/terminals") {
      sendJson(response, 200, {
        terminals: listTerminalViews(),
        events: events.slice(-50).reverse(),
        registrations: listRegistrationViews(),
        routing: listAccountRoutes(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/terminal-operations") {
      const terminalViews = listTerminalViews();
      const registrationViews = listRegistrationViews();
      const routingViews = listAccountRoutes();
      const commandSummary = summarizeCommands();
      sendJson(response, 200, {
        ok: true,
        service: "cacsms-mt5-bridge",
        mode: "terminal-operations",
        heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
        degradedLatencyMs: DEGRADED_LATENCY_MS,
        commandLeaseMs: COMMAND_LEASE_MS,
        server: {
          startedAt: startedAt.toISOString(),
          uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
          serverTime: new Date().toISOString(),
        },
        summary: {
          terminals: summarizeTerminals(terminalViews),
          registrations: {
            total: registrationViews.length,
            computers: Array.from(new Set(registrationViews.map((registration) => registration.computerId).filter(Boolean))).length,
          },
          routing: {
            totalAccounts: routingViews.length,
          },
          commands: commandSummary.summary,
        },
        terminals: terminalViews,
        registrations: registrationViews,
        routing: routingViews,
        vps: listVpsViews(),
        commands: commandSummary,
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
      if (!registrations.has(heartbeat.terminalId)) {
        const registration = normalizeRegistration({
          terminalId: heartbeat.terminalId,
          computerId: heartbeat.computerId,
          computerName: heartbeat.computerName,
          accountNumber: heartbeat.accountNumber,
          brokerName: heartbeat.brokerName,
          serverName: heartbeat.serverName,
          priority: 50,
          vpsId: heartbeat.vpsId,
        });
        registrations.set(heartbeat.terminalId, registration);
      }
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

    if (request.method === "POST" && url.pathname === "/terminals/register") {
      assertAuthorized(request);
      const payload = await readJson(request);
      const registration = normalizeRegistration(payload, registrations.get(String(payload.terminalId ?? "")));
      registrations.set(registration.terminalId, registration);
      pushEvent("REGISTER", `Registered terminal ${registration.terminalId} (computer ${registration.computerId}, account ${registration.accountNumber}, priority ${registration.priority}).`);
      sendJson(response, 200, {
        ok: true,
        registration,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/terminals/registrations") {
      sendJson(response, 200, {
        ok: true,
        registrations: listRegistrationViews(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/routing/accounts") {
      sendJson(response, 200, {
        ok: true,
        accounts: listAccountRoutes(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/routing/accounts/")) {
      const accountNumber = decodeURIComponent(url.pathname.replace("/routing/accounts/", ""));
      sendJson(response, 200, {
        ok: true,
        accountNumber,
        route: resolveAccountRoute(accountNumber),
      });
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/routing/accounts/")) {
      assertAuthorized(request);
      const accountNumber = decodeURIComponent(url.pathname.replace("/routing/accounts/", ""));
      const payload = await readJson(request);
      const route = normalizeAccountRoute(accountNumber, payload);
      accountRouting.set(accountNumber, route);
      pushEvent("ROUTING", `Updated routing for account ${accountNumber}: ${route.preferredTerminalIds.length ? route.preferredTerminalIds.join(",") : "auto"}`);
      sendJson(response, 200, {
        ok: true,
        accountNumber,
        route,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/vps/register") {
      assertAuthorized(request);
      const payload = await readJson(request);
      const vps = normalizeVps(payload, vpsRegistry.get(String(payload.vpsId ?? "")));
      vpsRegistry.set(vps.vpsId, vps);
      pushEvent("VPS", `Registered VPS ${vps.vpsId} (${vps.label ?? "unlabeled"}).`);
      sendJson(response, 200, { ok: true, vps });
      return;
    }

    if (request.method === "GET" && url.pathname === "/vps") {
      sendJson(response, 200, { ok: true, vps: listVpsViews() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/commands/enqueue") {
      assertAuthorized(request);
      const payload = await readJson(request);
      const command = enqueueCommand(payload);
      sendJson(response, 200, { ok: true, command });
      return;
    }

    if (request.method === "GET" && url.pathname === "/commands/next") {
      const terminalId = requiredString(url.searchParams.get("terminalId") ?? "", "terminalId");
      assertAuthorized(request);
      const leased = leaseNextCommand(terminalId);
      sendJson(response, 200, {
        ok: true,
        terminalId,
        serverTime: new Date().toISOString(),
        command: leased ? toCommandEnvelope(leased) : null,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/commands/ack") {
      assertAuthorized(request);
      const payload = await readJson(request);
      const result = acknowledgeCommand(payload);
      sendJson(response, 200, { ok: true, ...result });
      return;
    }

    if (request.method === "GET" && url.pathname === "/commands") {
      const terminalId = url.searchParams.get("terminalId");
      const status = url.searchParams.get("status");
      sendJson(response, 200, {
        ok: true,
        commands: listCommands({ terminalId: terminalId ? String(terminalId) : undefined, status: status ? String(status) : undefined }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/commands/")) {
      const commandId = decodeURIComponent(url.pathname.replace("/commands/", ""));
      const command = commandsById.get(commandId);
      if (!command) {
        sendJson(response, 404, { ok: false, error: "Command not found", commandId });
        return;
      }
      sendJson(response, 200, { ok: true, command });
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
  const computerId = String(payload.computerId ?? payload.computerName ?? "");
  const computerName = String(payload.computerName ?? "");
  const connectionStatus = normalizeConnectionStatus(payload.connectionStatus ?? payload.status ?? existing?.connectionStatus ?? "connected");
  const vpsId = String(payload.vpsId ?? "");
  const lastTickTime = String(payload.lastTickTime ?? now);
  const mt5ServerTime = String(payload.mt5ServerTime ?? now);
  const terminalTime = String(payload.terminalTime ?? now);
  const nigeriaTime = String(payload.nigeriaTime ?? payload.nigeria_time ?? "");
  const historyItem = {
    sequence,
    receivedAt: now,
    latencyMs,
    balance: finiteNumber(payload.balance, "balance"),
    equity: finiteNumber(payload.equity, "equity"),
    openOrders: Number(payload.openOrders ?? 0),
    connectionStatus,
    mt5ServerTime,
    terminalTime,
    nigeriaTime,
  };
  const history = [...(existing?.history ?? []), historyItem].slice(-MAX_TERMINAL_HISTORY);

  return {
    terminalId,
    computerId,
    computerName: String(payload.computerName ?? ""),
    accountNumber: String(payload.accountNumber ?? ""),
    brokerName: String(payload.brokerName ?? ""),
    serverName: String(payload.serverName ?? ""),
    balance: historyItem.balance,
    equity: historyItem.equity,
    margin: finiteNumber(payload.margin, "margin"),
    freeMargin: finiteNumber(payload.freeMargin, "freeMargin"),
    openOrders: historyItem.openOrders,
    connectionStatus,
    lastTickTime,
    mt5ServerTime,
    terminalTime,
    nigeriaTime,
    sentAt: String(payload.sentAt ?? ""),
    latencyMs,
    heartbeatIntervalSeconds: Number(payload.heartbeatIntervalSeconds ?? 0),
    sequence,
    missedSequenceCount: calculateMissedSequenceCount(existing, sequence),
    version: String(payload.version ?? "unknown"),
    vpsId,
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
  const ewmaLatencyMs = calculateEwmaLatency(heartbeat.history);
  const timeDriftMs = calculateTimeDriftMs(heartbeat.mt5ServerTime, heartbeat.receivedAt);
  const terminalTimeDriftMs = calculateTimeDriftMs(heartbeat.terminalTime, heartbeat.receivedAt);
  const nigeriaTimeDriftMs = calculateTimeDriftMs(heartbeat.nigeriaTime, heartbeat.receivedAt);
  const registration = registrations.get(heartbeat.terminalId);

  return {
    ...heartbeat,
    status,
    heartbeatAgeMs,
    averageLatencyMs,
    jitterMs,
    ewmaLatencyMs,
    timeDriftMs,
    terminalTimeDriftMs,
    nigeriaTimeDriftMs,
    registration: registration ? toRegistrationView(registration) : null,
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
  if (heartbeatAgeMs > HEARTBEAT_TIMEOUT_MS || heartbeat.connectionStatus === "disconnected") {
    return "disconnected";
  }

  if (
    heartbeat.latencyMs > DEGRADED_LATENCY_MS
    || calculateJitter(heartbeat.history) > DEGRADED_LATENCY_MS
    || heartbeat.connectionStatus === "degraded"
  ) {
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

function normalizeConnectionStatus(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "connected" || normalized === "degraded" || normalized === "disconnected") {
    return normalized;
  }
  return "connected";
}

function normalizeRegistration(payload, existing) {
  const now = new Date().toISOString();
  const terminalId = requiredString(payload.terminalId, "terminalId");
  const priorityValue = Number(payload.priority ?? existing?.priority ?? 50);
  const priority = Number.isFinite(priorityValue) ? Math.max(0, Math.min(1000, Math.round(priorityValue))) : 50;

  return {
    terminalId,
    computerId: String(payload.computerId ?? existing?.computerId ?? ""),
    computerName: String(payload.computerName ?? existing?.computerName ?? ""),
    accountNumber: String(payload.accountNumber ?? existing?.accountNumber ?? ""),
    brokerName: String(payload.brokerName ?? existing?.brokerName ?? ""),
    serverName: String(payload.serverName ?? existing?.serverName ?? ""),
    priority,
    vpsId: String(payload.vpsId ?? existing?.vpsId ?? ""),
    tags: normalizeStringList(payload.tags ?? existing?.tags ?? []),
    capabilities: normalizeStringList(payload.capabilities ?? existing?.capabilities ?? []),
    notes: String(payload.notes ?? existing?.notes ?? ""),
    registeredAt: existing?.registeredAt ?? now,
    updatedAt: now,
  };
}

function toRegistrationView(registration) {
  return {
    terminalId: registration.terminalId,
    computerId: registration.computerId,
    computerName: registration.computerName,
    accountNumber: registration.accountNumber,
    brokerName: registration.brokerName,
    serverName: registration.serverName,
    priority: registration.priority,
    vpsId: registration.vpsId,
    tags: registration.tags,
    capabilities: registration.capabilities,
    notes: registration.notes,
    registeredAt: registration.registeredAt,
    updatedAt: registration.updatedAt,
  };
}

function listRegistrationViews() {
  return Array.from(registrations.values())
    .map(toRegistrationView)
    .sort((a, b) => a.priority - b.priority || a.terminalId.localeCompare(b.terminalId));
}

function normalizeAccountRoute(accountNumber, payload) {
  const now = new Date().toISOString();
  const preferredTerminalIds = normalizeStringList(payload.preferredTerminalIds ?? payload.preferredTerminalId ?? []);
  const strategy = String(payload.strategy ?? payload.failoverStrategy ?? "priority").toLowerCase();
  const failoverStrategy = strategy === "stability" || strategy === "priority" ? strategy : "priority";
  const minStabilityScoreValue = Number(payload.minStabilityScore ?? 0);
  const minStabilityScore = Number.isFinite(minStabilityScoreValue)
    ? Math.max(0, Math.min(100, Math.round(minStabilityScoreValue)))
    : 0;

  const existing = accountRouting.get(accountNumber);
  return {
    accountNumber,
    preferredTerminalIds,
    failoverStrategy,
    minStabilityScore,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function listAccountRoutes() {
  return Array.from(accountRouting.values()).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

function resolveAccountRoute(accountNumber, now = new Date()) {
  const route = accountRouting.get(accountNumber) ?? normalizeAccountRoute(accountNumber, {});
  const terminalViews = listTerminalViews();
  const byId = new Map(terminalViews.map((terminal) => [terminal.terminalId, terminal]));
  const candidates = [];

  for (const terminalId of route.preferredTerminalIds) {
    const terminal = byId.get(terminalId);
    if (terminal && terminal.status === "connected" && (terminal.stabilityScore ?? 0) >= route.minStabilityScore) {
      candidates.push(terminal);
    }
  }

  if (candidates.length === 0) {
    const autoCandidates = terminalViews.filter((terminal) => (
      terminal.status === "connected"
      && terminal.accountNumber === accountNumber
      && (terminal.stabilityScore ?? 0) >= route.minStabilityScore
    ));

    autoCandidates.sort((a, b) => {
      const registrationA = registrations.get(a.terminalId);
      const registrationB = registrations.get(b.terminalId);
      if (route.failoverStrategy === "stability") {
        const scoreDelta = (b.stabilityScore ?? 0) - (a.stabilityScore ?? 0);
        if (scoreDelta !== 0) return scoreDelta;
      }
      const prioDelta = Number(registrationA?.priority ?? 50) - Number(registrationB?.priority ?? 50);
      if (prioDelta !== 0) return prioDelta;
      return a.terminalId.localeCompare(b.terminalId);
    });

    candidates.push(...autoCandidates);
  }

  const selected = candidates[0];
  return {
    ...route,
    resolvedAt: now.toISOString(),
    selectedTerminalId: selected?.terminalId ?? "",
    selectedReason: selected ? "connected_terminal_selected" : "no_connected_terminal_available",
    candidates: candidates.slice(0, 5).map((terminal) => ({
      terminalId: terminal.terminalId,
      status: terminal.status,
      stabilityScore: terminal.stabilityScore ?? 0,
      latencyMs: terminal.latencyMs,
      priority: registrations.get(terminal.terminalId)?.priority ?? 50,
      computerId: registrations.get(terminal.terminalId)?.computerId ?? terminal.computerId ?? "",
    })),
  };
}

function normalizeVps(payload, existing) {
  const now = new Date().toISOString();
  const vpsId = requiredString(payload.vpsId, "vpsId");
  const status = String(payload.status ?? existing?.status ?? "unknown").toLowerCase();
  const normalizedStatus = status === "online" || status === "offline" || status === "degraded" ? status : "unknown";
  return {
    vpsId,
    label: String(payload.label ?? existing?.label ?? ""),
    provider: String(payload.provider ?? existing?.provider ?? ""),
    region: String(payload.region ?? existing?.region ?? ""),
    ipAddress: String(payload.ipAddress ?? existing?.ipAddress ?? ""),
    status: normalizedStatus,
    notes: String(payload.notes ?? existing?.notes ?? ""),
    registeredAt: existing?.registeredAt ?? now,
    updatedAt: now,
  };
}

function listVpsViews() {
  return Array.from(vpsRegistry.values()).sort((a, b) => a.vpsId.localeCompare(b.vpsId));
}

function enqueueCommand(payload) {
  pruneCommands();
  const now = new Date().toISOString();
  const commandId = requiredString(payload.commandId, "commandId");
  const terminalId = requiredString(payload.terminalId, "terminalId");
  const type = requiredString(payload.type, "type").toLowerCase();
  const allowedTypes = new Set([
    "place_order",
    "modify_order",
    "close_order",
    "partial_close",
    "move_to_breakeven",
    "set_trailing_stop",
    "emergency_close_all",
  ]);
  if (!allowedTypes.has(type)) {
    throw new Error(`Unsupported command type: ${type}.`);
  }
  const createdAt = String(payload.createdAt ?? now);
  const expiresAt = String(payload.expiresAt ?? new Date(Date.now() + 60_000).toISOString());

  const existing = commandsById.get(commandId);
  if (existing) {
    return existing;
  }

  const command = {
    commandId,
    terminalId,
    type,
    payload: payload.payload ?? {},
    createdAt,
    expiresAt,
    status: "queued",
    attempt: 0,
    leasedAt: "",
    leasedUntil: "",
    lastDispatchedAt: "",
    lastAckAt: "",
    ack: null,
    error: "",
  };

  commandsById.set(commandId, command);
  const queue = terminalQueues.get(terminalId) ?? [];
  queue.push(commandId);
  terminalQueues.set(terminalId, queue);
  pushEvent("COMMAND", `Enqueued ${type} for ${terminalId} (${commandId}).`);

  pruneCommands();
  return command;
}

function leaseNextCommand(terminalId) {
  pruneCommands();
  const queue = terminalQueues.get(terminalId) ?? [];
  if (!queue.length) {
    return null;
  }

  const now = Date.now();
  for (const commandId of queue) {
    const command = commandsById.get(commandId);
    if (!command) continue;
    if (isExpired(command, now)) {
      markExpired(command);
      continue;
    }
    if (command.status === "acknowledged" || command.status === "expired" || command.status === "dead") continue;

    const leasedUntilMs = Date.parse(command.leasedUntil || "");
    const leaseActive = command.status === "leased" && Number.isFinite(leasedUntilMs) && leasedUntilMs > now;
    if (leaseActive) continue;

    if (command.attempt >= COMMAND_MAX_ATTEMPTS) {
      command.status = "dead";
      command.error = "Max attempts reached.";
      pushEvent("WARN", `Command ${command.commandId} marked dead after ${command.attempt} attempts.`);
      continue;
    }

    command.attempt += 1;
    command.status = "leased";
    command.leasedAt = new Date(now).toISOString();
    command.leasedUntil = new Date(now + COMMAND_LEASE_MS).toISOString();
    command.lastDispatchedAt = command.leasedAt;
    pushEvent("DISPATCH", `Leased command ${command.commandId} to ${terminalId} (attempt ${command.attempt}).`);
    return command;
  }

  return null;
}

function toCommandEnvelope(command) {
  return {
    commandId: command.commandId,
    terminalId: command.terminalId,
    type: command.type,
    payload: command.payload,
    createdAt: command.createdAt,
    expiresAt: command.expiresAt,
    attempt: command.attempt,
    leaseExpiresAt: command.leasedUntil,
  };
}

function acknowledgeCommand(payload) {
  pruneCommands();
  const commandId = requiredString(payload.commandId, "commandId");
  const terminalId = requiredString(payload.terminalId, "terminalId");
  const status = requiredString(payload.status, "status").toLowerCase();
  const allowedStatuses = new Set(["queued", "sent", "accepted", "rejected", "filled", "failed"]);
  if (!allowedStatuses.has(status)) {
    throw new Error(`Unsupported acknowledgment status: ${status}.`);
  }

  const command = commandsById.get(commandId);
  if (!command) {
    throw new Error(`Unknown commandId: ${commandId}.`);
  }
  if (command.terminalId !== terminalId) {
    throw new Error(`Terminal mismatch for command ${commandId}: expected ${command.terminalId}, got ${terminalId}.`);
  }

  const ack = {
    commandId,
    terminalId,
    status,
    ticket: payload.ticket ? String(payload.ticket) : "",
    brokerMessage: payload.brokerMessage ? String(payload.brokerMessage) : "",
    executedPrice: payload.executedPrice != null ? Number(payload.executedPrice) : null,
    executedVolumeLots: payload.executedVolumeLots != null ? Number(payload.executedVolumeLots) : null,
    latencyMs: payload.latencyMs != null ? Number(payload.latencyMs) : 0,
    receivedAt: String(payload.receivedAt ?? new Date().toISOString()),
  };

  command.status = "acknowledged";
  command.ack = ack;
  command.lastAckAt = ack.receivedAt;
  command.leasedUntil = "";
  command.leasedAt = "";
  acknowledgments.push(ack);
  if (acknowledgments.length > MAX_ACK_COUNT) {
    acknowledgments.splice(0, acknowledgments.length - MAX_ACK_COUNT);
  }

  const queue = terminalQueues.get(terminalId) ?? [];
  terminalQueues.set(terminalId, queue.filter((queuedId) => queuedId !== commandId));
  pushEvent("ACK", `Ack ${ack.status} for ${terminalId} (${commandId})${ack.ticket ? ` ticket ${ack.ticket}` : ""}.`);
  pruneCommands();

  return { command, ack };
}

function listCommands(filter = {}) {
  const items = Array.from(commandsById.values());
  return items
    .filter((command) => (filter.terminalId ? command.terminalId === filter.terminalId : true))
    .filter((command) => (filter.status ? command.status === filter.status : true))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function summarizeCommands() {
  const commands = Array.from(commandsById.values());
  const queued = commands.filter((command) => command.status === "queued").length;
  const leased = commands.filter((command) => command.status === "leased").length;
  const acknowledged = commands.filter((command) => command.status === "acknowledged").length;
  const expired = commands.filter((command) => command.status === "expired").length;
  const dead = commands.filter((command) => command.status === "dead").length;

  return {
    summary: {
      total: commands.length,
      queued,
      leased,
      acknowledged,
      expired,
      dead,
      recentAcks: acknowledgments.slice(-25).reverse(),
    },
    commands: listCommands({}),
    queues: Array.from(terminalQueues.entries()).map(([terminalId, ids]) => ({
      terminalId,
      queuedIds: ids,
    })),
    recentAcks: acknowledgments.slice(-100).reverse(),
  };
}

function pruneCommands() {
  const now = Date.now();
  const ids = Array.from(commandsById.keys());
  for (const id of ids) {
    const command = commandsById.get(id);
    if (!command) continue;
    const tooOld = command.status === "acknowledged" && Date.parse(command.lastAckAt || command.createdAt) < now - 6 * 60_000;
    const expired = isExpired(command, now);
    if (expired && command.status !== "acknowledged") {
      markExpired(command);
    }
    if (tooOld || (command.status === "expired" && Date.parse(command.expiresAt) < now - 10 * 60_000)) {
      commandsById.delete(id);
    }
  }

  if (commandsById.size > MAX_COMMAND_COUNT) {
    const sorted = Array.from(commandsById.values()).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const over = commandsById.size - MAX_COMMAND_COUNT;
    for (const command of sorted.slice(0, over)) {
      commandsById.delete(command.commandId);
    }
  }
}

function isExpired(command, nowMs) {
  const expiresAtMs = Date.parse(command.expiresAt || "");
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

function markExpired(command) {
  if (command.status === "expired") return;
  command.status = "expired";
  command.error = "Expired before execution.";
  pushEvent("WARN", `Command ${command.commandId} expired.`);
}

function normalizeStringList(value) {
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 30);
  }
  return [];
}

function calculateEwmaLatency(history) {
  if (!history.length) return 0;
  const recent = history.slice(-30);
  const alpha = 0.35;
  let ewma = Number(recent[0]?.latencyMs ?? 0);
  for (const item of recent.slice(1)) {
    ewma = alpha * Number(item.latencyMs ?? 0) + (1 - alpha) * ewma;
  }
  return Math.round(ewma);
}

function calculateTimeDriftMs(sourceTime, receivedAt) {
  const sourceMs = Date.parse(String(sourceTime ?? ""));
  const receivedMs = Date.parse(String(receivedAt ?? ""));
  if (!Number.isFinite(sourceMs) || !Number.isFinite(receivedMs)) {
    return null;
  }
  return Math.round(receivedMs - sourceMs);
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
