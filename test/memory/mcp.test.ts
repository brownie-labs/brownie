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
  if (block?.type !== "text") throw new Error("brak bloku tekstowego");
  return block.text;
}

describe("buildMcpConfig", () => {
  it("dla wejścia .ts uruchamia serwer przez tsx", () => {
    const config = JSON.parse(
      buildMcpConfig("/dane/memory.db", "/repo/src/index.ts"),
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
      "/dane/memory.db",
    ]);
  });

  it("dla wejścia .js uruchamia serwer bezpośrednio nodem", () => {
    const config = JSON.parse(
      buildMcpConfig("/dane/memory.db", "/repo/dist/index.js"),
    ) as {
      mcpServers: { memory: { command: string; args: string[] } };
    };

    expect(config.mcpServers.memory.args).toEqual([
      "/repo/dist/index.js",
      "mcp",
      "--db",
      "/dane/memory.db",
    ]);
  });
});

describe("serwer MCP pamięci", () => {
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
      title: "Napraw eksport",
      headline: "Naprawiono eksport CSV",
      summary: "Przyczyną był brak nagłówka Content-Type.",
      error: undefined,
      sessionId: "sesja-1",
      createdAt: "2026-07-02T10:00:00.000Z",
    });
    store.add({
      taskId: "redmine-1",
      attempt: 2,
      ok: false,
      title: "Napraw eksport",
      headline: "Regresja eksportu",
      summary: "Deploy nadpisał poprawkę.",
      error: "timeout",
      sessionId: "sesja-2",
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

  it("wystawia narzędzia memory_search i memory_get", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["memory_get", "memory_search"]);
  });

  it("memory_search zwraca sformatowane trafienia", async () => {
    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "eksport csv" },
    });

    const text = firstText(result);
    expect(text).toContain("redmine-1 — Naprawiono eksport CSV");
    expect(text).toContain("wynik: sukces");
    expect(text).toContain("brak nagłówka Content-Type");
  });

  it("memory_search bez trafień zwraca czytelny komunikat", async () => {
    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "kubernetes" },
    });

    expect(firstText(result)).toBe("Brak wyników w pamięci.");
  });

  it("memory_search respektuje limit", async () => {
    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "eksportu eksport", limit: 1 },
    });

    expect(firstText(result).match(/###/g)).toHaveLength(1);
  });

  it("memory_get zwraca pełną historię zadania z błędami prób", async () => {
    const result = await client.callTool({
      name: "memory_get",
      arguments: { taskId: "redmine-1" },
    });

    const text = firstText(result);
    expect(text).toContain("Naprawiono eksport CSV");
    expect(text).toContain("Regresja eksportu");
    expect(text).toContain("Błąd: timeout");
    expect(text).toContain("wynik: porażka");
  });

  it("memory_get dla nieznanego zadania zwraca czytelny komunikat", async () => {
    const result = await client.callTool({
      name: "memory_get",
      arguments: { taskId: "brak" },
    });

    expect(firstText(result)).toBe("Brak podsumowań dla tego zadania.");
  });
});
