import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { patchSettings, readRawSettings, settingsSection } from "../src/settings-file.js";
import { createTempDir, removeTempDir } from "./helpers.js";

describe("readRawSettings", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await createTempDir();
    file = join(dir, "settings.json");
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it("throws a configure hint when the file is missing", async () => {
    await expect(readRawSettings(file)).rejects.toThrow(/interactive terminal/);
  });

  it("throws a readable error on invalid JSON", async () => {
    await writeFile(file, "{", "utf8");
    await expect(readRawSettings(file)).rejects.toThrow(/Invalid JSON in/);
  });

  it("rejects non-object roots", async () => {
    await writeFile(file, "[1, 2]", "utf8");
    await expect(readRawSettings(file)).rejects.toThrow(/expected a JSON object/);
  });

  it("returns the parsed object", async () => {
    await writeFile(file, '{"monitor":{"model":"sonnet"}}', "utf8");
    await expect(readRawSettings(file)).resolves.toEqual({
      monitor: { model: "sonnet" },
    });
  });
});

describe("settingsSection", () => {
  it("returns an existing object section", () => {
    const monitor = { model: "sonnet" };
    const raw: Record<string, unknown> = { monitor };
    expect(settingsSection(raw, "monitor")).toBe(monitor);
  });

  it("creates a missing section and replaces non-object values", () => {
    const raw: Record<string, unknown> = { executor: "oops" };
    const monitor = settingsSection(raw, "monitor");
    const executor = settingsSection(raw, "executor");
    expect(raw.monitor).toBe(monitor);
    expect(raw.executor).toBe(executor);
    expect(executor).toEqual({});
  });
});

describe("patchSettings", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await createTempDir();
    file = join(dir, "settings.json");
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it("patches only the mutated keys and keeps the file sparse", async () => {
    await writeFile(file, '{\n  "streamPartial": false\n}\n', "utf8");
    const settings = await patchSettings(file, (raw) => {
      settingsSection(raw, "monitor").model = "opus";
    });
    expect(settings.monitor.model).toBe("opus");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      streamPartial: false,
      monitor: { model: "opus" },
    });
    expect(await readFile(file, "utf8")).toMatch(/\n$/);
  });

  it("rejects an invalid patch before writing anything", async () => {
    const original = '{\n  "monitor": {\n    "model": "haiku"\n  }\n}\n';
    await writeFile(file, original, "utf8");
    await expect(
      patchSettings(file, (raw) => {
        settingsSection(raw, "monitor").activeHours = "not-a-window";
      }),
    ).rejects.toThrow(/monitor\.activeHours/);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("rejects unknown keys via the strict schema", async () => {
    await writeFile(file, "{}\n", "utf8");
    await expect(
      patchSettings(file, (raw) => {
        raw.montior = {};
      }),
    ).rejects.toThrow(/montior/);
  });

  it("leaves no temporary file behind", async () => {
    await writeFile(file, "{}\n", "utf8");
    await patchSettings(file, (raw) => {
      settingsSection(raw, "executor").model = "sonnet";
    });
    expect(await readdir(dir)).toEqual(["settings.json"]);
  });
});
