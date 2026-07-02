#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { startCommand } from "./start.js";
import { configureCommand } from "./configure.js";
import { mcpCommand } from "./memory/mcp.js";

const main = defineCommand({
  meta: {
    name: "brownie",
    description:
      "Two-agent Claude Code worker: the monitor reports tasks on a cycle, the executor completes them",
  },
  subCommands: {
    start: startCommand,
    configure: configureCommand,
    mcp: mcpCommand,
  },
});

void runMain(main);
