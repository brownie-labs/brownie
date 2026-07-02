import { Box, Text } from "ink";
import type { JSX } from "react";

export interface AgentPanelProps {
  title: string;
  color: string;
  phaseLabel: string;
  phaseColor: string;
  tail: readonly string[];
  outcomeLabel?: string | undefined;
  outcomeColor: string;
  height: number;
}

export function AgentPanel({
  title,
  color,
  phaseLabel,
  phaseColor,
  tail,
  outcomeLabel,
  outcomeColor,
  height,
}: AgentPanelProps): JSX.Element {
  const chromeLines = 4 + (outcomeLabel === undefined ? 0 : 1);
  const tailCapacity = Math.max(0, height - chromeLines);
  const visible = tail.slice(-tailCapacity);
  return (
    <Box
      borderStyle="round"
      borderColor={color}
      flexDirection="column"
      flexBasis={0}
      flexGrow={1}
      paddingX={1}
      height={height}
      overflow="hidden"
    >
      <Text bold color={color}>
        {title}
      </Text>
      <Text color={phaseColor} wrap="truncate-end">
        {phaseLabel}
      </Text>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visible.map((line, index) => (
          <Text key={index} dimColor wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>
      {outcomeLabel === undefined ? null : (
        <Text color={outcomeColor} wrap="truncate-end">
          {outcomeLabel}
        </Text>
      )}
    </Box>
  );
}
