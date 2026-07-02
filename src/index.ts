#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { startCommand } from "./start.js";
import { configureCommand } from "./configure.js";

const main = defineCommand({
  meta: {
    name: "claude-worker",
    description: "Cyklicznie uruchamia sesje Claude Code (claude -p) w stałym rytmie",
  },
  subCommands: {
    start: startCommand,
    configure: configureCommand,
  },
});

void runMain(main);
