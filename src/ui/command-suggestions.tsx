import { Box, Text } from "ink";
import type { JSX } from "react";
import type { CommandSuggestion } from "./commands.js";
import { theme } from "./theme.js";

export const SUGGESTION_WINDOW = 10;

export interface CommandSuggestionsProps {
  suggestions: readonly CommandSuggestion[];
  selected: number;
  matchLength: number;
}

export function CommandSuggestions({
  suggestions,
  selected,
  matchLength,
}: CommandSuggestionsProps): JSX.Element {
  const nameWidth = suggestions.reduce(
    (max, item) => Math.max(max, item.name.length + 1),
    0,
  );
  const headLength = matchLength + 1;
  const windowStart = Math.min(
    Math.max(0, selected - SUGGESTION_WINDOW + 1),
    Math.max(0, suggestions.length - SUGGESTION_WINDOW),
  );
  const visible = suggestions.slice(windowStart, windowStart + SUGGESTION_WINDOW);
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {visible.map((item, offset) => {
        const index = windowStart + offset;
        const name = `/${item.name}`;
        const head = name.slice(0, headLength);
        const tail = name.slice(headLength).padEnd(nameWidth - headLength);
        const active = index === selected;
        return (
          <Text key={item.name} wrap="truncate-end">
            <Text color={active ? theme.accent : theme.muted}>
              {active ? "❯ " : "  "}
            </Text>
            <Text color={theme.accent} bold>
              {head}
            </Text>
            {active ? <Text color={theme.accent}>{tail}</Text> : <Text>{tail}</Text>}
            <Text>{"  "}</Text>
            <Text dimColor={!active}>{item.summary}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
