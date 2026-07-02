import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { consola, type PromptOptions } from "consola";
import { parseTimeWindow } from "./active-hours.js";
import { resolveEnvPath } from "./config.js";
import { logger } from "./logger.js";
import { EFFORT_LEVELS } from "./types.js";

const CANCELLED_ERROR = "ConsolaPromptCancelledError";
const CANCEL_MESSAGE = "Cancelled — nothing changed.";
const MODELS = ["haiku", "sonnet", "opus"];
const EFFORTS = [...EFFORT_LEVELS];

const DAY_OPTIONS: { value: string; label: string }[] = [
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
  { value: "sat", label: "Saturday" },
  { value: "sun", label: "Sunday" },
];

function ask<T extends PromptOptions>(message: string, options: T) {
  return consola.prompt(message, { ...options, cancel: "reject" as const });
}

async function askText(
  message: string,
  options: { placeholder?: string; initial?: string } = {},
): Promise<string> {
  const answer: unknown = await ask(message, { ...options, type: "text" });
  return typeof answer === "string" ? answer.trim() : "";
}

function isCancellation(err: unknown): boolean {
  return err instanceof Error && err.name === CANCELLED_ERROR;
}

async function confirmOverwrite(paths: string[]): Promise<boolean> {
  const existing = paths.filter((p) => existsSync(p));
  if (existing.length === 0) return true;
  logger.warn(`Files already exist:\n${existing.map((p) => `  - ${p}`).join("\n")}`);
  return ask("Overwrite?", { type: "confirm", initial: false });
}

async function askIntervalMinutes(): Promise<number> {
  let minutes = NaN;
  while (!(minutes > 0)) {
    const raw = await askText("Monitor interval in minutes", { initial: "15" });
    minutes = Number(raw.replace(",", "."));
    if (!(minutes > 0)) logger.warn("Enter a positive number of minutes.");
  }
  return minutes;
}

async function askOptional(
  message: string,
  placeholder: string,
  validate: (value: string) => unknown,
): Promise<string> {
  for (;;) {
    const raw = await askText(message, { placeholder });
    if (raw === "") return "";
    try {
      validate(raw);
      return raw;
    } catch (err) {
      logger.warn((err as Error).message);
    }
  }
}

async function askActiveDays(): Promise<string> {
  const answer = (await ask("Monitor working days (space = select, Enter = all days)", {
    type: "multiselect",
    options: DAY_OPTIONS,
    required: false,
  })) as unknown;
  const selected = Array.isArray(answer) ? (answer as string[]) : [];
  if (selected.length === 0 || selected.length === DAY_OPTIONS.length) return "";
  const order = DAY_OPTIONS.map((option) => option.value);
  return [...selected].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(",");
}

interface ScheduleAnswers {
  activeHours: string;
  activeDays: string;
}

interface BuildEnvOptions {
  monitorModel: string;
  monitorEffort: string;
  executorModel: string;
  executorEffort: string;
  intervalMs: number;
  schedule: ScheduleAnswers;
  configDir?: string | undefined;
}

function buildEnv({
  monitorModel,
  monitorEffort,
  executorModel,
  executorEffort,
  intervalMs,
  schedule,
  configDir,
}: BuildEnvOptions): string {
  const lines = [
    `CLAUDE_WORKER_MONITOR_MODEL=${monitorModel}`,
    `CLAUDE_WORKER_MONITOR_EFFORT=${monitorEffort}`,
    `CLAUDE_WORKER_MONITOR_INTERVAL_MS=${intervalMs}`,
  ];
  if (schedule.activeHours) {
    lines.push(`CLAUDE_WORKER_MONITOR_ACTIVE_HOURS=${schedule.activeHours}`);
  }
  if (schedule.activeDays) {
    lines.push(`CLAUDE_WORKER_MONITOR_ACTIVE_DAYS=${schedule.activeDays}`);
  }
  lines.push(`CLAUDE_WORKER_EXECUTOR_MODEL=${executorModel}`);
  lines.push(`CLAUDE_WORKER_EXECUTOR_EFFORT=${executorEffort}`);
  if (configDir) lines.push("", `CLAUDE_CONFIG_DIR=${configDir}`);
  return `${lines.join("\n")}\n`;
}

function configFilePaths(envFile?: string): [string, string, string] {
  const promptsDir = resolve(process.cwd(), "prompts");
  return [
    resolveEnvPath(envFile),
    resolve(promptsDir, "monitor.prompt.md"),
    resolve(promptsDir, "executor.prompt.md"),
  ];
}

export function isConfigured(envFile?: string): boolean {
  return configFilePaths(envFile).every((path) => existsSync(path));
}

export async function runConfigure(envFile?: string): Promise<boolean> {
  const [envPath, monitorPromptPath, executorPromptPath] = configFilePaths(envFile);

  try {
    if (!(await confirmOverwrite([envPath, monitorPromptPath, executorPromptPath]))) {
      logger.info(CANCEL_MESSAGE);
      return false;
    }

    logger.info(
      "The worker consists of two agents: the monitor cyclically detects work to be done " +
        "and adds tasks to the list, while the executor completes tasks from the list — each in a separate session.",
    );

    const monitorModel = await ask("Monitor model (cheap — only detects tasks)", {
      type: "select",
      options: MODELS,
      initial: "sonnet",
    });

    const monitorEffort = await ask("Monitor effort (reasoning effort level)", {
      type: "select",
      options: EFFORTS,
      initial: "medium",
    });

    const intervalMinutes = await askIntervalMinutes();
    const intervalMs = Math.round(intervalMinutes * 60_000);

    const activeHours = await askOptional(
      "Monitor working hours (HH:MM-HH:MM, Enter = 24/7)",
      "e.g. 08:00-18:00",
      parseTimeWindow,
    );
    const activeDays = await askActiveDays();

    const monitorPrompt = await askText(
      "What should the monitor watch? (e.g. “Redmine tasks assigned to me with status Open”)",
    );

    const executorModel = await ask("Executor model (powerful — completes tasks)", {
      type: "select",
      options: MODELS,
      initial: "opus",
    });

    const executorEffort = await ask("Executor effort (reasoning effort level)", {
      type: "select",
      options: EFFORTS,
      initial: "high",
    });

    const executorPrompt = await askText(
      "Who is the executor and how should it complete tasks? (identity, working rules, available tools)",
    );

    const useConfigDir = await ask(
      "Use a separate Claude config directory (CLAUDE_CONFIG_DIR)?",
      { type: "confirm", initial: false },
    );
    let configDir: string | undefined;
    if (useConfigDir) {
      configDir = await askText("CLAUDE_CONFIG_DIR path", {
        placeholder: "e.g. ~/.claude-other-profile",
      });
    }

    await mkdir(dirname(monitorPromptPath), { recursive: true });
    await writeFile(
      envPath,
      buildEnv({
        monitorModel,
        monitorEffort,
        executorModel,
        executorEffort,
        intervalMs,
        schedule: { activeHours, activeDays },
        configDir,
      }),
      "utf8",
    );
    await writeFile(monitorPromptPath, `${monitorPrompt}\n`, "utf8");
    await writeFile(executorPromptPath, `${executorPrompt}\n`, "utf8");

    logger.success(`Saved ${envPath}`);
    logger.success(`Saved ${monitorPromptPath}`);
    logger.success(`Saved ${executorPromptPath}`);
    logger.info(
      "Agent role definitions live in prompts/monitor.system.md and prompts/executor.system.md " +
        "(versioned in the repo) — you can edit them manually.",
    );
    return true;
  } catch (err) {
    if (isCancellation(err)) {
      logger.info(CANCEL_MESSAGE);
      return false;
    }
    throw err;
  }
}
