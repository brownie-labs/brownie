import { Box, Text, useInput, useStdin, useStdout } from "ink";
import type { JSX } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { WorkerStatusStore } from "../status.js";
import type { WorkerConfig } from "../types.js";
import { AgentPanel } from "./agent-panel.js";
import {
  detectStall,
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
const HEADER_HEIGHT = 7;
const PANEL_CHROME_LINES = 6;

type PanelId = "monitor" | "executor";

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
  const { isRawModeSupported } = useStdin();
  const interactive = (isRawModeSupported as boolean | undefined) === true;

  const [focus, setFocus] = useState<PanelId>("monitor");
  const [scrollOffsets, setScrollOffsets] = useState<Record<PanelId, number>>({
    monitor: 0,
    executor: 0,
  });

  const { monitor, executor } = status;

  const hintHeight = interactive ? 1 : 0;
  const shutdownHeight = status.shutdownSignal === undefined ? 0 : 1;
  const tableHeight = Math.max(4, Math.floor(rows / 3));
  const panelHeight = Math.max(
    6,
    rows - HEADER_HEIGHT - tableHeight - shutdownHeight - hintHeight,
  );

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        process.kill(process.pid, "SIGINT");
        return;
      }
      if (key.tab) {
        setFocus((current) => (current === "monitor" ? "executor" : "monitor"));
        return;
      }
      if (key.escape) {
        setScrollOffsets((current) => ({ ...current, [focus]: 0 }));
        return;
      }
      const step =
        key.pageUp || key.pageDown ? Math.max(1, panelHeight - PANEL_CHROME_LINES) : 1;
      let direction = 0;
      if (key.upArrow || key.pageUp) direction = 1;
      else if (key.downArrow || key.pageDown) direction = -1;
      if (direction === 0) return;
      const tailLength = (focus === "monitor" ? monitor : executor).tail.length;
      setScrollOffsets((current) => ({
        ...current,
        [focus]: Math.min(
          Math.max(0, current[focus] + direction * step),
          Math.max(0, tailLength - 1),
        ),
      }));
    },
    { isActive: interactive },
  );

  const monitorStall =
    monitor.phase.kind === "session"
      ? detectStall(monitor.phase.startedAt, monitor.lastEventAt, now)
      : undefined;
  const executorStall =
    executor.phase.kind === "session" || executor.phase.kind === "summary"
      ? detectStall(executor.phase.startedAt, executor.lastEventAt, now)
      : undefined;

  return (
    <Box flexDirection="column" height={rows}>
      <Header config={config} stats={status.stats} uptimeMs={now - status.startedAt} />
      <Box>
        <AgentPanel
          title="Monitor"
          color="cyan"
          phaseLabel={withStall(formatMonitorPhase(monitor.phase, now), monitorStall)}
          phaseColor={
            monitorStall === undefined ? phaseColor(monitor.phase.kind) : "yellow"
          }
          tail={monitor.tail}
          outcomeLabel={monitor.lastOutcome && formatMonitorOutcome(monitor.lastOutcome)}
          outcomeColor={outcomeColor(monitor.lastOutcome?.ok)}
          height={panelHeight}
          focused={interactive && focus === "monitor"}
          scrollOffset={scrollOffsets.monitor}
        />
        <AgentPanel
          title="Executor"
          color="magenta"
          phaseLabel={withStall(formatExecutorPhase(executor.phase, now), executorStall)}
          phaseColor={
            executorStall === undefined ? phaseColor(executor.phase.kind) : "yellow"
          }
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
          focused={interactive && focus === "executor"}
          scrollOffset={scrollOffsets.executor}
        />
      </Box>
      <TaskTable tasks={status.tasks} height={tableHeight} now={now} />
      {interactive ? (
        <Text dimColor wrap="truncate-end">
          tab: switch panel · ↑/↓ pgup/pgdn: scroll · esc: follow tail · ctrl+c: quit
        </Text>
      ) : null}
      {status.shutdownSignal === undefined ? null : (
        <Text color="yellow">Received {status.shutdownSignal} — shutting down…</Text>
      )}
    </Box>
  );
}

function withStall(label: string, stall: string | undefined): string {
  return stall === undefined ? label : `${label} · ${stall}`;
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
