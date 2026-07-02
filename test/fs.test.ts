import { constants } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertReadable, canAccess } from "../src/fs.js";
import { createTempDir, removeTempDir } from "./helpers.js";

describe("canAccess", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await createTempDir();
    file = join(dir, "file.txt");
    await writeFile(file, "content", "utf8");
  });

  afterEach(() => removeTempDir(dir));

  it("returns true for an existing file with R_OK", async () => {
    expect(await canAccess(file, constants.R_OK)).toBe(true);
  });

  it("returns false for a non-existent file", async () => {
    expect(await canAccess(join(dir, "missing.txt"), constants.R_OK)).toBe(false);
  });

  it("returns false when a regular file lacks execute permission", async () => {
    expect(await canAccess(file, constants.X_OK)).toBe(false);
  });
});

describe("assertReadable", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(() => removeTempDir(dir));

  it("does not throw for a readable file", async () => {
    const file = join(dir, "ok.txt");
    await writeFile(file, "x", "utf8");
    await expect(assertReadable(file, "test file")).resolves.toBeUndefined();
  });

  it("throws with the label and path for a non-existent file", async () => {
    const missing = join(dir, "missing.txt");
    await expect(assertReadable(missing, "test file")).rejects.toThrow(
      new RegExp(`test file.*${missing.replace(/[.]/g, "\\.")}`),
    );
  });
});
