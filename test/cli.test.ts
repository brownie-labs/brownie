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

    expect(result.output).toContain("model=haiku");
    expect(result.output).toContain("e2e-1");
    expect(result.output).toContain("done: 1");
  }, 30_000);

  it("exits with code 1 when preflight fails (no .brownie/settings.json)", async () => {
    const result = await runCli(dir, fakeClaudeCliEnv("ok"));

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/Preflight failed|file missing/);
  }, 30_000);
});
