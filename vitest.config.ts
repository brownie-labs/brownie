import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 15_000,
    env: {
      CI: "false",
      CONTINUOUS_INTEGRATION: "false",
    },
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts", "src/logger.ts", "src/types.ts", "src/ui/mount.tsx"],
      reporter: ["text", "html"],
      thresholds: {
        statements: 92,
        branches: 75,
        functions: 90,
        lines: 94,
      },
    },
  },
});
