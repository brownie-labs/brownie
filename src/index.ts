#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { startCommand } from "./start.js";
import { configureCommand } from "./configure.js";
import { mcpCommand } from "./memory/mcp.js";

const main = defineCommand({
  meta: {
    name: "brownie",
    description:
      "Dwuagentowy worker Claude Code: monitor cyklicznie zgłasza zadania, egzekutor je wykonuje",
  },
  subCommands: {
    start: startCommand,
    configure: configureCommand,
    mcp: mcpCommand,
  },
});

void runMain(main);
