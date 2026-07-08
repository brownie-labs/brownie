import { defineCommand } from "citty";
import { mcpServeCommand } from "./memory/mcp.js";

export const mcpCommand = defineCommand({
  meta: {
    name: "mcp",
    description: "Internal MCP utilities",
  },
  subCommands: {
    serve: mcpServeCommand,
  },
});
