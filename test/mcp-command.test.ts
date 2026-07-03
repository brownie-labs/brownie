import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir, removeTempDir } from "./helpers.js";

vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { mcpCommand } = await import("../src/mcp-command.js");
const { logger } = await import("../src/logger.js");

function run(...rawArgs: string[]): Promise<unknown> {
  return runCommand(mcpCommand, { rawArgs });
}

describe("brownie mcp", () => {
  let dir: string;
  let mcpFile: string;

  beforeEach(async () => {
    dir = await createTempDir();
    await mkdir(join(dir, ".brownie"), { recursive: true });
    mcpFile = join(dir, ".brownie", "mcp.json");
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    process.exitCode = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    await removeTempDir(dir);
  });

  async function readConfig(): Promise<unknown> {
    return JSON.parse(await readFile(mcpFile, "utf8"));
  }

  it("adds a stdio server passed after --", async () => {
    await run("add", "redmine", "--", "uvx", "mcp-redmine");

    expect(process.exitCode).toBe(0);
    expect(await readConfig()).toEqual({
      mcpServers: { redmine: { command: "uvx", args: ["mcp-redmine"] } },
    });
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining("uvx mcp-redmine"),
    );
  });

  it("preserves flags belonging to the wrapped command", async () => {
    await run("add", "playwright", "--", "npx", "-y", "@playwright/mcp");

    expect(await readConfig()).toEqual({
      mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp"] } },
    });
  });

  it("stores env variables", async () => {
    await run(
      "add",
      "redmine",
      "--env",
      "REDMINE_URL=https://redmine.example.com",
      "--env",
      "REDMINE_API_KEY=secret",
      "--",
      "uvx",
      "mcp-redmine",
    );

    expect(await readConfig()).toEqual({
      mcpServers: {
        redmine: {
          command: "uvx",
          args: ["mcp-redmine"],
          env: {
            REDMINE_URL: "https://redmine.example.com",
            REDMINE_API_KEY: "secret",
          },
        },
      },
    });
  });

  it("adds an http server with a header", async () => {
    await run(
      "add",
      "linear",
      "--transport",
      "http",
      "--header",
      "Authorization: Bearer xyz",
      "--",
      "https://mcp.linear.app/mcp",
    );

    expect(await readConfig()).toEqual({
      mcpServers: {
        linear: {
          type: "http",
          url: "https://mcp.linear.app/mcp",
          headers: { Authorization: "Bearer xyz" },
        },
      },
    });
  });

  it("refuses to overwrite an existing server without --force", async () => {
    await run("add", "redmine", "--", "uvx", "mcp-redmine");
    process.exitCode = 0;
    await run("add", "redmine", "--", "other");

    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });

  it("overwrites with --force", async () => {
    await run("add", "redmine", "--", "uvx", "mcp-redmine");
    await run("add", "redmine", "--force", "--", "other-cmd");

    expect(await readConfig()).toEqual({
      mcpServers: { redmine: { command: "other-cmd" } },
    });
  });

  it("fails when .brownie does not exist", async () => {
    await rm(join(dir, ".brownie"), { recursive: true, force: true });
    await run("add", "redmine", "--", "uvx");

    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('run "brownie config"'),
    );
  });

  it("reports an empty list", async () => {
    await run("list");

    expect(process.exitCode).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("No MCP servers"));
  });

  it("lists configured servers", async () => {
    await run("add", "redmine", "--", "uvx", "mcp-redmine");
    await run("list");

    expect(logger.log).toHaveBeenCalledWith("redmine: uvx mcp-redmine");
  });

  it("shows a single server definition", async () => {
    await run("add", "redmine", "--", "uvx", "mcp-redmine");
    await run("get", "redmine");

    expect(logger.log).toHaveBeenCalledWith(
      JSON.stringify({ command: "uvx", args: ["mcp-redmine"] }, null, 2),
    );
  });

  it("fails to get a missing server", async () => {
    await run("get", "ghost");

    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("removes a server", async () => {
    await run("add", "redmine", "--", "uvx", "mcp-redmine");
    await run("remove", "redmine");

    expect(await readConfig()).toEqual({ mcpServers: {} });
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining("Removed"));
  });

  it("fails to remove a missing server", async () => {
    await run("remove", "ghost");

    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });
});
