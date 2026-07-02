import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskStore } from "../src/tasks.js";
import type { NewTask } from "../src/types.js";
import { createTempDir, removeTempDir } from "./helpers.js";

function newTask(id: string, overrides: Partial<NewTask> = {}): NewTask {
  return { id, title: `Zadanie ${id}`, description: `Opis ${id}`, ...overrides };
}

describe("TaskStore", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await createTempDir();
    path = join(dir, "data", "tasks.json");
  });

  afterEach(() => removeTempDir(dir));

  it("otwiera pusty magazyn, gdy plik nie istnieje", async () => {
    const store = await TaskStore.open(path);
    expect(store.pendingCount()).toBe(0);
    expect(await store.takeNext()).toBeUndefined();
  });

  it("dodaje nowe zadania i zwraca faktycznie dodane", async () => {
    const store = await TaskStore.open(path);
    const added = await store.addTasks([newTask("a"), newTask("b")]);

    expect(added.map((t) => t.id)).toEqual(["a", "b"]);
    expect(added[0]?.status).toBe("pending");
    expect(store.pendingCount()).toBe(2);
  });

  it("deduplikuje względem oczekujących zadań", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("a")]);

    const added = await store.addTasks([newTask("a"), newTask("b")]);

    expect(added.map((t) => t.id)).toEqual(["b"]);
    expect(store.pendingCount()).toBe(2);
  });

  it("deduplikuje względem historii (done i failed)", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("done-1"), newTask("failed-1")]);
    await store.takeNext();
    await store.complete("done-1");
    await store.takeNext();
    await store.fail("failed-1", "błąd");

    const added = await store.addTasks([newTask("done-1"), newTask("failed-1")]);

    expect(added).toEqual([]);
    expect(store.pendingCount()).toBe(0);
  });

  it("takeNext zwraca najstarsze pending i oznacza je in_progress", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("a"), newTask("b")]);

    const first = await store.takeNext();
    const second = await store.takeNext();

    expect(first?.id).toBe("a");
    expect(first?.status).toBe("in_progress");
    expect(second?.id).toBe("b");
    expect(await store.takeNext()).toBeUndefined();
  });

  it("complete i fail utrwalają status z błędem", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("a"), newTask("b")]);
    await store.takeNext();
    await store.complete("a");
    await store.takeNext();
    await store.fail("b", "nie wyszło");

    const file = JSON.parse(await readFile(path, "utf8")) as {
      tasks: { id: string; status: string; error?: string }[];
    };
    const byId = new Map(file.tasks.map((t) => [t.id, t]));
    expect(byId.get("a")?.status).toBe("done");
    expect(byId.get("b")?.status).toBe("failed");
    expect(byId.get("b")?.error).toBe("nie wyszło");
  });

  it("zachowuje zadania po ponownym otwarciu", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("a")]);

    const reopened = await TaskStore.open(path);

    expect(reopened.pendingCount()).toBe(1);
    expect((await reopened.takeNext())?.id).toBe("a");
  });

  it("resetuje osierocone in_progress do pending przy otwarciu", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("a")]);
    await store.takeNext();

    const reopened = await TaskStore.open(path);

    expect(reopened.pendingCount()).toBe(1);
    expect((await reopened.takeNext())?.id).toBe("a");
  });

  it("nie zostawia pliku tymczasowego po zapisie", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("a")]);

    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(existsSync(path)).toBe(true);
  });

  it("rzuca czytelny błąd przy uszkodzonym JSON", async () => {
    await TaskStore.open(path);
    await writeFile(path, "to nie json", "utf8");

    await expect(TaskStore.open(path)).rejects.toThrow(/Uszkodzony plik magazynu zadań/);
  });

  it("rzuca czytelny błąd przy niezgodnym formacie", async () => {
    await TaskStore.open(path);
    await writeFile(path, JSON.stringify({ version: 2, tasks: [] }), "utf8");

    await expect(TaskStore.open(path)).rejects.toThrow(/niezgodny format/);
  });

  it("współbieżne mutacje nie przeplatają się i zostawiają spójny plik", async () => {
    const store = await TaskStore.open(path);
    const ids = Array.from({ length: 20 }, (_, i) => `t-${i}`);

    await Promise.all(ids.map((id) => store.addTasks([newTask(id)])));
    await Promise.all([
      store.takeNext(),
      store.takeNext(),
      store.addTasks([newTask("t-1"), newTask("extra")]),
    ]);

    const file = JSON.parse(await readFile(path, "utf8")) as {
      tasks: { id: string; status: string }[];
    };
    expect(file.tasks).toHaveLength(21);
    expect(file.tasks.filter((t) => t.status === "in_progress")).toHaveLength(2);
    expect(store.pendingCount()).toBe(19);
  });
});
