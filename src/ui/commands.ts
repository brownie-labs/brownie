import type { AgentController } from "../control.js";
import type { TaskSummaryRecord } from "../memory/store.js";
import type { NewTask, Task } from "../types.js";
import type { Waker } from "../waker.js";

export type View =
  | { kind: "dashboard" }
  | { kind: "monitor" }
  | { kind: "executor" }
  | { kind: "tasks" }
  | { kind: "help" }
  | {
      kind: "memory";
      query?: string | undefined;
      entries: readonly TaskSummaryRecord[];
    };

export type NoticeTone = "info" | "error";

export type AgentControls = Pick<AgentController, "pause" | "resume" | "state">;

export interface TaskControls {
  retry(id: string): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  addTasks(tasks: NewTask[]): Promise<Task[]>;
}

export interface MemoryReader {
  recent(limit: number): TaskSummaryRecord[];
  search(query: string, limit: number): TaskSummaryRecord[];
}

export interface CommandContext {
  setView(view: View): void;
  monitorControl: AgentControls;
  executorControl: AgentControls;
  tasks: TaskControls;
  memory: MemoryReader;
  waker: Pick<Waker, "notify">;
  requestExit(): void;
  notice(text: string, tone?: NoticeTone): void;
}

export interface CommandSpec {
  name: string;
  args?: string | undefined;
  summary: string;
  run(args: string, ctx: CommandContext): void | Promise<void>;
}

const MEMORY_VIEW_LIMIT = 20;
const TASK_TITLE_MAX = 60;

const AGENT_NAMES = ["monitor", "executor"] as const;
type AgentName = (typeof AGENT_NAMES)[number];

function resolveAgents(args: string): AgentName[] | null {
  const trimmed = args.trim();
  if (trimmed === "") return [...AGENT_NAMES];
  const match = AGENT_NAMES.find((name) => name === trimmed);
  return match === undefined ? null : [match];
}

function agentControl(ctx: CommandContext, agent: AgentName): AgentControls {
  return agent === "monitor" ? ctx.monitorControl : ctx.executorControl;
}

function joinNames(agents: readonly AgentName[]): string {
  return agents.join(" and ");
}

let manualTaskCounter = 0;

export function buildManualTask(description: string): NewTask {
  manualTaskCounter += 1;
  const id = `manual-${Date.now().toString(36)}-${manualTaskCounter.toString(36)}`;
  const firstLine = description.split("\n", 1)[0] ?? description;
  const title =
    firstLine.length > TASK_TITLE_MAX
      ? `${firstLine.slice(0, TASK_TITLE_MAX - 1)}…`
      : firstLine;
  return { id, title, description };
}

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "dashboard",
    summary: "show the combined monitor + executor + tasks view",
    run: (_args, ctx) => {
      ctx.setView({ kind: "dashboard" });
    },
  },
  {
    name: "monitor",
    summary: "show the monitor agent in full detail",
    run: (_args, ctx) => {
      ctx.setView({ kind: "monitor" });
    },
  },
  {
    name: "executor",
    summary: "show the executor agent in full detail",
    run: (_args, ctx) => {
      ctx.setView({ kind: "executor" });
    },
  },
  {
    name: "tasks",
    summary: "show the full task list",
    run: (_args, ctx) => {
      ctx.setView({ kind: "tasks" });
    },
  },
  {
    name: "memory",
    args: "[query]",
    summary: "browse long-term memory, optionally filtered by a search query",
    run: (args, ctx) => {
      const query = args.trim();
      ctx.setView(
        query === ""
          ? {
              kind: "memory",
              query: undefined,
              entries: ctx.memory.recent(MEMORY_VIEW_LIMIT),
            }
          : {
              kind: "memory",
              query,
              entries: ctx.memory.search(query, MEMORY_VIEW_LIMIT),
            },
      );
    },
  },
  {
    name: "pause",
    args: "[monitor|executor]",
    summary: "gracefully pause agents — the current session finishes first",
    run: (args, ctx) => {
      const agents = resolveAgents(args);
      if (agents === null) {
        ctx.notice(`unknown agent "${args.trim()}" — use monitor or executor`, "error");
        return;
      }
      const paused = agents.filter((agent) => agentControl(ctx, agent).pause());
      const skipped = agents.filter((agent) => !paused.includes(agent));
      const parts: string[] = [];
      if (paused.length > 0) parts.push(`pausing ${joinNames(paused)}`);
      if (skipped.length > 0) parts.push(`${joinNames(skipped)} already paused`);
      ctx.notice(parts.join(" · "));
    },
  },
  {
    name: "start",
    args: "[monitor|executor]",
    summary: "start paused agents — they boot paused until you start them",
    run: (args, ctx) => {
      const agents = resolveAgents(args);
      if (agents === null) {
        ctx.notice(`unknown agent "${args.trim()}" — use monitor or executor`, "error");
        return;
      }
      const started = agents.filter((agent) => agentControl(ctx, agent).resume());
      const skipped = agents.filter((agent) => !started.includes(agent));
      const parts: string[] = [];
      if (started.length > 0) parts.push(`started ${joinNames(started)}`);
      if (skipped.length > 0) parts.push(`${joinNames(skipped)} already running`);
      ctx.notice(parts.join(" · "));
    },
  },
  {
    name: "task",
    args: "<description>",
    summary: "add a task for the executor by hand",
    run: async (args, ctx) => {
      const description = args.trim();
      if (description === "") {
        ctx.notice("usage: /task <description>", "error");
        return;
      }
      const candidate = buildManualTask(description);
      const added = await ctx.tasks.addTasks([candidate]);
      if (added.length === 0) {
        ctx.notice(`task ${candidate.id} already exists`, "error");
        return;
      }
      ctx.waker.notify();
      ctx.notice(`task ${candidate.id} added`);
    },
  },
  {
    name: "retry",
    args: "<task-id>",
    summary: "requeue a failed task",
    run: async (args, ctx) => {
      const id = args.trim();
      if (id === "") {
        ctx.notice("usage: /retry <task-id>", "error");
        return;
      }
      if (await ctx.tasks.retry(id)) {
        ctx.waker.notify();
        ctx.notice(`task ${id} requeued`);
      } else {
        ctx.notice(`no failed task "${id}"`, "error");
      }
    },
  },
  {
    name: "cancel",
    args: "<task-id>",
    summary: "cancel a pending task",
    run: async (args, ctx) => {
      const id = args.trim();
      if (id === "") {
        ctx.notice("usage: /cancel <task-id>", "error");
        return;
      }
      if (await ctx.tasks.cancel(id)) {
        ctx.notice(`task ${id} cancelled`);
      } else {
        ctx.notice(
          `no pending task "${id}" — only pending tasks can be cancelled`,
          "error",
        );
      }
    },
  },
  {
    name: "help",
    summary: "list all commands",
    run: (_args, ctx) => {
      ctx.setView({ kind: "help" });
    },
  },
  {
    name: "exit",
    summary: "shut down brownie gracefully",
    run: (_args, ctx) => {
      ctx.requestExit();
    },
  },
];

export function parseCommand(line: string): { name: string; args: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1);
  if (body === "") return null;
  const spaceIndex = body.indexOf(" ");
  if (spaceIndex === -1) return { name: body.toLowerCase(), args: "" };
  return {
    name: body.slice(0, spaceIndex).toLowerCase(),
    args: body.slice(spaceIndex + 1).trim(),
  };
}

export function suggest(value: string): string | undefined {
  if (!value.startsWith("/") || value.includes(" ")) return undefined;
  const prefix = value.slice(1).toLowerCase();
  if (COMMANDS.some((command) => command.name === prefix)) return undefined;
  const match = COMMANDS.find((command) => command.name.startsWith(prefix));
  return match === undefined ? undefined : `/${match.name}`;
}

export async function dispatchCommand(line: string, ctx: CommandContext): Promise<void> {
  const parsed = parseCommand(line);
  if (parsed === null) return;
  const spec = COMMANDS.find((command) => command.name === parsed.name);
  if (spec === undefined) {
    ctx.notice(`unknown command /${parsed.name} — try /help`, "error");
    return;
  }
  try {
    await spec.run(parsed.args, ctx);
  } catch (err) {
    ctx.notice(err instanceof Error ? err.message : String(err), "error");
  }
}
