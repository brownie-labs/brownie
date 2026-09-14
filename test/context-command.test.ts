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

const { contextCommand, runContextGet, runContextSet } =
  await import("../src/context-command.js");
const { logger } = await import("../src/logger.js");

describe("context commands", () => {
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

  it("get prints the raw context", async () => {
    mocks.sendControlRequest.mockResolvedValue({
      ok: true,
      data: { content: "# Workspace context\nacme-shop" },
    });

    await runContextGet({ write });

    expect(mocks.sendControlRequest).toHaveBeenCalledWith(expect.any(String), {
      cmd: "context.get",
    });
    expect(lines).toEqual(["# Workspace context\nacme-shop"]);
  });

  it("get prints an empty line when no context is set", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: true, data: { content: "" } });

    await runContextGet({ write });

    expect(lines).toEqual([""]);
    expect(process.exitCode).toBe(savedExitCode);
  });

  it("get prints JSON with --json", async () => {
    const data = { content: "# Workspace context" };
    mocks.sendControlRequest.mockResolvedValue({ ok: true, data });

    await runContextGet({ json: true, write });

    expect(JSON.parse(lines.join("\n"))).toEqual(data);
  });

  it("set reads the content from a file", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: true });
    const file = join(dir, "context.md");
    await writeFile(file, "# Workspace context\n", "utf8");

    await runContextSet(file, { write });

    expect(mocks.sendControlRequest).toHaveBeenCalledWith(expect.any(String), {
      cmd: "context.set",
      content: "# Workspace context\n",
    });
    expect(logger.success).toHaveBeenCalledWith("Updated the context file.");
  });

  it("set reads stdin when no file is given or - is passed", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: true });
    const readStdin = vi.fn().mockResolvedValue("# From stdin");

    await runContextSet(undefined, { write, readStdin });
    await runContextSet("-", { write, readStdin });

    expect(readStdin).toHaveBeenCalledTimes(2);
    expect(mocks.sendControlRequest).toHaveBeenLastCalledWith(expect.any(String), {
      cmd: "context.set",
      content: "# From stdin",
    });
  });

  it("set with empty input clears the context", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: true });

    await runContextSet(undefined, {
      write,
      readStdin: vi.fn().mockResolvedValue("  \n"),
    });

    expect(mocks.sendControlRequest).toHaveBeenCalledWith(expect.any(String), {
      cmd: "context.set",
      content: "  \n",
    });
    expect(logger.success).toHaveBeenCalledWith("Cleared the context file.");
    expect(process.exitCode).toBe(savedExitCode);
  });

  it("set refuses an unreadable file and a TTY without input", async () => {
    await runContextSet(join(dir, "missing.md"), { write });
    expect(logger.error).toHaveBeenCalledWith(
      `Cannot read "${join(dir, "missing.md")}".`,
    );

    await runContextSet(undefined, {
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

  it("reports a rejected request and prints nothing", async () => {
    mocks.sendControlRequest.mockResolvedValue({
      ok: false,
      error: "Unrecognized control request.",
    });

    await runContextGet({ write });

    expect(lines).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('does not support "context.get"'),
    );
    expect(process.exitCode).toBe(1);
  });

  it("exposes get and set as subcommands", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: true, data: { content: "x" } });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const subCommands = contextCommand.subCommands as Record<
      string,
      { run: (ctx: unknown) => Promise<void> }
    >;

    try {
      expect(Object.keys(subCommands).sort()).toEqual(["get", "set"]);
      await subCommands.get?.run({ args: { _: [] } });
    } finally {
      stdoutWrite.mockRestore();
    }

    expect(mocks.sendControlRequest).toHaveBeenCalledWith(expect.any(String), {
      cmd: "context.get",
    });
  });
});
