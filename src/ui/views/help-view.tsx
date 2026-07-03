import { Box, Text } from "ink";
import type { JSX } from "react";
import { COMMANDS } from "../commands.js";
import { theme } from "../theme.js";

export interface HelpViewProps {
  height: number;
}

export function HelpView({ height }: HelpViewProps): JSX.Element {
  return (
    <Box
      borderStyle="round"
      borderColor={theme.muted}
      flexDirection="column"
      paddingX={1}
      height={height}
      overflow="hidden"
    >
      <Text bold>Commands</Text>
      {COMMANDS.map((command) => (
        <Text key={command.name} wrap="truncate-end">
          <Text color={theme.accent}>
            {`/${command.name}${command.args === undefined ? "" : ` ${command.args}`}`.padEnd(
              28,
            )}
          </Text>
          <Text dimColor>{command.summary}</Text>
        </Text>
      ))}
    </Box>
  );
}
