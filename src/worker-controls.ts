import type { TaskSummaryRecord } from "./memory/store.js";
import type { NewTask, Task } from "./types.js";

export interface TaskControls {
  list(): Task[];
  retry(id: string): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  addTasks(tasks: NewTask[]): Promise<Task[]>;
}

export interface MemoryReader {
  recent(limit: number): TaskSummaryRecord[];
  search(query: string, limit: number): TaskSummaryRecord[];
}
