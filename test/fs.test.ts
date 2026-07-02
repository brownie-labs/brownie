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
    file = join(dir, "plik.txt");
    await writeFile(file, "treść", "utf8");
  });

  afterEach(() => removeTempDir(dir));

  it("zwraca true dla istniejącego pliku z R_OK", async () => {
    expect(await canAccess(file, constants.R_OK)).toBe(true);
  });

  it("zwraca false dla nieistniejącego pliku", async () => {
    expect(await canAccess(join(dir, "brak.txt"), constants.R_OK)).toBe(false);
  });

  it("zwraca false gdy brak prawa wykonywania na zwykłym pliku", async () => {
    expect(await canAccess(file, constants.X_OK)).toBe(false);
  });
});

describe("assertReadable", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(() => removeTempDir(dir));

  it("nie rzuca dla czytelnego pliku", async () => {
    const file = join(dir, "ok.txt");
    await writeFile(file, "x", "utf8");
    await expect(assertReadable(file, "plik testowy")).resolves.toBeUndefined();
  });

  it("rzuca z etykietą i ścieżką dla nieistniejącego pliku", async () => {
    const missing = join(dir, "nie-ma.txt");
    await expect(assertReadable(missing, "plik testowy")).rejects.toThrow(
      new RegExp(`plik testowy.*${missing.replace(/[.]/g, "\\.")}`),
    );
  });
});
