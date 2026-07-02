import { Box, Text } from "ink";
import type { JSX } from "react";
import { describeSchedule } from "../active-hours.js";
import type { WorkerStats } from "../status.js";
import type { WorkerConfig } from "../types.js";
import { formatInterval, formatStats } from "./format.js";

const BRAND_COLOR = "#c08457";

function timeoutLabel(sessionTimeoutMs: number | undefined): string {
  return sessionTimeoutMs != null ? ` · timeout=${formatInterval(sessionTimeoutMs)}` : "";
}

export interface HeaderProps {
  config: WorkerConfig;
  stats: WorkerStats;
  uptimeMs: number;
}

export function Header({ config, stats, uptimeMs }: HeaderProps): JSX.Element {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={BRAND_COLOR} bold>
          🧝 Brownie
        </Text>
        <Text dimColor>{"  works while you're not looking"}</Text>
      </Text>
      <Text wrap="truncate-end">
        <Text color="cyan" bold>
          monitor
        </Text>
        {`  model=${config.monitor.model} · effort=${config.monitor.effort}` +
          ` · interval=${formatInterval(config.monitor.intervalMs)}` +
          ` · working hours=${describeSchedule(config.monitor.schedule)}` +
          timeoutLabel(config.monitor.sessionTimeoutMs)}
      </Text>
      <Text wrap="truncate-end">
        <Text color="magenta" bold>
          executor
        </Text>
        {`  model=${config.executor.model} · effort=${config.executor.effort}${timeoutLabel(config.executor.sessionTimeoutMs)}`}
      </Text>
      <Text wrap="truncate-end">
        <Text color="green" bold>
          stats
        </Text>
        {`  ${formatStats(stats, uptimeMs)}`}
      </Text>
      <Text dimColor wrap="truncate-end">
        {`cwd=${config.cwd} · tasks=${config.tasksFilePath} · partial=${config.streamPartial ? "on" : "off"}`}
      </Text>
    </Box>
  );
}
