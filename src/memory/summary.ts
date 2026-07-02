import { z } from "zod";
import { lastJsonBlock, parseLenient } from "../report.js";
import type { SessionResult, Task } from "../types.js";

export const SUMMARY_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    headline: {
      type: "string",
      description:
        "One sentence (about 200 characters max): what was done or what the " +
        "problem was",
    },
    summary: {
      type: "string",
      description: "Full session summary according to the role",
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
    "## Task",
    "",
    `ID: ${task.id}`,
    `Title: ${task.title}`,
    `Attempt: ${task.attempts}`,
    "Description:",
    task.description,
    "",
    "## Executor session result",
    "",
    `Status: ${result.ok ? "success" : "failure"}`,
  ];
  if (!result.ok) {
    lines.push(
      `Error: ${result.error ?? "unknown"}`,
      `Retry scheduled: ${willRetry ? "yes" : "no"}`,
    );
  }
  lines.push(
    "",
    "## Session log",
    "",
    "The full executor session log is in file:",
    logPath,
    "",
    "Read it and prepare a summary.",
  );
  return lines.join("\n");
}
