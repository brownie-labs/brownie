import { Box, Text } from "ink";
import type { JSX } from "react";
import type { Task, TaskStatus } from "../types.js";

const STATUS_ORDER: Record<TaskStatus, number> = {
  in_progress: 0,
  pending: 1,
  done: 2,
  failed: 2,
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "pending",
  in_progress: "in progress",
  done: "done",
  failed: "failed",
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: "yellow",
  in_progress: "cyan",
  done: "green",
  failed: "red",
};

function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const order = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (order !== 0) return order;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function countByStatus(tasks: readonly Task[], status: TaskStatus): number {
  return tasks.filter((task) => task.status === status).length;
}

export interface TaskTableProps {
  tasks: readonly Task[];
  height: number;
}

export function TaskTable({ tasks, height }: TaskTableProps): JSX.Element {
  const maxRows = Math.max(1, height - 3);
  const sorted = sortTasks(tasks);
  const overflow = sorted.length > maxRows ? sorted.length - (maxRows - 1) : 0;
  const visible = overflow > 0 ? sorted.slice(0, maxRows - 1) : sorted;
  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      flexDirection="column"
      paddingX={1}
      height={height}
      overflow="hidden"
    >
      <Text bold wrap="truncate-end">
        {"Tasks  "}
        <Text color="yellow">pending: {countByStatus(tasks, "pending")}</Text>
        {" · "}
        <Text color="cyan">in progress: {countByStatus(tasks, "in_progress")}</Text>
        {" · "}
        <Text color="green">done: {countByStatus(tasks, "done")}</Text>
        {" · "}
        <Text color="red">failed: {countByStatus(tasks, "failed")}</Text>
      </Text>
      {tasks.length === 0 ? <Text dimColor>no tasks</Text> : null}
      {visible.map((task) => (
        <Text key={task.id} wrap="truncate-end">
          <Text color={STATUS_COLORS[task.status]}>
            {STATUS_LABELS[task.status].padEnd(11)}
          </Text>
          {`${task.id} · ${task.title}${task.error === undefined ? "" : ` — ${task.error}`}`}
        </Text>
      ))}
      {overflow > 0 ? <Text dimColor>… and {overflow} more</Text> : null}
    </Box>
  );
}
