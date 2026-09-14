export function composePrompt(prompt: string, context: string): string {
  const trimmed = context.trim();
  return trimmed === "" ? prompt : `${prompt.trimEnd()}\n\n${trimmed}\n`;
}
