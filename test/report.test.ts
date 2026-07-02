import { describe, expect, it } from "vitest";
import { parseTaskReport, TASK_REPORT_CONTRACT } from "../src/report.js";

describe("TASK_REPORT_CONTRACT", () => {
  it("opisuje wymagany format bloku json", () => {
    expect(TASK_REPORT_CONTRACT).toContain("```json");
    expect(TASK_REPORT_CONTRACT).toContain('"tasks"');
  });
});

describe("parseTaskReport", () => {
  it("parsuje blok json otoczony prozą", () => {
    const text = [
      "Sprawdziłem Redmine.",
      "```json",
      '{"tasks": [{"id": "redmine-1", "title": "Task", "description": "Opis"}]}',
      "```",
    ].join("\n");

    expect(parseTaskReport(text)).toEqual([
      { id: "redmine-1", title: "Task", description: "Opis" },
    ]);
  });

  it("bierze ostatni blok json, gdy jest ich więcej", () => {
    const text = [
      "```json",
      '{"tasks": [{"id": "stary", "title": "X", "description": ""}]}',
      "```",
      "Poprawka:",
      "```json",
      '{"tasks": [{"id": "nowy", "title": "Y", "description": ""}]}',
      "```",
    ].join("\n");

    expect(parseTaskReport(text)?.map((t) => t.id)).toEqual(["nowy"]);
  });

  it("parsuje surowy JSON bez bloku kodu", () => {
    const text =
      '{"tasks": [{"id": "email-abc", "title": "Odpisz", "description": "Mail"}]}';

    expect(parseTaskReport(text)?.map((t) => t.id)).toEqual(["email-abc"]);
  });

  it("pusta lista zadań jest poprawnym raportem", () => {
    expect(parseTaskReport('{"tasks": []}')).toEqual([]);
  });

  it("uzupełnia brakujący description pustym tekstem", () => {
    const tasks = parseTaskReport('{"tasks": [{"id": "a", "title": "T"}]}');
    expect(tasks).toEqual([{ id: "a", title: "T", description: "" }]);
  });

  it("zwraca null dla tekstu bez JSON", () => {
    expect(parseTaskReport("nie znalazłem nic do zrobienia")).toBeNull();
  });

  it("zwraca null dla JSON niezgodnego ze schematem", () => {
    expect(parseTaskReport('{"tasks": [{"title": "bez id"}]}')).toBeNull();
    expect(parseTaskReport('{"tasks": [{"id": "", "title": "puste id"}]}')).toBeNull();
    expect(parseTaskReport('{"inne": []}')).toBeNull();
  });

  it("zwraca null dla zepsutego JSON w bloku", () => {
    expect(parseTaskReport('```json\n{"tasks": [}\n```')).toBeNull();
  });

  it("deduplikuje id w obrębie raportu (pierwsze wystąpienie wygrywa)", () => {
    const text = JSON.stringify({
      tasks: [
        { id: "a", title: "Pierwszy", description: "1" },
        { id: "a", title: "Duplikat", description: "2" },
        { id: "b", title: "Drugi", description: "3" },
      ],
    });

    expect(parseTaskReport(text)).toEqual([
      { id: "a", title: "Pierwszy", description: "1" },
      { id: "b", title: "Drugi", description: "3" },
    ]);
  });
});
