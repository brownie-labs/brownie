import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BROWNIE_DIR_NAME,
  CONTROL_SOCKET_ENV,
  controlSocketPath,
  InvalidControlSocketPathError,
  packagePromptsDir,
  packageRootDir,
  projectPaths,
  systemPromptFiles,
} from "../src/paths.js";
import { snapshotEnv } from "./helpers.js";

describe("projectPaths", () => {
  it("derives the full .brownie layout from the project directory", () => {
    const paths = projectPaths("/proj");
    const brownieDir = join("/proj", BROWNIE_DIR_NAME);
    expect(paths).toEqual({
      projectDir: "/proj",
      brownieDir,
      settingsFile: join(brownieDir, "settings.json"),
      promptsDir: join(brownieDir, "prompts"),
      monitorPromptFile: join(brownieDir, "prompts", "monitor.prompt.md"),
      executorPromptFile: join(brownieDir, "prompts", "executor.prompt.md"),
      dataDir: join(brownieDir, "data"),
      tasksFile: join(brownieDir, "data", "tasks.json"),
      memoryDbFile: join(brownieDir, "data", "memory.db"),
      logsDir: join(brownieDir, "logs"),
      gitignoreFile: join(brownieDir, ".gitignore"),
    });
  });

  it("defaults to process.cwd()", () => {
    expect(projectPaths().projectDir).toBe(process.cwd());
  });
});

describe("package prompts", () => {
  it("points at the prompts directory inside the package root", () => {
    expect(packagePromptsDir).toBe(join(packageRootDir, "prompts"));
  });

  it("ships all three system prompts", () => {
    const files = systemPromptFiles();
    expect(existsSync(files.monitor)).toBe(true);
    expect(existsSync(files.executor)).toBe(true);
    expect(existsSync(files.summarizer)).toBe(true);
  });

  it("builds system prompt paths from a custom directory", () => {
    expect(systemPromptFiles("/sys")).toEqual({
      monitor: join("/sys", "monitor.system.md"),
      executor: join("/sys", "executor.system.md"),
      summarizer: join("/sys", "summarizer.system.md"),
    });
  });
});

describe("controlSocketPath", () => {
  it("derives a stable per-project socket path outside the project", () => {
    const first = controlSocketPath("/proj");
    const second = controlSocketPath("/proj");
    expect(first).toBe(second);
    expect(first).not.toContain("/proj");
    expect(first).toMatch(/brownie-\d+-[0-9a-f]{16}\.sock$/);
  });

  it("gives different projects different sockets", () => {
    expect(controlSocketPath("/proj-a")).not.toBe(controlSocketPath("/proj-b"));
  });

  it("stays comfortably under the unix socket path limit", () => {
    expect(controlSocketPath("/a/very/deeply/nested/project/dir").length).toBeLessThan(
      104,
    );
  });

  it("defaults to the current working directory", () => {
    expect(controlSocketPath()).toBe(controlSocketPath(process.cwd()));
  });

  it("uses a named pipe on Windows", () => {
    expect(controlSocketPath("/proj", { platform: "win32", env: {} })).toMatch(
      /^\\\\\.\\pipe\\brownie-\d+-[0-9a-f]{16}$/,
    );
  });

  describe(`${CONTROL_SOCKET_ENV} override`, () => {
    it("returns an absolute override verbatim regardless of the project", () => {
      const env = { [CONTROL_SOCKET_ENV]: "/run/brownie/control.sock" };
      expect(controlSocketPath("/proj-a", { env })).toBe("/run/brownie/control.sock");
      expect(controlSocketPath("/proj-b", { env })).toBe("/run/brownie/control.sock");
    });

    it("treats an empty or blank value as unset", () => {
      const derived = controlSocketPath("/proj", { env: {} });
      expect(controlSocketPath("/proj", { env: { [CONTROL_SOCKET_ENV]: "" } })).toBe(
        derived,
      );
      expect(controlSocketPath("/proj", { env: { [CONTROL_SOCKET_ENV]: "   " } })).toBe(
        derived,
      );
    });

    it("rejects a relative path", () => {
      const env = { [CONTROL_SOCKET_ENV]: "run/control.sock" };
      expect(() => controlSocketPath("/proj", { env })).toThrow(
        InvalidControlSocketPathError,
      );
      expect(() => controlSocketPath("/proj", { env })).toThrow(/absolute path/);
    });

    it("rejects a path at or beyond the unix socket limit", () => {
      const env = { [CONTROL_SOCKET_ENV]: `/${"x".repeat(119)}` };
      expect(() => controlSocketPath("/proj", { env })).toThrow(/120 bytes/);
      expect(() => controlSocketPath("/proj", { env })).toThrow(/104 bytes/);
    });

    it("passes a named pipe through unvalidated on Windows", () => {
      const env = { [CONTROL_SOCKET_ENV]: "\\\\.\\pipe\\brownie-custom" };
      expect(controlSocketPath("/proj", { env, platform: "win32" })).toBe(
        "\\\\.\\pipe\\brownie-custom",
      );
    });

    it("reads the real environment by default", () => {
      const restoreEnv = snapshotEnv();
      process.env[CONTROL_SOCKET_ENV] = "/tmp/brownie-env-test.sock";
      try {
        expect(controlSocketPath("/proj")).toBe("/tmp/brownie-env-test.sock");
      } finally {
        restoreEnv();
      }
    });
  });
});
