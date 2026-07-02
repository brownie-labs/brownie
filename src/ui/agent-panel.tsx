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
  focused: boolean;
  scrollOffset: number;
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
  focused,
  scrollOffset,
}: AgentPanelProps): JSX.Element {
  const chromeLines = 4 + (outcomeLabel === undefined ? 0 : 1);
  const fullCapacity = Math.max(0, height - chromeLines);
  const scrolled = scrollOffset > 0 && tail.length > fullCapacity;
  const tailCapacity = scrolled ? Math.max(1, fullCapacity - 1) : fullCapacity;
  const offset = scrolled ? Math.min(scrollOffset, tail.length - tailCapacity) : 0;
  const end = tail.length - offset;
  const visible = tail.slice(Math.max(0, end - tailCapacity), end);
  return (
    <Box
      borderStyle={focused ? "bold" : "round"}
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
      {scrolled ? (
        <Text dimColor wrap="truncate-end">
          {`↓ ${offset} newer lines · esc: follow`}
        </Text>
      ) : null}
      {outcomeLabel === undefined ? null : (
        <Text color={outcomeColor} wrap="truncate-end">
          {outcomeLabel}
        </Text>
      )}
    </Box>
  );
}
