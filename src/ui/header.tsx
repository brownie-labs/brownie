import { Box, Text } from "ink";
import type { JSX } from "react";
import { describeSchedule } from "../active-hours.js";
import type { WorkerConfig } from "../types.js";
import { formatInterval } from "./format.js";

function timeoutLabel(sessionTimeoutMs: number | undefined): string {
  return sessionTimeoutMs != null ? ` · timeout=${formatInterval(sessionTimeoutMs)}` : "";
}

export function Header({ config }: { config: WorkerConfig }): JSX.Element {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
      <Text wrap="truncate-end">
        <Text color="cyan" bold>
          monitor
        </Text>
        {`  model=${config.monitor.model} · interwał=${formatInterval(config.monitor.intervalMs)}` +
          ` · godziny pracy=${describeSchedule(config.monitor.schedule)}` +
          timeoutLabel(config.monitor.sessionTimeoutMs)}
      </Text>
      <Text wrap="truncate-end">
        <Text color="magenta" bold>
          egzekutor
        </Text>
        {`  model=${config.executor.model}${timeoutLabel(config.executor.sessionTimeoutMs)}`}
      </Text>
      <Text dimColor wrap="truncate-end">
        {`cwd=${config.cwd} · zadania=${config.tasksFilePath} · partial=${config.streamPartial ? "on" : "off"}`}
      </Text>
    </Box>
  );
}
