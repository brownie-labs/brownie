import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { formatSessionEvent, type SessionEventSink } from "./session-events.js";

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function dayStamp(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function clockStamp(now: Date): string {
  return `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
}

function timeStamp(now: Date): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

function safeName(value: string): string {
  return value.replace(/[^\w.-]+/g, "_");
}

export class SessionLog {
  private stream: WriteStream | null = null;
  private readonly closing: Promise<void>[] = [];

  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  readonly sink: SessionEventSink = (event) => {
    if (event.type === "partial") return;
    const at = this.now();
    const stream =
      event.type === "init"
        ? this.openSession(at, event.sessionId)
        : (this.stream ?? this.openSession(at, "nieznana"));
    const prefix = `[${timeStamp(at)}]`;
    for (const line of formatSessionEvent(event).split("\n")) {
      stream.write(`${prefix} ${line}\n`);
    }
  };

  async close(): Promise<void> {
    if (this.stream) this.endStream(this.stream);
    this.stream = null;
    await Promise.all(this.closing.splice(0));
  }

  private openSession(at: Date, sessionId: string): WriteStream {
    if (this.stream) this.endStream(this.stream);
    const dayDir = join(this.dir, dayStamp(at));
    mkdirSync(dayDir, { recursive: true });
    this.stream = createWriteStream(
      join(dayDir, `${clockStamp(at)}-${safeName(sessionId)}.log`),
      { flags: "a" },
    );
    return this.stream;
  }

  private endStream(stream: WriteStream): void {
    this.closing.push(new Promise((resolve) => stream.end(() => resolve())));
  }
}

export function teeSession<R extends { session: SessionEventSink }>(
  reporter: R,
  extra: SessionEventSink,
): R {
  return {
    ...reporter,
    session: (event) => {
      reporter.session(event);
      extra(event);
    },
  };
}
