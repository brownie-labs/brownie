import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir, removeTempDir } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  sendControlRequest: vi.fn(),
}));

vi.mock("../src/control-client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/control-client.js")>();
  return { ...original, sendControlRequest: mocks.sendControlRequest };
});
vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { promptCommand, runPromptGet, runPromptSet } =
  await import("../src/prompt-command.js");
const { logger } = await import("../src/logger.js");

describe("prompt commands", () => {
  let dir: string;
  let lines: string[];
  let savedExitCode: typeof process.exitCode;
  const write = (line: string) => lines.push(line);

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await createTempDir();
    lines = [];
    savedExitCode = process.exitCode;
  });

  afterEach(async () => {
    process.exitCode = savedExitCode;
    await removeTempDir(dir);
  });

  it("get prints the raw prompt", async () => {
    mocks.sendControlRequest.mockResolvedValue({
      ok: true,
      data: { agent: "monitor", content: "# Watch\nthe pipelines" },
    });

    await runPromptGet("monitor", { write });

    expect(mocks.sendControlRequest).toHaveBeenCalledWith(expect.any(String), {
      cmd: "prompt.get",
      agent: "monitor",
    });
    expect(lines).toEqual(["# Watch\nthe pipelines"]);
  });

  it("get prints JSON with --json", async () => {
    const data = { agent: "executor", content: "# Do" };
    mocks.sendControlRequest.mockResolvedValue({ ok: true, data });

    await runPromptGet("executor", { json: true, write });

    expect(JSON.parse(lines.join("\n"))).toEqual(data);
  });

  it("rejects an unknown agent locally", async () => {
    await runPromptGet("summarizer", { write });
    await runPromptSet("summarizer", undefined, { write });

    expect(mocks.sendControlRequest).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Unknown agent "summarizer" — use monitor or executor.',
    );
    expect(process.exitCode).toBe(1);
  });

  it("set reads the content from a file", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: true });
    const file = join(dir, "monitor.md");
    await writeFile(file, "# New monitor prompt\n", "utf8");

    await runPromptSet("monitor", file, { write });

    expect(mocks.sendControlRequest).toHaveBeenCalledWith(expect.any(String), {
      cmd: "prompt.set",
      agent: "monitor",
      content: "# New monitor prompt\n",
    });
    expect(logger.success).toHaveBeenCalledWith("Updated the monitor prompt.");
  });

  it("set reads stdin when no file is given or - is passed", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: true });
    const readStdin = vi.fn().mockResolvedValue("# From stdin");

    await runPromptSet("executor", undefined, { write, readStdin });
    await runPromptSet("executor", "-", { write, readStdin });

    expect(readStdin).toHaveBeenCalledTimes(2);
    expect(mocks.sendControlRequest).toHaveBeenCalledTimes(2);
    expect(mocks.sendControlRequest).toHaveBeenLastCalledWith(expect.any(String), {
      cmd: "prompt.set",
      agent: "executor",
      content: "# From stdin",
    });
  });

  it("set refuses an unreadable file, an empty prompt and a TTY without input", async () => {
    await runPromptSet("monitor", join(dir, "missing.md"), { write });
    expect(logger.error).toHaveBeenCalledWith(
      `Cannot read "${join(dir, "missing.md")}".`,
    );

    await runPromptSet("monitor", undefined, {
      write,
      readStdin: vi.fn().mockResolvedValue("  \n"),
    });
    expect(logger.error).toHaveBeenCalledWith("The prompt content is empty.");

    await runPromptSet("monitor", undefined, {
      write,
      readStdin: vi
        .fn()
        .mockRejectedValue(new Error("Pass a file path or pipe the content on stdin.")),
    });
    expect(logger.error).toHaveBeenCalledWith(
      "Pass a file path or pipe the content on stdin.",
    );

    expect(mocks.sendControlRequest).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("exposes get and set as subcommands", async () => {
    mocks.sendControlRequest.mockResolvedValue({
      ok: true,
      data: { agent: "monitor", content: "x" },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const subCommands = promptCommand.subCommands as Record<
      string,
      { run: (ctx: unknown) => Promise<void> }
    >;

    try {
      expect(Object.keys(subCommands).sort()).toEqual(["get", "set"]);
      await subCommands.get?.run({ args: { _: [], agent: "monitor" } });
    } finally {
      stdoutWrite.mockRestore();
    }

    expect(mocks.sendControlRequest).toHaveBeenCalledWith(expect.any(String), {
      cmd: "prompt.get",
      agent: "monitor",
    });
  });
});
