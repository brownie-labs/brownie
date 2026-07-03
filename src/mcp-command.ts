import { existsSync } from "node:fs";
import { defineCommand } from "citty";
import { logger } from "./logger.js";
import {
  addMcpServer,
  buildServerDefinition,
  describeServer,
  readMcpServers,
  removeMcpServer,
} from "./mcp-config.js";
import { mcpServeCommand } from "./memory/mcp.js";
import { BROWNIE_DIR_NAME, projectPaths } from "./paths.js";

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function requireMcpFile(): string {
  const paths = projectPaths();
  if (!existsSync(paths.brownieDir)) {
    throw new Error(
      `No ${BROWNIE_DIR_NAME} directory in ${paths.projectDir} — run "brownie config" first`,
    );
  }
  return paths.mcpFile;
}

async function guard(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    logger.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

const addCommand = defineCommand({
  meta: {
    name: "add",
    description: "Add a project-scoped MCP server to .brownie/mcp.json",
  },
  args: {
    name: { type: "positional", required: true, description: "Unique server name" },
    transport: {
      type: "string",
      default: "stdio",
      description: "Transport: stdio (default), http, or sse",
    },
    env: {
      type: "string",
      description: "Environment variable KEY=VALUE for stdio (repeatable)",
    },
    header: {
      type: "string",
      description: "HTTP header Name:Value for http/sse (repeatable)",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Overwrite an existing server with the same name",
    },
  },
  run: ({ args }) =>
    guard(async () => {
      const mcpFile = requireMcpFile();
      const commandParts = args._.slice(1);
      const definition = buildServerDefinition({
        transport: args.transport,
        commandParts,
        env: toArray(args.env),
        header: toArray(args.header),
      });
      await addMcpServer(mcpFile, args.name, definition, { force: args.force });
      logger.success(`Added MCP server "${args.name}" → ${describeServer(definition)}`);
    }),
});

const listCommand = defineCommand({
  meta: { name: "list", description: "List project-scoped MCP servers" },
  run: () =>
    guard(async () => {
      const servers = await readMcpServers(projectPaths().mcpFile);
      const entries = Object.entries(servers);
      if (entries.length === 0) {
        logger.info(`No MCP servers configured (${projectPaths().mcpFile})`);
        return;
      }
      for (const [name, definition] of entries) {
        logger.log(`${name}: ${describeServer(definition)}`);
      }
    }),
});

const getCommand = defineCommand({
  meta: { name: "get", description: "Show the definition of a single MCP server" },
  args: {
    name: { type: "positional", required: true, description: "Server name" },
  },
  run: ({ args }) =>
    guard(async () => {
      const servers = await readMcpServers(projectPaths().mcpFile);
      const definition = servers[args.name];
      if (definition === undefined) {
        throw new Error(`MCP server "${args.name}" not found`);
      }
      logger.log(JSON.stringify(definition, null, 2));
    }),
});

const removeCommand = defineCommand({
  meta: { name: "remove", description: "Remove a project-scoped MCP server" },
  args: {
    name: { type: "positional", required: true, description: "Server name" },
  },
  run: ({ args }) =>
    guard(async () => {
      const mcpFile = requireMcpFile();
      await removeMcpServer(mcpFile, args.name);
      logger.success(`Removed MCP server "${args.name}"`);
    }),
});

export const mcpCommand = defineCommand({
  meta: {
    name: "mcp",
    description: "Manage project-scoped MCP servers available to brownie agents",
  },
  subCommands: {
    serve: mcpServeCommand,
    add: addCommand,
    list: listCommand,
    get: getCommand,
    remove: removeCommand,
  },
});
