import { Box, Text, useStdout } from "ink";
import type { JSX } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { WorkerStatusStore } from "../status.js";
import type { WorkerConfig } from "../types.js";
import { AgentPanel } from "./agent-panel.js";
import {
  formatExecutorOutcome,
  formatExecutorPhase,
  formatMonitorOutcome,
  formatMonitorPhase,
} from "./format.js";
import { Header } from "./header.js";
import { TaskTable } from "./task-table.js";
import { useNow } from "./use-now.js";

const FALLBACK_COLUMNS = 80;
const FALLBACK_ROWS = 30;
const HEADER_HEIGHT = 6;

interface TerminalSize {
  columns: number;
  rows: number;
}

function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const readSize = (): TerminalSize => ({
    columns: stdout.columns || FALLBACK_COLUMNS,
    rows: stdout.rows || FALLBACK_ROWS,
  });
  const [size, setSize] = useState(readSize);
  useEffect(() => {
    const onResize = (): void => {
      setSize({
        columns: stdout.columns || FALLBACK_COLUMNS,
        rows: stdout.rows || FALLBACK_ROWS,
      });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
}

export interface DashboardProps {
  store: WorkerStatusStore;
  config: WorkerConfig;
}

export function Dashboard({ store, config }: DashboardProps): JSX.Element {
  const status = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { rows } = useTerminalSize();
  const now = useNow();

  const shutdownHeight = status.shutdownSignal === undefined ? 0 : 1;
  const tableHeight = Math.max(4, Math.floor(rows / 3));
  const panelHeight = Math.max(6, rows - HEADER_HEIGHT - tableHeight - shutdownHeight);

  const { monitor, executor } = status;

  return (
    <Box flexDirection="column" height={rows}>
      <Header config={config} />
      <Box>
        <AgentPanel
          title="Monitor"
          color="cyan"
          phaseLabel={formatMonitorPhase(monitor.phase, now)}
          phaseColor={phaseColor(monitor.phase.kind)}
          tail={monitor.tail}
          outcomeLabel={monitor.lastOutcome && formatMonitorOutcome(monitor.lastOutcome)}
          outcomeColor={outcomeColor(monitor.lastOutcome?.ok)}
          height={panelHeight}
        />
        <AgentPanel
          title="Executor"
          color="magenta"
          phaseLabel={formatExecutorPhase(executor.phase, now)}
          phaseColor={phaseColor(executor.phase.kind)}
          tail={executor.tail}
          outcomeLabel={
            executor.lastOutcome && formatExecutorOutcome(executor.lastOutcome)
          }
          outcomeColor={
            executor.lastOutcome?.willRetry
              ? "yellow"
              : outcomeColor(executor.lastOutcome?.ok)
          }
          height={panelHeight}
        />
      </Box>
      <TaskTable tasks={status.tasks} height={tableHeight} />
      {status.shutdownSignal === undefined ? null : (
        <Text color="yellow">Received {status.shutdownSignal} — shutting down…</Text>
      )}
    </Box>
  );
}

function phaseColor(kind: string): string {
  switch (kind) {
    case "session":
      return "cyan";
    case "offHours":
      return "magenta";
    case "backoff":
      return "yellow";
    default:
      return "gray";
  }
}

function outcomeColor(ok: boolean | undefined): string {
  return ok === false ? "red" : "green";
}
