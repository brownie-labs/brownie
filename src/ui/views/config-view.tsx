import { Box, Text } from "ink";
import type { JSX } from "react";
import { describeSchedule } from "../../active-hours.js";
import { SETTINGS_PATH_LABEL } from "../../config.js";
import type { WorkerConfig } from "../../types.js";
import { formatInterval } from "../format.js";
import { theme } from "../theme.js";

export interface ConfigViewProps {
  config: WorkerConfig;
  height: number;
}

type ConfigLine =
  { kind: "title"; text: string } | { kind: "entry"; label: string; value: string };

const LABEL_WIDTH = 18;

function timeout(ms: number | undefined): string {
  return ms === undefined ? "none" : formatInterval(ms);
}

function buildLines(config: WorkerConfig): ConfigLine[] {
  return [
    { kind: "title", text: "Monitor" },
    { kind: "entry", label: "model", value: config.monitor.model },
    { kind: "entry", label: "effort", value: config.monitor.effort },
    {
      kind: "entry",
      label: "interval",
      value: `every ${formatInterval(config.monitor.intervalMs)}`,
    },
    {
      kind: "entry",
      label: "schedule",
      value: describeSchedule(config.monitor.schedule),
    },
    {
      kind: "entry",
      label: "session timeout",
      value: timeout(config.monitor.sessionTimeoutMs),
    },
    { kind: "title", text: "Executor" },
    { kind: "entry", label: "model", value: config.executor.model },
    { kind: "entry", label: "effort", value: config.executor.effort },
    {
      kind: "entry",
      label: "session timeout",
      value: timeout(config.executor.sessionTimeoutMs),
    },
    {
      kind: "entry",
      label: "max attempts",
      value: String(config.executor.maxTaskAttempts),
    },
    {
      kind: "entry",
      label: "retry delay",
      value: formatInterval(config.executor.retryDelayMs),
    },
    { kind: "title", text: "Summarizer" },
    { kind: "entry", label: "model", value: config.summarizer.model },
    { kind: "entry", label: "effort", value: config.summarizer.effort },
    {
      kind: "entry",
      label: "session timeout",
      value: timeout(config.summarizer.sessionTimeoutMs),
    },
    { kind: "title", text: "General" },
    {
      kind: "entry",
      label: "stream partial",
      value: config.streamPartial ? "on" : "off",
    },
    { kind: "entry", label: "settings file", value: SETTINGS_PATH_LABEL },
  ];
}

export function ConfigView({ config, height }: ConfigViewProps): JSX.Element {
  const capacity = Math.max(1, height - 3);
  const lines = buildLines(config);
  return (
    <Box
      borderStyle="round"
      borderColor={theme.muted}
      paddingX={1}
      height={height}
      overflow="hidden"
      flexDirection="column"
    >
      {lines.slice(0, capacity).map((line, index) =>
        line.kind === "title" ? (
          <Text key={index} bold>
            {line.text}
          </Text>
        ) : (
          <Text key={index} wrap="truncate-end">
            <Text color={theme.accent}>{`  ${line.label.padEnd(LABEL_WIDTH)}`}</Text>
            <Text>{line.value}</Text>
          </Text>
        ),
      )}
      <Text dimColor wrap="truncate-end">
        {"change with /model /effort /interval /hours /days · restart-only: mcp.json"}
      </Text>
    </Box>
  );
}
