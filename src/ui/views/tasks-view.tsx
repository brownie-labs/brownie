import type { JSX } from "react";
import type { Task } from "../../types.js";
import { TaskTable } from "../task-table.js";

export interface TasksViewProps {
  tasks: readonly Task[];
  height: number;
  now: number;
}

export function TasksView({ tasks, height, now }: TasksViewProps): JSX.Element {
  return <TaskTable tasks={tasks} height={height} now={now} />;
}
