import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { NewTask, Task } from "./types.js";

const taskSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  status: z.enum(["pending", "in_progress", "done", "failed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().optional(),
});

const storeFileSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSchema),
});

function corruptStoreError(path: string, reason: string): Error {
  return new Error(
    `Uszkodzony plik magazynu zadań (${path}): ${reason}\nNapraw lub usuń plik i uruchom ponownie.`,
  );
}

export class TaskStore {
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly tasks: Task[],
  ) {}

  static async open(path: string): Promise<TaskStore> {
    await mkdir(dirname(path), { recursive: true });

    let raw: string | undefined;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    let tasks: Task[] = [];
    if (raw !== undefined) {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw corruptStoreError(path, "to nie jest poprawny JSON");
      }
      const parsed = storeFileSchema.safeParse(json);
      if (!parsed.success) {
        throw corruptStoreError(path, "niezgodny format danych");
      }
      tasks = parsed.data.tasks;
    }

    const store = new TaskStore(path, tasks);
    await store.resetStaleInProgress();
    return store;
  }

  private run<T>(op: () => Promise<T>): Promise<T> {
    const result = this.chain.then(op, op);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async persist(): Promise<void> {
    const tmpPath = `${this.path}.tmp`;
    const payload = JSON.stringify({ version: 1, tasks: this.tasks }, null, 2);
    await writeFile(tmpPath, `${payload}\n`, "utf8");
    await rename(tmpPath, this.path);
  }

  private resetStaleInProgress(): Promise<void> {
    return this.run(async () => {
      const stale = this.tasks.filter((task) => task.status === "in_progress");
      if (stale.length === 0) return;
      const now = new Date().toISOString();
      for (const task of stale) {
        task.status = "pending";
        task.updatedAt = now;
      }
      await this.persist();
    });
  }

  addTasks(candidates: NewTask[]): Promise<Task[]> {
    return this.run(async () => {
      const now = new Date().toISOString();
      const added: Task[] = [];
      for (const candidate of candidates) {
        if (this.tasks.some((task) => task.id === candidate.id)) continue;
        const task: Task = {
          id: candidate.id,
          title: candidate.title,
          description: candidate.description,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        };
        this.tasks.push(task);
        added.push({ ...task });
      }
      if (added.length > 0) await this.persist();
      return added;
    });
  }

  takeNext(): Promise<Task | undefined> {
    return this.run(async () => {
      const task = this.tasks.find((candidate) => candidate.status === "pending");
      if (!task) return undefined;
      task.status = "in_progress";
      task.updatedAt = new Date().toISOString();
      await this.persist();
      return { ...task };
    });
  }

  complete(id: string): Promise<void> {
    return this.setStatus(id, "done");
  }

  fail(id: string, error: string): Promise<void> {
    return this.setStatus(id, "failed", error);
  }

  private setStatus(
    id: string,
    status: "done" | "failed",
    error?: string,
  ): Promise<void> {
    return this.run(async () => {
      const task = this.tasks.find((candidate) => candidate.id === id);
      if (!task) return;
      task.status = status;
      task.updatedAt = new Date().toISOString();
      task.error = error;
      await this.persist();
    });
  }

  pendingCount(): number {
    return this.tasks.filter((task) => task.status === "pending").length;
  }
}
