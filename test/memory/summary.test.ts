import { describe, expect, it } from "vitest";
import {
  composeSummaryPrompt,
  parseSummary,
  type SummaryContext,
} from "../../src/memory/summary.js";
import type { SessionResult, Task } from "../../src/types.js";

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "redmine-1",
    title: "Napraw eksport",
    description: "Eksport CSV zwraca 500.",
    status: "in_progress",
    attempts: 2,
    createdAt: "2026-07-02T10:00:00.000Z",
    updatedAt: "2026-07-02T10:05:00.000Z",
    ...overrides,
  };
}

function buildResult(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    ok: true,
    durationMs: 1000,
    sessionId: "abc",
    ...overrides,
  };
}

describe("parseSummary", () => {
  it("parsuje ostatni blok json z tekstu", () => {
    const text = [
      "Przeanalizowałem log.",
      "```json",
      '{"headline": "pierwszy", "summary": "x"}',
      "```",
      "korekta:",
      "```json",
      '{"headline": "Naprawiono eksport CSV", "summary": "Przyczyną był brak nagłówka."}',
      "```",
    ].join("\n");

    expect(parseSummary(text)).toEqual({
      headline: "Naprawiono eksport CSV",
      summary: "Przyczyną był brak nagłówka.",
    });
  });

  it("parsuje surowy json bez bloku kodu", () => {
    const text = '{"headline": "OK", "summary": "Zrobione."}';
    expect(parseSummary(text)).toEqual({ headline: "OK", summary: "Zrobione." });
  });

  it("toleruje surowe znaki nowej linii wewnątrz stringów", () => {
    const text = '```json\n{"headline": "OK", "summary": "linia 1\nlinia 2"}\n```';
    expect(parseSummary(text)).toEqual({
      headline: "OK",
      summary: "linia 1\nlinia 2",
    });
  });

  it("zwraca null dla zepsutego jsona", () => {
    expect(parseSummary('```json\n{"headline": "OK",\n```')).toBeNull();
  });

  it("zwraca null przy braku wymaganych pól", () => {
    expect(parseSummary('{"headline": "OK"}')).toBeNull();
  });

  it("zwraca null dla pustych pól", () => {
    expect(parseSummary('{"headline": "  ", "summary": "x"}')).toBeNull();
  });

  it("zwraca null dla zwykłego tekstu", () => {
    expect(parseSummary("Nie mam nic do powiedzenia.")).toBeNull();
  });
});

describe("composeSummaryPrompt", () => {
  const logPath = "/tmp/logs/executor/2026-07-02/10-00-00-abc.log";

  function buildContext(overrides: Partial<SummaryContext> = {}): SummaryContext {
    return {
      task: buildTask(),
      result: buildResult(),
      willRetry: false,
      logPath,
      ...overrides,
    };
  }

  it("zawiera dane zadania i ścieżkę logu", () => {
    const prompt = composeSummaryPrompt(buildContext());

    expect(prompt).toContain("ID: redmine-1");
    expect(prompt).toContain("Tytuł: Napraw eksport");
    expect(prompt).toContain("Próba: 2");
    expect(prompt).toContain("Eksport CSV zwraca 500.");
    expect(prompt).toContain(logPath);
    expect(prompt).toContain("Status: sukces");
    expect(prompt).not.toContain("Błąd:");
  });

  it("przy porażce zawiera błąd i informację o ponownej próbie", () => {
    const prompt = composeSummaryPrompt(
      buildContext({
        result: buildResult({ ok: false, error: "timeout sesji" }),
        willRetry: true,
      }),
    );

    expect(prompt).toContain("Status: porażka");
    expect(prompt).toContain("Błąd: timeout sesji");
    expect(prompt).toContain("Zaplanowano ponowną próbę: tak");
  });

  it("przy porażce bez komunikatu błędu opisuje go jako nieznany", () => {
    const prompt = composeSummaryPrompt(
      buildContext({ result: buildResult({ ok: false }) }),
    );

    expect(prompt).toContain("Błąd: nieznany");
    expect(prompt).toContain("Zaplanowano ponowną próbę: nie");
  });
});
