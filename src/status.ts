import type { SessionEvent, SessionEventSink } from "./session-events.js";
import type { Task } from "./types.js";

export type MonitorPhase =
  | { kind: "starting" }
  | { kind: "offHours"; resumeAt: number }
  | { kind: "session"; cycle: number; startedAt: number }
  | { kind: "sleeping"; nextCycleAt: number };

export type ExecutorPhase =
  | { kind: "waiting" }
  | { kind: "session"; task: Task; startedAt: number }
  | { kind: "backoff"; task: Task; resumeAt: number };

export interface MonitorCycleOutcome {
  cycle: number;
  ok: boolean;
  durationMs: number;
  costUsd?: number | undefined;
  addedTasks: number;
  skippedDuplicates: number;
  error?: string | undefined;
  finishedAt: number;
}

export interface ExecutorTaskOutcome {
  taskId: string;
  title: string;
  ok: boolean;
  durationMs: number;
  costUsd?: number | undefined;
  numTurns?: number | undefined;
  error?: string | undefined;
  willRetry?: boolean | undefined;
  attempt?: number | undefined;
  maxAttempts?: number | undefined;
  finishedAt: number;
}

export interface AgentPanelStatus<Phase, Outcome> {
  phase: Phase;
  tail: readonly string[];
  sessionId?: string | undefined;
  lastOutcome?: Outcome | undefined;
}

export interface WorkerStatus {
  startedAt: number;
  shutdownSignal?: string | undefined;
  monitor: AgentPanelStatus<MonitorPhase, MonitorCycleOutcome>;
  executor: AgentPanelStatus<ExecutorPhase, ExecutorTaskOutcome>;
  tasks: readonly Task[];
}

export interface MonitorReporter {
  offHours(resumeAt: Date): void;
  cycleStarted(cycle: number): void;
  cycleFinished(outcome: Omit<MonitorCycleOutcome, "finishedAt">): void;
  sleepUntil(nextCycleAt: Date): void;
  session: SessionEventSink;
}

export interface ExecutorReporter {
  taskStarted(task: Task): void;
  taskFinished(outcome: Omit<ExecutorTaskOutcome, "finishedAt">): void;
  retryScheduled(task: Task, resumeAt: Date): void;
  waiting(): void;
  session: SessionEventSink;
}

const TAIL_LINE_MAX = 300;

function clipLine(line: string): string {
  return line.length > TAIL_LINE_MAX ? `${line.slice(0, TAIL_LINE_MAX)}…` : line;
}

export function formatSessionEvent(
  event: Exclude<SessionEvent, { type: "partial" }>,
): string {
  switch (event.type) {
    case "init":
      return `init · model=${event.model} · session=${event.sessionId} · narzędzia: ${event.toolCount}`;
    case "text":
      return event.text;
    case "toolUse":
      return `🔧 ${event.name} ${event.input}`;
    case "toolResult":
      return `${event.isError ? "⚠ wynik(błąd)" : "↳ wynik"} ${event.content}`;
    case "raw":
      return `(nie-JSON) ${event.line}`;
    case "stderr":
      return `stderr: ${event.line}`;
    case "killing":
      return `⏹ Zatrzymuję sesję (${event.reason})…`;
    case "procError":
      return `✖ ${event.message}`;
  }
}

interface AgentState<Phase, Outcome> {
  phase: Phase;
  tail: string[];
  openPartial: string;
  partialSeen: boolean;
  sessionId: string | undefined;
  lastOutcome: Outcome | undefined;
}

export interface WorkerStatusStoreOptions {
  tailLimit?: number;
  notifyDelayMs?: number;
}

export class WorkerStatusStore {
  private readonly tailLimit: number;
  private readonly notifyDelayMs: number;
  private readonly startedAt = Date.now();
  private readonly listeners = new Set<() => void>();
  private notifyTimer: NodeJS.Timeout | null = null;
  private shutdownSignal: string | undefined;
  private tasks: readonly Task[] = [];
  private snapshot: WorkerStatus;

  private readonly monitorState: AgentState<MonitorPhase, MonitorCycleOutcome> = {
    phase: { kind: "starting" },
    tail: [],
    openPartial: "",
    partialSeen: false,
    sessionId: undefined,
    lastOutcome: undefined,
  };

  private readonly executorState: AgentState<ExecutorPhase, ExecutorTaskOutcome> = {
    phase: { kind: "waiting" },
    tail: [],
    openPartial: "",
    partialSeen: false,
    sessionId: undefined,
    lastOutcome: undefined,
  };

  readonly monitor: MonitorReporter = {
    offHours: (resumeAt) => {
      this.monitorState.phase = { kind: "offHours", resumeAt: resumeAt.getTime() };
      this.markDirty();
    },
    cycleStarted: (cycle) => {
      this.resetForSession(this.monitorState, {
        kind: "session",
        cycle,
        startedAt: Date.now(),
      });
    },
    cycleFinished: (outcome) => {
      this.monitorState.lastOutcome = { ...outcome, finishedAt: Date.now() };
      this.markDirty();
    },
    sleepUntil: (nextCycleAt) => {
      this.monitorState.phase = {
        kind: "sleeping",
        nextCycleAt: nextCycleAt.getTime(),
      };
      this.markDirty();
    },
    session: (event) => this.handleSessionEvent(this.monitorState, event),
  };

  readonly executor: ExecutorReporter = {
    taskStarted: (task) => {
      this.resetForSession(this.executorState, {
        kind: "session",
        task,
        startedAt: Date.now(),
      });
    },
    taskFinished: (outcome) => {
      this.executorState.lastOutcome = { ...outcome, finishedAt: Date.now() };
      this.markDirty();
    },
    retryScheduled: (task, resumeAt) => {
      this.executorState.phase = {
        kind: "backoff",
        task,
        resumeAt: resumeAt.getTime(),
      };
      this.markDirty();
    },
    waiting: () => {
      this.executorState.phase = { kind: "waiting" };
      this.markDirty();
    },
    session: (event) => this.handleSessionEvent(this.executorState, event),
  };

  constructor(options: WorkerStatusStoreOptions = {}) {
    this.tailLimit = options.tailLimit ?? 100;
    this.notifyDelayMs = options.notifyDelayMs ?? 50;
    this.snapshot = this.buildSnapshot();
  }

  setTasks(tasks: readonly Task[]): void {
    this.tasks = tasks.map((task) => ({ ...task }));
    this.markDirty();
  }

  shutdownRequested(signalName: string): void {
    this.shutdownSignal = signalName;
    this.markDirty();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): WorkerStatus => this.snapshot;

  flush(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.notify();
  }

  dispose(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.listeners.clear();
  }

  private resetForSession<Phase, Outcome>(
    state: AgentState<Phase, Outcome>,
    phase: Phase,
  ): void {
    state.phase = phase;
    state.tail = [];
    state.openPartial = "";
    state.partialSeen = false;
    state.sessionId = undefined;
    this.markDirty();
  }

  private handleSessionEvent<Phase, Outcome>(
    state: AgentState<Phase, Outcome>,
    event: SessionEvent,
  ): void {
    if (event.type === "partial") {
      state.partialSeen = true;
      const combined = state.openPartial + event.text;
      const lines = combined.split("\n");
      state.openPartial = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) this.pushTail(state, line);
      }
    } else if (event.type === "text" && state.partialSeen) {
      this.closePartial(state);
    } else {
      this.closePartial(state);
      if (event.type === "init") state.sessionId = event.sessionId;
      if (event.type !== "text") state.partialSeen = false;
      this.pushTail(state, formatSessionEvent(event));
    }
    this.markDirty();
  }

  private closePartial<Phase, Outcome>(state: AgentState<Phase, Outcome>): void {
    if (state.openPartial.trim()) this.pushTail(state, state.openPartial);
    state.openPartial = "";
  }

  private pushTail<Phase, Outcome>(
    state: AgentState<Phase, Outcome>,
    text: string,
  ): void {
    for (const line of text.split("\n")) {
      state.tail.push(clipLine(line));
    }
    if (state.tail.length > this.tailLimit) {
      state.tail.splice(0, state.tail.length - this.tailLimit);
    }
  }

  private markDirty(): void {
    this.notifyTimer ??= setTimeout(() => {
      this.notifyTimer = null;
      this.notify();
    }, this.notifyDelayMs);
  }

  private notify(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): WorkerStatus {
    return {
      startedAt: this.startedAt,
      shutdownSignal: this.shutdownSignal,
      monitor: this.buildPanel(this.monitorState),
      executor: this.buildPanel(this.executorState),
      tasks: this.tasks,
    };
  }

  private buildPanel<Phase, Outcome>(
    state: AgentState<Phase, Outcome>,
  ): AgentPanelStatus<Phase, Outcome> {
    const tail = state.openPartial.trim()
      ? [...state.tail, clipLine(state.openPartial)]
      : [...state.tail];
    return {
      phase: state.phase,
      tail,
      sessionId: state.sessionId,
      lastOutcome: state.lastOutcome,
    };
  }
}
