import { Box, Text } from "ink";
import type { JSX } from "react";
import type { AgentPanelModel } from "../agent-visuals.js";
import { AgentPanel } from "../agent-panel.js";
import { theme } from "../theme.js";

export interface AgentViewProps {
  title: string;
  model: AgentPanelModel;
  height: number;
  scrollOffset: number;
}

export function AgentView({
  title,
  model,
  height,
  scrollOffset,
}: AgentViewProps): JSX.Element {
  const outcomes = model.recentOutcomeLabels;
  const outcomesHeight =
    outcomes.length === 0
      ? 4
      : Math.min(Math.max(4, Math.floor(height / 3)), outcomes.length + 2);
  const panelHeight = Math.max(6, height - outcomesHeight);
  const visibleOutcomes = outcomes.slice(0, Math.max(1, outcomesHeight - 2));
  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      <AgentPanel
        title={title}
        borderColor={theme.muted}
        phaseLabel={model.phaseLabel}
        phaseColor={model.phaseColor}
        tail={model.tail}
        outcomeLabel={undefined}
        outcomeColor={model.outcomeColor}
        height={panelHeight}
        focused={false}
        scrollOffset={scrollOffset}
      />
      <Box
        borderStyle="round"
        borderColor={theme.muted}
        flexDirection="column"
        paddingX={1}
        height={outcomesHeight}
        overflow="hidden"
      >
        <Text bold>Recent outcomes</Text>
        {visibleOutcomes.length === 0 ? <Text dimColor>nothing finished yet</Text> : null}
        {visibleOutcomes.map((label, index) => (
          <Text key={index} dimColor={index > 0} wrap="truncate-end">
            {label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
