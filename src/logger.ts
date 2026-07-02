import { createConsola } from "consola";

export const logger = createConsola({
  formatOptions: {
    date: true,
    colors: true,
    compact: false,
  },
});

export const monitorLogger = logger.withTag("monitor");
export const executorLogger = logger.withTag("executor");
