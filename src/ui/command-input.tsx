import { Box, Text } from "ink";
import type { JSX } from "react";
import { theme } from "./theme.js";

export interface CommandInputProps {
  value: string;
  cursor: number;
  suggestion?: string | undefined;
}

export function CommandInput({
  value,
  cursor,
  suggestion,
}: CommandInputProps): JSX.Element {
  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1);
  const after = value.slice(cursor + 1);
  const ghost = suggestion === undefined ? "" : suggestion.slice(value.length);
  return (
    <Box borderStyle="round" borderColor={theme.muted} paddingX={1}>
      <Text wrap="truncate-end">
        <Text color={theme.accent}>{"> "}</Text>
        {before}
        <Text inverse>{at === "" ? " " : at}</Text>
        {after}
        {ghost === "" ? null : <Text dimColor>{ghost}</Text>}
      </Text>
    </Box>
  );
}
