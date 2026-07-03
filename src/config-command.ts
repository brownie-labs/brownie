import { defineCommand } from "citty";
import { runConfigure } from "./configure.js";
import { logger } from "./logger.js";

export const configCommand = defineCommand({
  meta: {
    name: "config",
    description: "Run the configuration wizard without starting the worker",
  },
  run: async () => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      logger.error("brownie config requires an interactive terminal.");
      process.exitCode = 1;
      return;
    }
    await runConfigure();
  },
});
