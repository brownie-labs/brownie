import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempDir, fixturesDir, removeTempDir } from "./helpers.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tsxBin = join(projectRoot, "node_modules", ".bin", "tsx");
const entry = join(projectRoot, "src", "index.ts");

interface Run {
  code: number | null;
  output: string;
}

function runCli(
  cwd: string,
  env: NodeJS.ProcessEnv,
  interruptAfterMs?: number,
): Promise<Run> {
  const outPath = join(cwd, "stdout.log");
  const errPath = join(cwd, "stderr.log");
  const outFd = openSync(outPath, "w");
  const errFd = openSync(errPath, "w");
  const close = () => {
    closeSync(outFd);
    closeSync(errFd);
  };
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(tsxBin, [entry, "start"], {
      cwd,
      env,
      stdio: ["ignore", outFd, errFd],
    });
    child.on("error", (err) => {
      close();
      rejectPromise(err);
    });
    child.on("close", async (code) => {
      close();
      const [out, err] = await Promise.all([
        readFile(outPath, "utf8"),
        readFile(errPath, "utf8"),
      ]);
      resolvePromise({ code, output: `${out}${err}` });
    });

    if (interruptAfterMs != null) {
      setTimeout(() => child.kill("SIGINT"), interruptAfterMs);
    }
  });
}

describe("CLI start (smoke E2E)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(() => removeTempDir(dir));

  it(
    "uruchamia sesję i kończy czysto po SIGINT",
    async () => {
      await mkdir(join(dir, "prompts"), { recursive: true });
      await writeFile(join(dir, "prompts", "prompt.md"), "zadanie\n", "utf8");
      await writeFile(join(dir, "prompts", "system.md"), "system\n", "utf8");
      await writeFile(join(dir, ".env"), "CLAUDE_WORKER_INTERVAL_MS=1000\n", "utf8");

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${fixturesDir}${delimiter}${process.env.PATH ?? ""}`,
        FAKE_CLAUDE_MODE: "ok",
        CONSOLA_LEVEL: "5",
      };

      const result = await runCli(dir, env, 4000);

      expect(result.output).toMatch(/Worker uruchomiony/);
      expect(result.output).toMatch(/Koniec sesji #1/);
      expect(result.output).toMatch(/Scheduler zatrzymany/);
    },
    30_000,
  );

  it(
    "kończy z kodem 1, gdy preflight nie przechodzi (brak .env)",
    async () => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${fixturesDir}${delimiter}${process.env.PATH ?? ""}`,
      };

      const result = await runCli(dir, env);

      expect(result.code).toBe(1);
      expect(result.output).toMatch(/Preflight nieudany|brak pliku/);
    },
    30_000,
  );
});
