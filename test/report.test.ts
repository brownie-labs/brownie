import { describe, expect, it } from "vitest";
import { parseTaskReport } from "../src/report.js";

describe("parseTaskReport", () => {
  it("parses a json block surrounded by prose", () => {
    const text = [
      "I checked Redmine.",
      "```json",
      '{"tasks": [{"id": "redmine-1", "title": "Task", "description": "Description"}]}',
      "```",
    ].join("\n");

    expect(parseTaskReport(text)).toEqual([
      { id: "redmine-1", title: "Task", description: "Description" },
    ]);
  });

  it("takes the last json block when there are several", () => {
    const text = [
      "```json",
      '{"tasks": [{"id": "old", "title": "X", "description": ""}]}',
      "```",
      "Correction:",
      "```json",
      '{"tasks": [{"id": "new", "title": "Y", "description": ""}]}',
      "```",
    ].join("\n");

    expect(parseTaskReport(text)?.map((t) => t.id)).toEqual(["new"]);
  });

  it("parses raw JSON without a code block", () => {
    const text =
      '{"tasks": [{"id": "email-abc", "title": "Reply", "description": "Mail"}]}';

    expect(parseTaskReport(text)?.map((t) => t.id)).toEqual(["email-abc"]);
  });

  it("an empty task list is a valid report", () => {
    expect(parseTaskReport('{"tasks": []}')).toEqual([]);
  });

  it("fills a missing description with empty text", () => {
    const tasks = parseTaskReport('{"tasks": [{"id": "a", "title": "T"}]}');
    expect(tasks).toEqual([{ id: "a", title: "T", description: "" }]);
  });

  it("returns null for text without JSON", () => {
    expect(parseTaskReport("found nothing to do")).toBeNull();
  });

  it("returns null for JSON that does not match the schema", () => {
    expect(parseTaskReport('{"tasks": [{"title": "without id"}]}')).toBeNull();
    expect(parseTaskReport('{"tasks": [{"id": "", "title": "empty id"}]}')).toBeNull();
    expect(parseTaskReport('{"other": []}')).toBeNull();
  });

  it("returns null for broken JSON in a block", () => {
    expect(parseTaskReport('```json\n{"tasks": [}\n```')).toBeNull();
  });

  it("tolerates raw newlines inside strings", () => {
    const text =
      '{"tasks": [{"id": "a", "title": "T", "description": "line 1\nline 2\n\nline 4"}]}';

    expect(parseTaskReport(text)).toEqual([
      { id: "a", title: "T", description: "line 1\nline 2\n\nline 4" },
    ]);
  });

  it("tolerates raw control characters (tab, CR) inside strings", () => {
    const text = '{"tasks": [{"id": "a", "title": "T\tX", "description": "y\r\nz"}]}';

    expect(parseTaskReport(text)).toEqual([
      { id: "a", title: "T\tX", description: "y\r\nz" },
    ]);
  });

  it("does not confuse control characters in a string with structural whitespace", () => {
    const text = [
      "```json",
      "{",
      '  "tasks": [',
      '    {"id": "a", "title": "multiline",',
      '     "description": "row A\nrow B"}',
      "  ]",
      "}",
      "```",
    ].join("\n");

    expect(parseTaskReport(text)).toEqual([
      { id: "a", title: "multiline", description: "row A\nrow B" },
    ]);
  });

  it("deduplicates ids within the report (first occurrence wins)", () => {
    const text = JSON.stringify({
      tasks: [
        { id: "a", title: "First", description: "1" },
        { id: "a", title: "Duplicate", description: "2" },
        { id: "b", title: "Second", description: "3" },
      ],
    });

    expect(parseTaskReport(text)).toEqual([
      { id: "a", title: "First", description: "1" },
      { id: "b", title: "Second", description: "3" },
    ]);
  });
});
