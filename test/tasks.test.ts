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

  it("takeNext zlicza próby wykonania", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("a")]);

    const taken = await store.takeNext();

    expect(taken?.attempts).toBe(1);
  });

  it("requeue przywraca zadanie do pending, zachowuje próby i zapisuje błąd", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("a")]);
    await store.takeNext();

    await store.requeue("a", "zerwane połączenie");

    expect(store.list()[0]).toMatchObject({
      id: "a",
      status: "pending",
      attempts: 1,
      error: "zerwane połączenie",
    });

    const again = await store.takeNext();
    expect(again?.attempts).toBe(2);
  });

  it("requeue nieznanego id jest ignorowane", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("a")]);

    await store.requeue("nie-ma", "błąd");

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.status).toBe("pending");
  });

  it("wczytuje magazyn w starym formacie bez pola attempts", async () => {
    await TaskStore.open(path);
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: "stare",
            title: "Stare zadanie",
            description: "Opis",
            status: "pending",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    const reopened = await TaskStore.open(path);

    expect(reopened.list()[0]?.attempts).toBe(0);
  });

  it("list zwraca kopie zadań — mutacja wyniku nie psuje magazynu", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("a")]);

    const listed = store.list();
    expect(listed.map((t) => t.id)).toEqual(["a"]);

    const first = listed[0];
    if (!first) throw new Error("oczekiwano zadania na liście");
    first.status = "failed";
    expect(store.list()[0]?.status).toBe("pending");
    expect(store.pendingCount()).toBe(1);
  });

  it("onChange powiadamia świeżym snapshotem po każdej mutacji", async () => {
    const store = await TaskStore.open(path);
    const snapshots: string[][] = [];
    store.onChange((tasks) => snapshots.push(tasks.map((t) => `${t.id}:${t.status}`)));

    await store.addTasks([newTask("a")]);
    await store.takeNext();
    await store.complete("a");

    expect(snapshots).toEqual([["a:pending"], ["a:in_progress"], ["a:done"]]);
  });

  it("onChange nie powiadamia, gdy mutacja nic nie zmienia", async () => {
    const store = await TaskStore.open(path);
    await store.addTasks([newTask("a")]);
    const calls: number[] = [];
    store.onChange((tasks) => calls.push(tasks.length));

    await store.addTasks([newTask("a")]);

    expect(calls).toEqual([]);
  });

  it("unsubscribe z onChange przestaje powiadamiać", async () => {
    const store = await TaskStore.open(path);
    let calls = 0;
    const unsubscribe = store.onChange(() => {
      calls += 1;
    });

    await store.addTasks([newTask("a")]);
    expect(calls).toBe(1);

    unsubscribe();
    await store.addTasks([newTask("b")]);
    expect(calls).toBe(1);
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
