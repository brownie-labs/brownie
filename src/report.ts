import { z } from "zod";
import type { NewTask } from "./types.js";

export const TASK_REPORT_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    tasks: {
      type: "array",
      description: "Wykryte zadania; pusta lista, gdy nie wykryto żadnej pracy",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Stabilny identyfikator pochodzący ze źródła zadania (rodzaj źródła + " +
              "identyfikator zadania w źródle) — to samo zadanie musi przy każdym " +
              "cyklu dostawać ten sam id",
          },
          title: { type: "string", description: "Krótki tytuł zadania" },
          description: {
            type: "string",
            description:
              "Cały kontekst potrzebny do samodzielnego wykonania zadania " +
              "w osobnej sesji",
          },
        },
        required: ["id", "title", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
});

export const taskReportSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string().trim().min(1),
      title: z.string().trim().min(1),
      description: z.string().trim().default(""),
    }),
  ),
});

export function lastJsonBlock(text: string): string | undefined {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  return matches.at(-1)?.[1];
}

const CONTROL_CHAR_ESCAPES: Record<string, string> = {
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
};

function escapeRawControlCharsInStrings(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (!inString) {
      if (char === '"') inString = true;
      result += char;
      continue;
    }
    if (escaped) {
      escaped = false;
      result += char;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      result += char;
      continue;
    }
    if (char === '"') {
      inString = false;
      result += char;
      continue;
    }
    if (char < " ") {
      result +=
        CONTROL_CHAR_ESCAPES[char] ??
        `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }
    result += char;
  }
  return result;
}

export function parseLenient(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(escapeRawControlCharsInStrings(candidate));
  }
}

export function parseTaskReport(resultText: string): NewTask[] | null {
  const candidate = lastJsonBlock(resultText) ?? resultText.trim();
  let raw: unknown;
  try {
    raw = parseLenient(candidate);
  } catch {
    return null;
  }

  const parsed = taskReportSchema.safeParse(raw);
  if (!parsed.success) return null;

  const seen = new Set<string>();
  const tasks: NewTask[] = [];
  for (const task of parsed.data.tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    tasks.push(task);
  }
  return tasks;
}
