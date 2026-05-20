import { spawn } from "node:child_process";

const processes = [
  {
    name: "mt5-bridge",
    command: process.execPath,
    args: ["mt5/bridge/server.mjs"],
  },
  {
    name: "dashboard",
    command: commandRunner(),
    args: commandRunnerArgs("npm.cmd", ["run", "dev"]),
  },
];

const children = processes.map(startProcess);

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
    env: process.env,
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
