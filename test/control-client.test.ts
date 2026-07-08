import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sendControlRequest, WorkerNotRunningError } from "../src/control-client.js";

let socketCounter = 0;

function tempSocketPath(): string {
  socketCounter += 1;
  return join(
    tmpdir(),
    `brownie-client-test-${String(process.pid)}-${String(socketCounter)}.sock`,
  );
}

interface TestServer {
  server: Server;
  close(): Promise<void>;
}

function startServer(
  path: string,
  onConnection: (socket: Socket) => void,
): Promise<TestServer> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      resolve({
        server,
        close: () =>
          new Promise((resolveClose) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => {
              resolveClose();
            });
          }),
      });
    });
  });
}

describe("sendControlRequest", () => {
  let socketPath: string;
  let running: TestServer | null;

  beforeEach(() => {
    socketPath = tempSocketPath();
    running = null;
  });

  afterEach(async () => {
    if (running) await running.close();
  });

  it("sends one JSON line and resolves with the parsed response", async () => {
    const received: string[] = [];
    running = await startServer(socketPath, (socket) => {
      socket.on("data", (chunk) => {
        received.push(chunk.toString("utf8"));
        socket.end('{"ok":true}\n');
      });
    });

    const response = await sendControlRequest(socketPath, {
      cmd: "pause",
      agent: "all",
    });

    expect(response).toEqual({ ok: true });
    expect(received.join("")).toBe('{"cmd":"pause","agent":"all"}\n');
  });

  it("throws WorkerNotRunningError when nothing listens on the socket", async () => {
    await expect(sendControlRequest(socketPath, { cmd: "status" })).rejects.toThrow(
      WorkerNotRunningError,
    );
  });

  it("times out when the worker never responds", async () => {
    running = await startServer(socketPath, () => undefined);

    await expect(
      sendControlRequest(socketPath, { cmd: "status" }, { timeoutMs: 100 }),
    ).rejects.toThrow("Timed out");
  });

  it("rejects a malformed response", async () => {
    running = await startServer(socketPath, (socket) => {
      socket.on("data", () => socket.end("not json\n"));
    });

    await expect(sendControlRequest(socketPath, { cmd: "status" })).rejects.toThrow(
      "malformed response",
    );
  });
});
