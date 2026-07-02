import { z } from "zod";
import type { NewTask } from "./types.js";

export const TASK_REPORT_CONTRACT = `## Kontrakt raportu zadań (techniczny, nadrzędny)

Twoja końcowa odpowiedź MUSI kończyć się dokładnie jednym blokiem kodu w formacie:

\`\`\`json
{"tasks": [{"id": "...", "title": "...", "description": "..."}]}
\`\`\`

Zasady:
- \`id\` musi być stabilny i pochodzić ze źródła zadania (np. \`redmine-123\`, \`email-<message-id>\`) — to samo zadanie musi zawsze dostawać ten sam \`id\`.
- \`title\` to krótki tytuł zadania, a \`description\` ma zawierać cały kontekst potrzebny do samodzielnego wykonania zadania w osobnej sesji.
- Jeśli nie wykryto żadnej pracy, zwróć pustą listę: \`{"tasks": []}\`.
- Wyłącznie raportujesz — nigdy nie wykonuj wykrytych zadań ani nie zmieniaj ich stanu w źródle.`;

export const taskReportSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string().trim().min(1),
      title: z.string().trim().min(1),
      description: z.string().trim().default(""),
    }),
  ),
});

function lastJsonBlock(text: string): string | undefined {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  return matches.at(-1)?.[1];
}

export function parseTaskReport(resultText: string): NewTask[] | null {
  const candidate = lastJsonBlock(resultText) ?? resultText.trim();
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
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
