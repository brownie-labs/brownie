import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMcpConfig, createMemoryMcpServer } from "../../src/memory/mcp.js";
import { MemoryStore } from "../../src/memory/store.js";
import { createTempDir, removeTempDir } from "../helpers.js";

interface TextContent {
  type: string;
  text: string;
}

function firstText(result: unknown): string {
  const content = (result as { content?: TextContent[] }).content;
  const block = content?.[0];
  if (block?.type !== "text") throw new Error("missing text block");
  return block.text;
}

describe("buildMcpConfig", () => {
  it("runs the server via tsx for a .ts entry", () => {
    const config = JSON.parse(
      buildMcpConfig("/data/memory.db", "/repo/src/index.ts"),
    ) as {
      mcpServers: { memory: { command: string; args: string[] } };
    };

    expect(config.mcpServers.memory.command).toBe(process.execPath);
    expect(config.mcpServers.memory.args).toEqual([
      "--import",
      "tsx",
      "/repo/src/index.ts",
      "mcp",
      "--db",
      "/data/memory.db",
    ]);
  });

  it("runs the server directly with node for a .js entry", () => {
    const config = JSON.parse(
      buildMcpConfig("/data/memory.db", "/repo/dist/index.js"),
    ) as {
      mcpServers: { memory: { command: string; args: string[] } };
    };

    expect(config.mcpServers.memory.args).toEqual([
      "/repo/dist/index.js",
      "mcp",
      "--db",
      "/data/memory.db",
    ]);
  });
});

describe("memory MCP server", () => {
  let dir: string;
  let store: MemoryStore;
  let client: Client;

  beforeEach(async () => {
    dir = await createTempDir();
    store = MemoryStore.open(join(dir, "memory.db"));
    store.add({
      taskId: "redmine-1",
      attempt: 1,
      ok: true,
      title: "Fix export",
      headline: "Fixed CSV export",
      summary: "The cause was a missing Content-Type header.",
      error: undefined,
      sessionId: "session-1",
      createdAt: "2026-07-02T10:00:00.000Z",
    });
    store.add({
      taskId: "redmine-1",
      attempt: 2,
      ok: false,
      title: "Fix export",
      headline: "Export regression",
      summary: "Deploy overwrote the fix.",
      error: "timeout",
      sessionId: "session-2",
      createdAt: "2026-07-02T11:00:00.000Z",
    });

    const server = createMemoryMcpServer(store);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    store.close();
    await removeTempDir(dir);
  });

  it("exposes the memory_search and memory_get tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["memory_get", "memory_search"]);
  });

  it("memory_search returns formatted hits", async () => {
    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "export csv" },
    });

    const text = firstText(result);
    expect(text).toContain("redmine-1 — Fixed CSV export");
    expect(text).toContain("result: success");
    expect(text).toContain("missing Content-Type header");
  });

  it("memory_search with no hits returns a readable message", async () => {
    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "kubernetes" },
    });

    expect(firstText(result)).toBe("No results in memory.");
  });

  it("memory_search respects the limit", async () => {
    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "export export", limit: 1 },
    });

    expect(firstText(result).match(/###/g)).toHaveLength(1);
  });

  it("memory_get returns the full task history with attempt errors", async () => {
    const result = await client.callTool({
      name: "memory_get",
      arguments: { taskId: "redmine-1" },
    });

    const text = firstText(result);
    expect(text).toContain("Fixed CSV export");
    expect(text).toContain("Export regression");
    expect(text).toContain("Error: timeout");
    expect(text).toContain("result: failure");
  });

  it("memory_get returns a readable message for an unknown task", async () => {
    const result = await client.callTool({
      name: "memory_get",
      arguments: { taskId: "missing" },
    });

    expect(firstText(result)).toBe("No summaries for this task.");
  });
});
