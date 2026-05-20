import { spawn } from "node:child_process";
import net from "node:net";

const bridgePort = await resolveBridgePort();
const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? `http://localhost:${bridgePort}`;

const sharedEnv = {
  ...process.env,
  MT5_BRIDGE_PORT: String(bridgePort),
  NEXT_PUBLIC_MT5_BRIDGE_URL: bridgeUrl,
};

const children = [
  startProcess({
    name: "mt5-bridge",
    command: process.execPath,
    args: ["mt5/bridge/server.mjs"],
    env: sharedEnv,
  }),
  startProcess({
    name: "dashboard",
    command: commandRunner(),
    args: commandRunnerArgs("npm.cmd", ["run", "dev"]),
    env: sharedEnv,
  }),
];

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
});

function startProcess(processConfig) {
  const child = spawn(processConfig.command, processConfig.args, {
    cwd: process.cwd(),
    env: processConfig.env ?? process.env,
    shell: false,
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout.on("data", (data) => {
    writePrefixed(processConfig.name, data);
  });

  child.stderr.on("data", (data) => {
    writePrefixed(processConfig.name, data);
  });

  child.on("exit", (code, signal) => {
    if (code === 0 || signal) {
      return;
    }

    console.error(`[${processConfig.name}] exited with code ${code}`);
    shutdown();
  });

  return child;
}

function writePrefixed(name, data) {
  const lines = data.toString().split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    console.log(`[${name}] ${line}`);
  }
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }

  process.exit(0);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function commandRunner() {
  return process.platform === "win32" ? "cmd.exe" : npmCommand();
}

function commandRunnerArgs(command, args) {
  if (process.platform !== "win32") {
    return args;
  }

  return ["/d", "/s", "/c", command, ...args];
}

async function resolveBridgePort() {
  const configured = process.env.MT5_BRIDGE_PORT;
  const desiredPort = Number(configured ?? 8787);
  if (configured) {
    return desiredPort;
  }

  const port = await findAvailablePort(desiredPort, 20);
  if (port !== desiredPort) {
    console.log(`[mt5-bridge] Port ${desiredPort} is busy. Using ${port}.`);
  }
  return port;
}

function findAvailablePort(startPort, attempts) {
  return new Promise((resolve, reject) => {
    let current = startPort;

    const tryNext = () => {
      if (current >= startPort + attempts) {
        reject(new Error(`No available ports in range ${startPort}-${startPort + attempts - 1}`));
        return;
      }
      isPortAvailable(current).then((ok) => {
        if (ok) {
          resolve(current);
          return;
        }
        current += 1;
        tryNext();
      }).catch(reject);
    };

    tryNext();
  });
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.on("error", () => resolve(false));
    tester.listen(port, () => {
      tester.close(() => resolve(true));
    });
  });
}
