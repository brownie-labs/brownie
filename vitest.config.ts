import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts", "src/logger.ts", "src/types.ts"],
    },
  },
});
