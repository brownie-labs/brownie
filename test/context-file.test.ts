import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContextFileAccess, type ContextFileAccess } from "../src/context-file.js";
import { createTempDir, removeTempDir } from "./helpers.js";

describe("createContextFileAccess", () => {
  let dir: string;
  let path: string;
  let access: ContextFileAccess;

  beforeEach(async () => {
    dir = await createTempDir();
    path = join(dir, "context.md");
    access = createContextFileAccess(path);
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it("reads an absent file as an empty context", async () => {
    await expect(access.read()).resolves.toBe("");
  });

  it("propagates a read failure that is not a missing file", async () => {
    await expect(createContextFileAccess(dir).read()).rejects.toThrow(/EISDIR/);
  });

  it("reads the file content without the trailing newline", async () => {
    await writeFile(path, "# Workspace context\n\nacme-shop\n", "utf8");
    await expect(access.read()).resolves.toBe("# Workspace context\n\nacme-shop");
  });

  it("reads an empty file as an empty context", async () => {
    await writeFile(path, "", "utf8");
    await expect(access.read()).resolves.toBe("");
  });

  it("writes with a single trailing newline", async () => {
    await access.write("# Workspace context\n\n\n");
    expect(await readFile(path, "utf8")).toBe("# Workspace context\n");
  });

  it("clears the context with an empty string", async () => {
    await access.write("# Workspace context");
    await access.write("");
    expect(await readFile(path, "utf8")).toBe("");
    await expect(access.read()).resolves.toBe("");
  });

  it("reads back exactly what was written", async () => {
    const content = "# Workspace context\n\n- `/workspace/api` — git@example.com:api.git";
    await access.write(content);
    await expect(access.read()).resolves.toBe(content);
    await access.write(await access.read());
    await expect(access.read()).resolves.toBe(content);
  });

  it("leaves no temporary file behind", async () => {
    await access.write("content");
    expect(await readdir(dir)).toEqual(["context.md"]);
  });
});
