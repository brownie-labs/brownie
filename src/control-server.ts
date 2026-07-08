import { chmod, unlink } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import type { AgentController } from "./control.js";
import {
  parseControlRequest,
  type ControlRequest,
  type ControlResponse,
  type ControlStatus,
  type ControlTarget,
} from "./control-protocol.js";

const CONNECTION_TIMEOUT_MS = 5_000;

export class AlreadyRunningError extends Error {
  constructor(pid: number | undefined) {
    super(
      pid === undefined
        ? "brownie is already running in this project."
        : `brownie is already running in this project (pid ${String(pid)}).`,
    );
    this.name = "AlreadyRunningError";
  }
}

export interface ControlServerDeps {
  socketPath: string;
  buildStatus(): ControlStatus;
  controls: {
    monitor: Pick<AgentController, "pause" | "resume">;
    executor: Pick<AgentController, "pause" | "resume">;
  };
  signal: AbortSignal;
}

export interface ControlServerHandle {
  close(): Promise<void>;
}

interface WorkerProbe {
  running: boolean;
  pid?: number | undefined;
}

function probeExistingWorker(socketPath: string): Promise<WorkerProbe> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    let buffer = "";
    let connected = false;
    const finish = (pid?: number): void => {
      socket.destroy();
      resolve({ running: connected, pid });
    };
    socket.setTimeout(CONNECTION_TIMEOUT_MS, () => {
      finish();
    });
    socket.on("error", () => {
      finish();
    });
    socket.on("close", () => {
      finish();
    });
    socket.on("connect", () => {
      connected = true;
      socket.write(`${JSON.stringify({ cmd: "status" })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as ControlResponse;
        finish(response.data?.pid);
      } catch {
        finish();
      }
    });
  });
}

function applyControl(
  deps: ControlServerDeps,
  action: "pause" | "resume",
  target: ControlTarget,
): void {
  const agents =
    target === "all" ? (["monitor", "executor"] as const) : ([target] as const);
  for (const agent of agents) deps.controls[agent][action]();
}

function handleRequest(
  deps: ControlServerDeps,
  request: ControlRequest,
): ControlResponse {
  switch (request.cmd) {
    case "status":
      return { ok: true, data: deps.buildStatus() };
    case "pause":
    case "resume":
      applyControl(deps, request.cmd, request.agent);
      return { ok: true };
  }
}

function serveConnection(deps: ControlServerDeps, socket: Socket): void {
  let buffer = "";
  socket.setTimeout(CONNECTION_TIMEOUT_MS, () => {
    socket.destroy();
  });
  socket.on("error", () => {
    socket.destroy();
  });
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    const request = parseControlRequest(buffer.slice(0, newline));
    const response: ControlResponse =
      request === null
        ? { ok: false, error: "Unrecognized control request." }
        : handleRequest(deps, request);
    socket.end(`${JSON.stringify(response)}\n`);
  });
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  if (process.platform === "win32") return;
  await unlink(socketPath).catch(() => undefined);
}

export async function startControlServer(
  deps: ControlServerDeps,
): Promise<ControlServerHandle> {
  const existing = await probeExistingWorker(deps.socketPath);
  if (existing.running) throw new AlreadyRunningError(existing.pid);
  await removeStaleSocket(deps.socketPath);

  const server: Server = createServer((socket) => {
    serveConnection(deps, socket);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(deps.socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  if (process.platform !== "win32") {
    await chmod(deps.socketPath, 0o600).catch(() => undefined);
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await removeStaleSocket(deps.socketPath);
  };

  deps.signal.addEventListener("abort", () => void close(), { once: true });

  return { close };
}
