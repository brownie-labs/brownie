import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { defineCommand } from "citty";
import { z } from "zod";
import { MemoryStore, type TaskSummaryRecord } from "./store.js";

export type MemoryReader = Pick<MemoryStore, "search" | "get">;

export function buildMcpConfig(
  dbPath: string,
  entry: string = process.argv[1] ?? "",
): string {
  const args = entry.endsWith(".ts")
    ? ["--import", "tsx", entry, "mcp", "--db", dbPath]
    : [entry, "mcp", "--db", dbPath];
  return JSON.stringify({
    mcpServers: { memory: { command: process.execPath, args } },
  });
}

function formatRecord(record: TaskSummaryRecord): string {
  const status = record.ok ? "sukces" : "porażka";
  const lines = [
    `### ${record.taskId} — ${record.headline}`,
    `Zadanie: ${record.title}`,
    `Próba: ${record.attempt}, wynik: ${status}, data: ${record.createdAt}`,
  ];
  if (record.error !== undefined) lines.push(`Błąd: ${record.error}`);
  lines.push("", record.summary);
  return lines.join("\n");
}

function textResult(records: TaskSummaryRecord[], emptyMessage: string) {
  const text =
    records.length === 0 ? emptyMessage : records.map(formatRecord).join("\n\n---\n\n");
  return { content: [{ type: "text" as const, text }] };
}

export function createMemoryMcpServer(reader: MemoryReader): McpServer {
  const server = new McpServer({ name: "brownie-memory", version: "1.0.0" });

  server.registerTool(
    "memory_search",
    {
      title: "Wyszukiwanie w pamięci zadań",
      description:
        "Pełnotekstowa wyszukiwarka pamięci długoterminowej: podsumowania wcześniej " +
        "wykonanych zadań (decyzje, ślepe uliczki, pułapki). Wyniki posortowane po " +
        "trafności.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Słowa kluczowe, np. źródło zadania, projekt, komunikat błędu"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maksymalna liczba wyników (domyślnie 10)"),
      },
    },
    ({ query, limit }) =>
      textResult(reader.search(query, limit ?? 10), "Brak wyników w pamięci."),
  );

  server.registerTool(
    "memory_get",
    {
      title: "Historia podsumowań zadania",
      description:
        "Zwraca wszystkie podsumowania sesji dla zadania o podanym ID, " +
        "w kolejności chronologicznej.",
      inputSchema: {
        taskId: z
          .string()
          .min(1)
          .describe("Dokładny identyfikator zadania (pole „ID” z opisu zadania)"),
      },
    },
    ({ taskId }) => textResult(reader.get(taskId), "Brak podsumowań dla tego zadania."),
  );

  return server;
}

export async function runMemoryMcpServer(dbPath: string): Promise<void> {
  const store = MemoryStore.open(dbPath, { readOnly: true });
  const server = createMemoryMcpServer(store);
  await server.connect(new StdioServerTransport());
}

export const mcpCommand = defineCommand({
  meta: {
    name: "mcp",
    description: "Serwer MCP (stdio) z pamięcią podsumowań zadań dla sesji egzekutora",
  },
  args: {
    db: {
      type: "string",
      required: true,
      description: "Ścieżka do pliku bazy pamięci (SQLite)",
    },
  },
  run: ({ args }) => runMemoryMcpServer(args.db),
});
