import { Box } from "ink";
import type { JSX } from "react";
import type { WorkerStatus } from "../../status.js";
import { executorPanelModel, monitorPanelModel } from "../agent-visuals.js";
import { AgentPanel } from "../agent-panel.js";
import { TaskTable } from "../task-table.js";
import { theme } from "../theme.js";

export type PanelId = "monitor" | "executor";

export interface DashboardViewProps {
  status: WorkerStatus;
  width: number;
  height: number;
  now: number;
  interactive: boolean;
  focusedPanel: PanelId;
  scrollOffsets: Record<PanelId, number>;
  expanded: boolean;
}

export function DashboardView({
  status,
  width,
  height,
  now,
  interactive,
  focusedPanel,
  scrollOffsets,
  expanded,
}: DashboardViewProps): JSX.Element {
  const tableHeight = Math.max(4, Math.floor(height / 3));
  const panelHeight = Math.max(6, height - tableHeight);
  const panelWidth = Math.floor(width / 2);
  const monitor = monitorPanelModel(status.monitor, now);
  const executor = executorPanelModel(status.executor, now);
  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      <Box>
        <AgentPanel
          title="Monitor"
          borderColor={theme.muted}
          phaseLabel={monitor.phaseLabel}
          phaseColor={monitor.phaseColor}
          tail={monitor.tail}
          outcomeLabel={monitor.outcomeLabel}
          outcomeColor={monitor.outcomeColor}
          width={panelWidth}
          height={panelHeight}
          focused={interactive && focusedPanel === "monitor"}
          scrollOffset={scrollOffsets.monitor}
          expanded={expanded}
        />
        <AgentPanel
          title="Executor"
          borderColor={theme.muted}
          phaseLabel={executor.phaseLabel}
          phaseColor={executor.phaseColor}
          tail={executor.tail}
          outcomeLabel={executor.outcomeLabel}
          outcomeColor={executor.outcomeColor}
          width={panelWidth}
          height={panelHeight}
          focused={interactive && focusedPanel === "executor"}
          scrollOffset={scrollOffsets.executor}
          expanded={expanded}
        />
      </Box>
      <TaskTable tasks={status.tasks} height={tableHeight} now={now} />
    </Box>
  );
}
