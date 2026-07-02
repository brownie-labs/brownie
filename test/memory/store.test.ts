import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MemoryStore,
  toMatchQuery,
  type NewTaskSummaryRecord,
} from "../../src/memory/store.js";
import { createTempDir, removeTempDir } from "../helpers.js";

function buildRecord(
  overrides: Partial<NewTaskSummaryRecord> = {},
): NewTaskSummaryRecord {
  return {
    taskId: "redmine-1",
    attempt: 1,
    ok: true,
    title: "Napraw eksport",
    headline: "Naprawiono eksport CSV",
    summary: "Przyczyną był brak nagłówka Content-Type.",
    error: undefined,
    sessionId: "sesja-1",
    createdAt: "2026-07-02T10:00:00.000Z",
    ...overrides,
  };
}

describe("toMatchQuery", () => {
  it("skleja tokeny w alternatywę fraz w cudzysłowach", () => {
    expect(toMatchQuery("błąd połączenia redmine")).toBe(
      '"błąd" OR "połączenia" OR "redmine"',
    );
  });

  it("neutralizuje składnię FTS5", () => {
    expect(toMatchQuery('redmine AND "eksport" (NOT x*)')).toBe(
      '"redmine" OR "AND" OR "eksport" OR "NOT" OR "x"',
    );
  });

  it("zwraca null dla pustych zapytań", () => {
    expect(toMatchQuery("")).toBeNull();
    expect(toMatchQuery('   ()"* ')).toBeNull();
  });
});

describe("MemoryStore", () => {
  let dir: string;
  let dbPath: string;
  let store: MemoryStore;

  beforeEach(async () => {
    dir = await createTempDir();
    dbPath = join(dir, "data", "memory.db");
    store = MemoryStore.open(dbPath);
  });

  afterEach(async () => {
    store.close();
    await removeTempDir(dir);
  });

  it("tworzy plik bazy razem z brakującym katalogiem", () => {
    const record = store.add(buildRecord());
    expect(record.id).toBeGreaterThan(0);
  });

  it("add zwraca rekord z nadanym id, a get czyta historię zadania w kolejności zapisu", () => {
    const first = store.add(buildRecord({ ok: false, error: "timeout" }));
    const second = store.add(buildRecord({ attempt: 2, headline: "Druga próba" }));
    store.add(buildRecord({ taskId: "redmine-2", headline: "Inne zadanie" }));

    const history = store.get("redmine-1");
    expect(history.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(history[0]).toEqual(first);
    expect(history[0]?.ok).toBe(false);
    expect(history[0]?.error).toBe("timeout");
    expect(history[1]?.attempt).toBe(2);
  });

  it("get zwraca pustą listę dla nieznanego zadania", () => {
    expect(store.get("brak")).toEqual([]);
  });

  it("search znajduje rekordy po treści podsumowania", () => {
    store.add(buildRecord({ summary: "Redmine odrzucał żądania bez tokenu API." }));
    store.add(
      buildRecord({
        taskId: "email-1",
        headline: "Obsłużono skrzynkę",
        summary: "Skrzynka IMAP wymaga app password.",
      }),
    );

    const results = store.search("token api redmine");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.taskId).toBe("redmine-1");
  });

  it("search dopasowuje polskie znaki i skleja diakrytyki dekomponowalne", () => {
    store.add(buildRecord({ summary: "Błąd połączenia z bazą danych." }));

    expect(store.search("połączenia")).toHaveLength(1);
    expect(store.search("baza")).toHaveLength(1);
  });

  it("search sortuje po trafności bm25", () => {
    store.add(
      buildRecord({
        taskId: "redmine-2",
        headline: "Wdrożenie aplikacji",
        summary: "Wdrożenie przez deploy.sh, wymaga zmiennej DEPLOY_ENV.",
      }),
    );
    store.add(
      buildRecord({
        taskId: "redmine-3",
        headline: "Poprawka deployu",
        summary: "Deploy padał, bo deploy.sh zakładał obecność deploy-keys.",
      }),
    );

    const results = store.search("deploy");
    expect(results.map((r) => r.taskId)).toEqual(["redmine-3", "redmine-2"]);
  });

  it("search respektuje limit", () => {
    for (let i = 0; i < 5; i += 1) {
      store.add(buildRecord({ taskId: `redmine-${i}`, summary: `wdrożenie ${i}` }));
    }

    expect(store.search("wdrożenie", 2)).toHaveLength(2);
  });

  it("search zwraca pustą listę dla zapytania bez tokenów", () => {
    store.add(buildRecord());
    expect(store.search('"()*')).toEqual([]);
  });

  it("nie zapisuje częściowego rekordu przy błędzie w transakcji", () => {
    store.add(buildRecord());
    const broken = buildRecord({ attempt: 2 });
    Object.defineProperty(broken, "headline", {
      get() {
        return { zła: "wartość" };
      },
    });

    expect(() => store.add(broken)).toThrow();
    expect(store.get("redmine-1")).toHaveLength(1);
    expect(store.search("eksport")).toHaveLength(1);
  });

  it("czytelnik read-only widzi zapisy pisarza i nie może pisać", () => {
    store.add(buildRecord());

    const reader = MemoryStore.open(dbPath, { readOnly: true });
    try {
      expect(reader.get("redmine-1")).toHaveLength(1);

      store.add(buildRecord({ attempt: 2 }));
      expect(reader.get("redmine-1")).toHaveLength(2);

      expect(() => reader.add(buildRecord({ attempt: 3 }))).toThrow();
    } finally {
      reader.close();
    }
  });

  it("open read-only nie tworzy brakującej bazy", () => {
    expect(() =>
      MemoryStore.open(join(dir, "nie-ma", "memory.db"), { readOnly: true }),
    ).toThrow();
  });
});
