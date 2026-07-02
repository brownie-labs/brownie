import { z } from "zod";
import { lastJsonBlock, parseLenient } from "../report.js";
import type { SessionResult, Task } from "../types.js";

export const SUMMARY_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    headline: {
      type: "string",
      description:
        "Jedno zdanie (maksymalnie ok. 200 znaków): co zrobiono albo na czym " +
        "polegał problem",
    },
    summary: {
      type: "string",
      description: "Pełne podsumowanie sesji zgodnie z rolą",
    },
  },
  required: ["headline", "summary"],
  additionalProperties: false,
});

export const summarySchema = z.object({
  headline: z.string().trim().min(1),
  summary: z.string().trim().min(1),
});

export type SummaryReport = z.infer<typeof summarySchema>;

export function parseSummary(resultText: string): SummaryReport | null {
  const candidate = lastJsonBlock(resultText) ?? resultText.trim();
  let raw: unknown;
  try {
    raw = parseLenient(candidate);
  } catch {
    return null;
  }

  const parsed = summarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface SummaryContext {
  task: Task;
  result: SessionResult;
  willRetry: boolean;
  logPath: string;
}

export function composeSummaryPrompt(context: SummaryContext): string {
  const { task, result, willRetry, logPath } = context;
  const lines = [
    "## Zadanie",
    "",
    `ID: ${task.id}`,
    `Tytuł: ${task.title}`,
    `Próba: ${task.attempts}`,
    "Opis:",
    task.description,
    "",
    "## Wynik sesji egzekutora",
    "",
    `Status: ${result.ok ? "sukces" : "porażka"}`,
  ];
  if (!result.ok) {
    lines.push(
      `Błąd: ${result.error ?? "nieznany"}`,
      `Zaplanowano ponowną próbę: ${willRetry ? "tak" : "nie"}`,
    );
  }
  lines.push(
    "",
    "## Log sesji",
    "",
    "Pełny log sesji egzekutora znajduje się w pliku:",
    logPath,
    "",
    "Przeczytaj go i przygotuj podsumowanie.",
  );
  return lines.join("\n");
}
