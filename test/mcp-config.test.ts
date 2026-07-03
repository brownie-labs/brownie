import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMcpServer,
  buildServerDefinition,
  describeServer,
  readMcpServers,
  removeMcpServer,
} from "../src/mcp-config.js";
import { createTempDir, removeTempDir } from "./helpers.js";

describe("readMcpServers", () => {
  let dir: string;
  let mcpFile: string;

  beforeEach(async () => {
    dir = await createTempDir();
    mcpFile = join(dir, "mcp.json");
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it("returns an empty object when the file does not exist", async () => {
    await expect(readMcpServers(mcpFile)).resolves.toEqual({});
  });

  it("parses a valid configuration", async () => {
    await writeFile(
      mcpFile,
      JSON.stringify({
        mcpServers: { redmine: { command: "uvx", args: ["mcp-redmine"] } },
      }),
      "utf8",
    );

    await expect(readMcpServers(mcpFile)).resolves.toEqual({
      redmine: { command: "uvx", args: ["mcp-redmine"] },
    });
  });

  it("throws on malformed JSON", async () => {
    await writeFile(mcpFile, "{ not json", "utf8");
    await expect(readMcpServers(mcpFile)).rejects.toThrow(/Invalid JSON/);
  });

  it("throws with a field path on an invalid schema", async () => {
    await writeFile(
      mcpFile,
      JSON.stringify({ mcpServers: { broken: { command: "" } } }),
      "utf8",
    );
    await expect(readMcpServers(mcpFile)).rejects.toThrow(/Invalid MCP configuration/);
  });

  it("rejects unknown top-level keys", async () => {
    await writeFile(mcpFile, JSON.stringify({ servers: {} }), "utf8");
    await expect(readMcpServers(mcpFile)).rejects.toThrow(/Invalid MCP configuration/);
  });
});

describe("addMcpServer / removeMcpServer", () => {
  let dir: string;
  let mcpFile: string;

  beforeEach(async () => {
    dir = await createTempDir();
    mcpFile = join(dir, "mcp.json");
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  async function read(): Promise<unknown> {
    return JSON.parse(await readFile(mcpFile, "utf8"));
  }

  it("creates the file and stores the server", async () => {
    await addMcpServer(
      mcpFile,
      "redmine",
      { command: "uvx", args: ["mcp-redmine"] },
      { force: false },
    );

    expect(await read()).toEqual({
      mcpServers: { redmine: { command: "uvx", args: ["mcp-redmine"] } },
    });
  });

  it("rejects a duplicate name without --force", async () => {
    await addMcpServer(mcpFile, "redmine", { command: "uvx" }, { force: false });
    await expect(
      addMcpServer(mcpFile, "redmine", { command: "other" }, { force: false }),
    ).rejects.toThrow(/already exists/);
  });

  it("overwrites a duplicate name with --force", async () => {
    await addMcpServer(mcpFile, "redmine", { command: "uvx" }, { force: false });
    await addMcpServer(mcpFile, "redmine", { command: "other" }, { force: true });

    await expect(readMcpServers(mcpFile)).resolves.toEqual({
      redmine: { command: "other" },
    });
  });

  it("keeps other servers when adding a new one", async () => {
    await addMcpServer(mcpFile, "redmine", { command: "uvx" }, { force: false });
    await addMcpServer(mcpFile, "playwright", { command: "npx" }, { force: false });

    await expect(readMcpServers(mcpFile)).resolves.toEqual({
      redmine: { command: "uvx" },
      playwright: { command: "npx" },
    });
  });

  it("removes a server", async () => {
    await addMcpServer(mcpFile, "redmine", { command: "uvx" }, { force: false });
    await addMcpServer(mcpFile, "playwright", { command: "npx" }, { force: false });
    await removeMcpServer(mcpFile, "redmine");

    await expect(readMcpServers(mcpFile)).resolves.toEqual({
      playwright: { command: "npx" },
    });
  });

  it("throws when removing a missing server", async () => {
    await expect(removeMcpServer(mcpFile, "ghost")).rejects.toThrow(/not found/);
  });
});

describe("buildServerDefinition", () => {
  it("builds a stdio server from a command and args", () => {
    expect(
      buildServerDefinition({
        transport: "stdio",
        commandParts: ["uvx", "mcp-redmine"],
        env: [],
        header: [],
      }),
    ).toEqual({ command: "uvx", args: ["mcp-redmine"] });
  });

  it("omits args when only a command is given", () => {
    expect(
      buildServerDefinition({
        transport: "stdio",
        commandParts: ["mcp-server"],
        env: [],
        header: [],
      }),
    ).toEqual({ command: "mcp-server" });
  });

  it("parses repeated --env into an env record", () => {
    expect(
      buildServerDefinition({
        transport: "stdio",
        commandParts: ["uvx", "mcp-redmine"],
        env: ["REDMINE_URL=https://example.com", "TOKEN=abc=def"],
        header: [],
      }),
    ).toEqual({
      command: "uvx",
      args: ["mcp-redmine"],
      env: { REDMINE_URL: "https://example.com", TOKEN: "abc=def" },
    });
  });

  it("defaults an empty transport to stdio", () => {
    expect(
      buildServerDefinition({
        transport: "",
        commandParts: ["cmd"],
        env: [],
        header: [],
      }),
    ).toEqual({ command: "cmd" });
  });

  it("builds an http server with headers", () => {
    expect(
      buildServerDefinition({
        transport: "http",
        commandParts: ["https://mcp.example.com/mcp"],
        env: [],
        header: ["Authorization: Bearer xyz"],
      }),
    ).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer xyz" },
    });
  });

  it("builds an sse server", () => {
    expect(
      buildServerDefinition({
        transport: "sse",
        commandParts: ["https://mcp.example.com/sse"],
        env: [],
        header: [],
      }),
    ).toEqual({ type: "sse", url: "https://mcp.example.com/sse" });
  });

  it("throws when a stdio command is missing", () => {
    expect(() =>
      buildServerDefinition({
        transport: "stdio",
        commandParts: [],
        env: [],
        header: [],
      }),
    ).toThrow(/Missing command/);
  });

  it("throws when an http url is missing", () => {
    expect(() =>
      buildServerDefinition({
        transport: "http",
        commandParts: [],
        env: [],
        header: [],
      }),
    ).toThrow(/Missing URL/);
  });

  it("throws on an unknown transport", () => {
    expect(() =>
      buildServerDefinition({
        transport: "carrier-pigeon",
        commandParts: ["x"],
        env: [],
        header: [],
      }),
    ).toThrow(/Unknown transport/);
  });

  it("throws on a malformed env entry", () => {
    expect(() =>
      buildServerDefinition({
        transport: "stdio",
        commandParts: ["cmd"],
        env: ["NOPE"],
        header: [],
      }),
    ).toThrow(/Invalid env entry/);
  });

  it("throws on a malformed header entry", () => {
    expect(() =>
      buildServerDefinition({
        transport: "http",
        commandParts: ["https://x.dev"],
        env: [],
        header: ["NoColon"],
      }),
    ).toThrow(/Invalid header/);
  });
});

describe("describeServer", () => {
  it("describes a stdio server as its command line", () => {
    expect(describeServer({ command: "uvx", args: ["mcp-redmine"] })).toBe(
      "uvx mcp-redmine",
    );
  });

  it("describes a remote server as transport and url", () => {
    expect(describeServer({ type: "http", url: "https://x.dev/mcp" })).toBe(
      "http https://x.dev/mcp",
    );
  });
});
