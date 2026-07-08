import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTempDir,
  fakeClaudeCliEnv,
  removeTempDir,
  seedProject,
} from "./helpers.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tsxBin = join(projectRoot, "node_modules", ".bin", "tsx");
const entry = join(projectRoot, "src", "index.ts");

const POLL_INTERVAL_MS = 150;
const INTERRUPT_DEADLINE_MS = 20_000;

interface Run {
  code: number | null;
  output: string;
}

function runCli(
  cwd: string,
  env: NodeJS.ProcessEnv,
  interruptWhen?: () => Promise<boolean>,
): Promise<Run> {
  const outPath = join(cwd, "stdout.log");
  const errPath = join(cwd, "stderr.log");
  const outFd = openSync(outPath, "w");
  const errFd = openSync(errPath, "w");
  const close = () => {
    closeSync(outFd);
    closeSync(errFd);
  };
  const readLogs = () =>
    Promise.all([
      readFile(outPath, "utf8").catch(() => ""),
      readFile(errPath, "utf8").catch(() => ""),
    ]).then(([out, err]) => `${out}${err}`);

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(tsxBin, [entry], {
      cwd,
      env: { ...env, TSX_TSCONFIG_PATH: join(projectRoot, "tsconfig.json") },
      stdio: ["ignore", outFd, errFd],
    });

    let watcher: NodeJS.Timeout | undefined;
    const stopWatching = () => {
      if (watcher) clearInterval(watcher);
    };

    child.on("error", (err) => {
      stopWatching();
      close();
      rejectPromise(err);
    });
    child.on("close", (code) => {
      stopWatching();
      close();
      void readLogs().then((output) => resolvePromise({ code, output }));
    });

    if (interruptWhen) {
      const deadline = Date.now() + INTERRUPT_DEADLINE_MS;
      watcher = setInterval(() => {
        void interruptWhen().then((ready) => {
          if (ready || Date.now() > deadline) {
            stopWatching();
            child.kill("SIGINT");
          }
        });
      }, POLL_INTERVAL_MS);
    }
  });
}

interface CommandRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCommand(
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: string[],
): Promise<CommandRun> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(tsxBin, [entry, ...args], {
      cwd,
      env: { ...env, TSX_TSCONFIG_PATH: join(projectRoot, "tsconfig.json") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

function readSummaries(dbPath: string, taskId: string): { headline: string }[] {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db
        .prepare("SELECT headline FROM summaries WHERE task_id = ?")
        .all(taskId) as { headline: string }[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

describe("CLI start (smoke E2E)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(() => removeTempDir(dir));

  it("monitor reports a task, executor runs it, the summary lands in memory, and everything shuts down cleanly on SIGINT", async () => {
    await seedProject(dir, {
      settings: {
        monitor: { model: "haiku", intervalMinutes: 1 },
        executor: { model: "opus" },
        summarizer: { model: "sonnet" },
      },
    });
    const env = fakeClaudeCliEnv("ok", {
      CI: "true",
      FAKE_CLAUDE_RESULT_TEXT_HAIKU: JSON.stringify({
        tasks: [{ id: "e2e-1", title: "Test task", description: "e2e description" }],
      }),
      FAKE_CLAUDE_PROMPT_OUT_OPUS: join(dir, "executor-prompt.txt"),
      FAKE_CLAUDE_RESULT_TEXT_SONNET: JSON.stringify({
        headline: "e2e summary",
        summary: "The executor completed the test task.",
      }),
      FAKE_CLAUDE_PROMPT_OUT_SONNET: join(dir, "summary-prompt.txt"),
      FAKE_CLAUDE_ARGS_OUT_OPUS: join(dir, "executor-args.json"),
    });
    const tasksPath = join(dir, ".brownie", "data", "tasks.json");
    const memoryDbPath = join(dir, ".brownie", "data", "memory.db");

    const result = await runCli(dir, env, () =>
      Promise.resolve(readSummaries(memoryDbPath, "e2e-1").length > 0),
    );

    const store = JSON.parse(await readFile(tasksPath, "utf8")) as {
      tasks: { id: string; status: string }[];
    };
    expect(store.tasks).toEqual([
      expect.objectContaining({ id: "e2e-1", status: "done" }),
    ]);

    const executorPrompt = await readFile(join(dir, "executor-prompt.txt"), "utf8");
    expect(executorPrompt).toContain("## Task to complete");
    expect(executorPrompt).toContain("ID: e2e-1");
    expect(executorPrompt).toContain("execute");

    const executorArgs = JSON.parse(
      await readFile(join(dir, "executor-args.json"), "utf8"),
    ) as string[];
    const mcpFlagIndex = executorArgs.indexOf("--mcp-config");
    expect(mcpFlagIndex).toBeGreaterThanOrEqual(0);
    expect(executorArgs[mcpFlagIndex + 1]).toContain(memoryDbPath);
    expect(executorArgs).not.toContain("--strict-mcp-config");

    const summarizerPrompt = await readFile(join(dir, "summary-prompt.txt"), "utf8");
    expect(summarizerPrompt).toContain("ID: e2e-1");
    expect(summarizerPrompt).toContain(join(dir, ".brownie", "logs", "executor"));

    expect(readSummaries(memoryDbPath, "e2e-1")).toEqual([{ headline: "e2e summary" }]);

    expect(result.output).toContain("worker.started");
    expect(result.output).toContain("model=haiku");
    expect(result.output).toContain("task.started taskId=e2e-1");
    expect(result.output).toMatch(/task\.finished taskId=e2e-1 .*ok=true/);
    expect(result.output).toContain("summary.finished taskId=e2e-1 ok=true");
    expect(result.output).toContain("worker.stopped signal=SIGINT");
  }, 30_000);

  it("exits with code 1 when preflight fails (no .brownie/settings.json)", async () => {
    const result = await runCli(dir, fakeClaudeCliEnv("ok"));

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/Preflight failed|file missing/);
  }, 30_000);

  it("answers brownie status --json and pause over the control socket", async () => {
    await seedProject(dir, {
      settings: { monitor: { model: "haiku", intervalMinutes: 1 } },
    });
    const env = fakeClaudeCliEnv("ok", {
      CI: "true",
      FAKE_CLAUDE_RESULT_TEXT_HAIKU: JSON.stringify({ tasks: [] }),
    });
    const outFd = openSync(join(dir, "worker-out.log"), "w");
    const errFd = openSync(join(dir, "worker-err.log"), "w");
    const worker = spawn(tsxBin, [entry, "--log-format", "json"], {
      cwd: dir,
      env: { ...env, TSX_TSCONFIG_PATH: join(projectRoot, "tsconfig.json") },
      stdio: ["ignore", outFd, errFd],
    });
    const workerClosed = new Promise<void>((resolve) => {
      worker.on("close", () => {
        closeSync(outFd);
        closeSync(errFd);
        resolve();
      });
    });

    interface StatusJson {
      pid: number;
      headless: boolean;
      agents: { monitor: { control: string }; executor: { control: string } };
    }

    try {
      let status: StatusJson | null = null;
      const deadline = Date.now() + INTERRUPT_DEADLINE_MS;
      while (Date.now() < deadline) {
        const probe = await runCommand(dir, env, ["status", "--json"]);
        if (probe.code === 0) {
          status = JSON.parse(probe.stdout) as StatusJson;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      expect(status).not.toBeNull();
      expect(status?.headless).toBe(true);
      expect(typeof status?.pid).toBe("number");
      expect(status?.agents.monitor.control).toBe("running");
      expect(status?.agents.executor.control).toBe("running");

      const paused = await runCommand(dir, env, ["pause", "monitor"]);
      expect(paused.code).toBe(0);

      const after = await runCommand(dir, env, ["status", "--json"]);
      expect(after.code).toBe(0);
      const afterStatus = JSON.parse(after.stdout) as StatusJson;
      expect(["pausing", "paused"]).toContain(afterStatus.agents.monitor.control);
      expect(afterStatus.agents.executor.control).toBe("running");

      const human = await runCommand(dir, env, ["status"]);
      expect(human.code).toBe(0);
      expect(human.stdout).toContain("monitor");
      expect(human.stdout).toContain("executor");
    } finally {
      worker.kill("SIGINT");
      await workerClosed;
    }
  }, 30_000);

  it("brownie status fails cleanly when no worker is running", async () => {
    const result = await runCommand(dir, fakeClaudeCliEnv("ok"), ["status"]);

    expect(result.code).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("No brownie worker is running");
  }, 30_000);
});
