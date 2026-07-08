#!/usr/bin/env node
import { runMain } from "citty";
import { mainCommand } from "./main.js";
import { mcpCommand } from "./mcp-command.js";

const rawArgs = process.argv.slice(2);

void (rawArgs[0] === "mcp"
  ? runMain(mcpCommand, { rawArgs: rawArgs.slice(1) })
  : runMain(mainCommand, { rawArgs }));
