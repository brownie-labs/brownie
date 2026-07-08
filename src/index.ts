#!/usr/bin/env node
import { runMain } from "citty";
import { pauseCommand, resumeCommand, statusCommand } from "./control-commands.js";
import { initCommand } from "./init-command.js";
import { mainCommand } from "./main.js";
import { mcpCommand } from "./mcp-command.js";

const rawArgs = process.argv.slice(2);
const [first, ...rest] = rawArgs;

switch (first) {
  case "mcp":
    void runMain(mcpCommand, { rawArgs: rest });
    break;
  case "init":
    void runMain(initCommand, { rawArgs: rest });
    break;
  case "status":
    void runMain(statusCommand, { rawArgs: rest });
    break;
  case "pause":
    void runMain(pauseCommand, { rawArgs: rest });
    break;
  case "resume":
    void runMain(resumeCommand, { rawArgs: rest });
    break;
  default:
    void runMain(mainCommand, { rawArgs });
}
