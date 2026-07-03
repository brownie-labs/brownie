import { readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";

const stdioServerSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string().trim().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

const remoteServerSchema = z.object({
  type: z.enum(["http", "sse"]),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const mcpServerSchema = z.union([remoteServerSchema, stdioServerSchema]);

export const mcpServersSchema = z.record(mcpServerSchema);

export const mcpFileSchema = z
  .object({ mcpServers: mcpServersSchema.default({}) })
  .strict();

export type McpServerDefinition = z.infer<typeof mcpServerSchema>;
export type McpServers = z.infer<typeof mcpServersSchema>;

export async function readMcpServers(mcpFile: string): Promise<McpServers> {
  let raw: string;
  try {
    raw = await readFile(mcpFile, "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${mcpFile}: ${(err as Error).message}`, {
      cause: err,
    });
  }
  const result = mcpFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid MCP configuration (${mcpFile}):\n${issues}`);
  }
  return result.data.mcpServers;
}

async function writeMcpServers(mcpFile: string, servers: McpServers): Promise<void> {
  const validated = mcpFileSchema.parse({ mcpServers: servers });
  const tmpPath = `${mcpFile}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  await rename(tmpPath, mcpFile);
}

export async function addMcpServer(
  mcpFile: string,
  name: string,
  definition: McpServerDefinition,
  options: { force: boolean },
): Promise<void> {
  const servers = await readMcpServers(mcpFile);
  if (name in servers && !options.force) {
    throw new Error(`MCP server "${name}" already exists — pass --force to overwrite`);
  }
  await writeMcpServers(mcpFile, { ...servers, [name]: definition });
}

export async function removeMcpServer(mcpFile: string, name: string): Promise<void> {
  const servers = await readMcpServers(mcpFile);
  if (!(name in servers)) throw new Error(`MCP server "${name}" not found`);
  const rest = Object.fromEntries(
    Object.entries(servers).filter(([key]) => key !== name),
  );
  await writeMcpServers(mcpFile, rest);
}

function parseKeyValues(
  entries: string[],
  separator: string,
  label: string,
  trimValue: boolean,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const index = entry.indexOf(separator);
    if (index <= 0) {
      throw new Error(`Invalid ${label} "${entry}" — expected KEY${separator}VALUE`);
    }
    const value = entry.slice(index + separator.length);
    result[entry.slice(0, index)] = trimValue ? value.trim() : value;
  }
  return result;
}

export interface ServerDefinitionInput {
  transport: string;
  commandParts: string[];
  env: string[];
  header: string[];
}

export function buildServerDefinition(input: ServerDefinitionInput): McpServerDefinition {
  const transport = input.transport || "stdio";
  if (transport === "stdio") {
    const [command, ...args] = input.commandParts;
    if (command === undefined) {
      throw new Error(
        "Missing command — usage: brownie mcp add <name> [options] -- <command> [args...]",
      );
    }
    const env = parseKeyValues(input.env, "=", "env entry", false);
    return {
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }
  if (transport === "http" || transport === "sse") {
    const [url] = input.commandParts;
    if (url === undefined) {
      throw new Error(
        `Missing URL — usage: brownie mcp add <name> --transport ${transport} <url>`,
      );
    }
    const headers = parseKeyValues(input.header, ":", "header", true);
    return {
      type: transport,
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }
  throw new Error(`Unknown transport "${transport}" — use stdio, http, or sse`);
}

export function describeServer(definition: McpServerDefinition): string {
  if ("url" in definition) return `${definition.type} ${definition.url}`;
  return [definition.command, ...(definition.args ?? [])].join(" ");
}
