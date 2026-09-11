import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packageVersion } from "../src/paths.js";
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

  it("exits with code 1 when Claude Code is not logged in", async () => {
    await seedProject(dir);
    const result = await runCli(
      dir,
      fakeClaudeCliEnv("ok", { FAKE_CLAUDE_AUTH: "logged_out" }),
    );

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/not logged in/);
    expect(result.output).toMatch(/claude auth login/);
  }, 30_000);

  it("an auth failure parks both agents in authBlocked until resume", async () => {
    await seedProject(dir, {
      settings: { monitor: { model: "haiku", intervalMinutes: 1 } },
    });
    const env = fakeClaudeCliEnv("ok", {
      CI: "true",
      FAKE_CLAUDE_MODE_HAIKU: "auth_error",
    });
    const outPath = join(dir, "worker-out.log");
    const outFd = openSync(outPath, "w");
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

    interface AgentJson {
      control: string;
      phase: { kind: string; reason?: string };
    }
    interface StatusJson {
      agents: { monitor: AgentJson; executor: AgentJson };
    }

    async function pollStatus(
      ready: (status: StatusJson) => boolean,
    ): Promise<StatusJson | null> {
      const deadline = Date.now() + INTERRUPT_DEADLINE_MS;
      while (Date.now() < deadline) {
        const probe = await runCommand(dir, env, ["status", "--json"]);
        if (probe.code === 0) {
          const status = JSON.parse(probe.stdout) as StatusJson;
          if (ready(status)) return status;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      return null;
    }

    try {
      const blocked = await pollStatus(
        (status) =>
          status.agents.monitor.phase.kind === "authBlocked" &&
          status.agents.monitor.control === "paused" &&
          status.agents.executor.control === "paused",
      );
      expect(blocked).not.toBeNull();
      expect(blocked?.agents.monitor.phase.reason).toContain("401");

      const log = await readFile(outPath, "utf8");
      expect(log).toContain('"event":"monitor.authBlocked"');
      expect(log).not.toContain('"cycle":2');

      const resumed = await runCommand(dir, env, ["resume"]);
      expect(resumed.code).toBe(0);

      const deadline = Date.now() + INTERRUPT_DEADLINE_MS;
      let secondCycle = false;
      while (Date.now() < deadline && !secondCycle) {
        secondCycle = (await readFile(outPath, "utf8")).includes(
          '"event":"cycle.started","cycle":2',
        );
        if (!secondCycle)
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      expect(secondCycle).toBe(true);
    } finally {
      worker.kill("SIGINT");
      await workerClosed;
    }
  }, 40_000);

  it("answers brownie status --json and pause over the control socket", async () => {
    await seedProject(dir, {
      settings: { monitor: { model: "haiku", intervalMinutes: 1 } },
    });
    const env = fakeClaudeCliEnv("ok", {
      CI: "true",
      CLAUDE_CODE_OAUTH_TOKEN: "e2e-oauth-token",
      FAKE_CLAUDE_VERSION: "2.1.300",
      FAKE_CLAUDE_RESULT_TEXT_HAIKU: JSON.stringify({ tasks: [] }),
    });
    delete env.ANTHROPIC_API_KEY;
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

    interface IdentityJson {
      version: string;
      claudeVersion?: string;
      nodeVersion: string;
      pid: number;
      startedAt: string;
      authKind: string;
    }
    interface StatusJson extends IdentityJson {
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
      expect(status?.version).toBe(packageVersion());
      expect(status?.claudeVersion).toBe("2.1.300");
      expect(status?.nodeVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(status?.authKind).toBe("oauth");
      expect(status?.agents.monitor.control).toBe("running");
      expect(status?.agents.executor.control).toBe("running");

      const identity = await runCommand(dir, env, ["version", "--json"]);
      expect(identity.code).toBe(0);
      const identityJson = JSON.parse(identity.stdout) as IdentityJson;
      expect(identityJson).toEqual({
        version: status?.version,
        claudeVersion: "2.1.300",
        nodeVersion: status?.nodeVersion,
        pid: status?.pid,
        startedAt: status?.startedAt,
        projectDir: expect.any(String) as unknown,
        authKind: "oauth",
      });

      const identityText = await runCommand(dir, env, ["version"]);
      expect(identityText.code).toBe(0);
      expect(identityText.stdout).toContain(`brownie   ${packageVersion()}`);
      expect(identityText.stdout).toContain("claude    2.1.300");
      expect(identityText.stdout).toContain("auth      oauth");

      const paused = await runCommand(dir, env, ["pause", "monitor"]);
      expect(paused.code).toBe(0);

      const after = await runCommand(dir, env, ["status", "--json"]);
      expect(after.code).toBe(0);
      const afterStatus = JSON.parse(after.stdout) as StatusJson;
      expect(["pausing", "paused"]).toContain(afterStatus.agents.monitor.control);
      expect(afterStatus.agents.executor.control).toBe("running");

      const human = await runCommand(dir, env, ["status"]);
      expect(human.code).toBe(0);
      expect(human.stdout).toContain(
        `brownie ${packageVersion()} · claude 2.1.300 · auth oauth · pid ${String(status?.pid)}`,
      );
      expect(human.stdout).toContain("monitor");
      expect(human.stdout).toContain("executor");

      const added = await runCommand(dir, env, [
        "tasks",
        "add",
        "e2e manual task",
        "--id",
        "e2e-manual",
      ]);
      expect(added.code).toBe(0);
      const listed = await runCommand(dir, env, ["tasks", "list", "--json"]);
      expect(listed.code).toBe(0);
      expect(JSON.parse(listed.stdout)).toContainEqual(
        expect.objectContaining({ id: "e2e-manual", title: "e2e manual task" }),
      );

      const settings = await runCommand(dir, env, ["settings", "get", "--json"]);
      expect(settings.code).toBe(0);
      expect(JSON.parse(settings.stdout)).toMatchObject({ monitor: { model: "haiku" } });
      const patched = await runCommand(dir, env, [
        "settings",
        "patch",
        '{"executor":{"maxTaskAttempts":5}}',
        "--json",
      ]);
      expect(patched.code).toBe(0);
      expect(JSON.parse(patched.stdout)).toMatchObject({
        executor: { maxTaskAttempts: 5 },
      });

      const prompt = await runCommand(dir, env, ["prompt", "get", "monitor"]);
      expect(prompt.code).toBe(0);
      expect(prompt.stdout.trim()).toBe("observe");

      const memory = await runCommand(dir, env, ["memory", "recent", "--json"]);
      expect(memory.code).toBe(0);
      expect(JSON.parse(memory.stdout)).toEqual([]);
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

  it("brownie version needs a worker, brownie --version does not", async () => {
    const env = fakeClaudeCliEnv("ok");

    const identity = await runCommand(dir, env, ["version"]);
    const installed = await runCommand(dir, env, ["--version"]);

    expect(identity.code).toBe(1);
    expect(`${identity.stdout}${identity.stderr}`).toContain(
      "No brownie worker is running",
    );
    expect(installed.code).toBe(0);
    expect(`${installed.stdout}${installed.stderr}`).toContain(packageVersion());
  }, 30_000);
});
