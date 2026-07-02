#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { startCommand } from "./start.js";
import { configureCommand } from "./configure.js";

const main = defineCommand({
  meta: {
    name: "claude-worker",
    description:
      "Dwuagentowy worker Claude Code: monitor cyklicznie zgłasza zadania, egzekutor je wykonuje",
  },
  subCommands: {
    start: startCommand,
    configure: configureCommand,
  },
});

void runMain(main);
