import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPromptFileAccess, type PromptFileAccess } from "../src/prompt-files.js";
import { createTempDir, removeTempDir } from "./helpers.js";

describe("createPromptFileAccess", () => {
  let dir: string;
  let access: PromptFileAccess;

  beforeEach(async () => {
    dir = await createTempDir();
    access = createPromptFileAccess({
      monitor: join(dir, "monitor.prompt.md"),
      executor: join(dir, "executor.prompt.md"),
    });
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it("reads the file content without the trailing newline", async () => {
    await writeFile(join(dir, "monitor.prompt.md"), "watch things\n", "utf8");
    await expect(access.read("monitor")).resolves.toBe("watch things");
  });

  it("rejects when the file is missing", async () => {
    await expect(access.read("executor")).rejects.toThrow(/ENOENT/);
  });

  it("writes with a single trailing newline and per-agent paths", async () => {
    await access.write("monitor", "# Watch\n- CI\n\n");
    await access.write("executor", "be diligent");
    expect(await readFile(join(dir, "monitor.prompt.md"), "utf8")).toBe(
      "# Watch\n- CI\n",
    );
    expect(await readFile(join(dir, "executor.prompt.md"), "utf8")).toBe("be diligent\n");
  });

  it("leaves no temporary file behind", async () => {
    await access.write("monitor", "content");
    expect(await readdir(dir)).toEqual(["monitor.prompt.md"]);
  });
});
