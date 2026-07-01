import { defineCommand, runMain } from "citty";
import { envFileArg, startCommand, startWorker } from "./start.js";
import { configureCommand } from "./configure.js";

const main = defineCommand({
  meta: {
    name: "claude-worker",
    description: "Cyklicznie uruchamia sesje Claude Code (claude -p) w stałym rytmie",
  },
  subCommands: {
    configure: configureCommand,
    start: startCommand,
  },
  args: envFileArg,
  run: ({ args }) => startWorker(args["env-file"]),
});

runMain(main);
