import { createConsola } from "consola";

export const logger = createConsola({
  formatOptions: {
    date: true,
    colors: true,
    compact: false,
  },
});

export const sessionLogger = logger.withTag("session");
