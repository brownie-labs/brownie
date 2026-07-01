import { defineCommand, runMain } from "citty";
import { envFileArg, startCommand, startWorker } from "./start.js";
import { initCommand } from "./init.js";

const main = defineCommand({
  meta: {
    name: "claude-worker",
    description: "Cyklicznie uruchamia sesje Claude Code (claude -p) w stałym rytmie",
  },
  subCommands: {
    init: initCommand,
    start: startCommand,
  },
  args: envFileArg,
  run: ({ args }) => startWorker(args["env-file"]),
});

runMain(main);
