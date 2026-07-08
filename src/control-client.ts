import { connect } from "node:net";
import type { ControlRequest, ControlResponse } from "./control-protocol.js";

const REQUEST_TIMEOUT_MS = 5_000;

export class WorkerNotRunningError extends Error {
  constructor() {
    super("No brownie worker is running in this project.");
    this.name = "WorkerNotRunningError";
  }
}

export interface ControlRequestOptions {
  timeoutMs?: number | undefined;
}

export function sendControlRequest(
  socketPath: string,
  request: ControlRequest,
  options: ControlRequestOptions = {},
): Promise<ControlResponse> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    const succeed = (response: ControlResponse): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(response);
    };
    socket.setTimeout(timeoutMs, () => {
      fail(new Error("Timed out waiting for the worker to respond."));
    });
    socket.on("error", () => {
      fail(new WorkerNotRunningError());
    });
    socket.on("close", () => {
      fail(new WorkerNotRunningError());
    });
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        succeed(JSON.parse(buffer.slice(0, newline)) as ControlResponse);
      } catch {
        fail(new Error("Received a malformed response from the worker."));
      }
    });
  });
}
