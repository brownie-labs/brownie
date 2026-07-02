<p align="center">
  <h1 align="center">🧝 Brownie</h1>
</p>

<p align="center">
  <strong>Your household sprite for the work you keep putting off. It works while you're not looking.</strong><br>
  <em>Not the cake. The spirit. 🍪➡️🧝</em>
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white">
  <img alt="Vitest" src="https://img.shields.io/badge/tests-vitest-6E9F18?logo=vitest&logoColor=white">
</p>

---

Brownie is a CLI that cyclically runs [Claude Code](https://claude.com/claude-code) sessions in a two-agent setup: the **monitor** watches for tasks, the **executor** completes them, and the **summarizer** writes findings to long-term memory. You sleep — the sprite tidies up.

> If you want an agent that finds its own work, gets it done, and even remembers what it learned — this is it.

## How it works

```
        every N minutes (only during working hours)
                          │
                          ▼
                  ┌───────────────┐   JSON report   ┌───────────────┐
                  │    MONITOR    │ ───────────────▶│   TaskStore   │
                  │   (sonnet)    │     (tasks)     │  tasks.json   │
                  └───────────────┘                 └───────┬───────┘
                                                            │ wakes (Waker)
                                                            │
┌───────────────┐  session log  ┌───────────────┐  pending  │
│  SUMMARIZER   │ ◀──────────── │   EXECUTOR    │ ◀─────────┘
│   (sonnet)    │               │    (opus)     │
└───────┬───────┘               └───────┬───────┘
        │ findings                      │ memory_search / memory_get
        ▼                               ▼
┌───────────────────────────────────────────────┐
│            Memory (SQLite + FTS5)             │
│              MCP server (stdio)               │
└───────────────────────────────────────────────┘
```

Two loops run in parallel and communicate only through the shared task store:

1. **Monitor** — every configured interval (and only within the configured window of hours/days) it fires a Claude session with an enforced JSON schema. The result is a list of tasks, deduplicated by `id` and written to the `TaskStore`.
2. **Executor** — woken immediately when new tasks arrive, it completes them one by one in sessions with full access to tools and to long-term memory via MCP. Transient errors (timeout, known patterns) are retried with a delay; the rest are marked as `failed`.
3. **Summarizer** — after each executor session (success or failure) it reads the session log and writes findings to SQLite. Later sessions can search them full-text (FTS5) with the `memory_search` / `memory_get` tools.

## Highlights

- 🔁 **Autonomous loop** — the monitor reports tasks on its own, the executor completes them on its own; zero manual queuing.
- 🧠 **Long-term memory** — SQLite + FTS5 exposed to the executor as an MCP server; the sprite learns from its own sessions.
- ⏰ **Working hours** — a time window and days of the week (`08:00-18:00`, `mon-fri`); outside them the monitor rests.
- 🔂 **Smart retries** — distinguishes transient from permanent errors, configurable number of attempts and delay.
- 📺 **TUI dashboard** — a live view of both loops (Ink/React): session statuses, tasks, events.
- 🗂️ **Persistent session logs** — every session lands in `logs/<agent>/<day>/<hour>_<sessionId>.log`.
- 🎛️ **Per-agent model and effort** — sonnet for the patrol, opus for the work; all configurable.
- 🧾 **Tasks in JSON** — `data/tasks.json` with atomic writes; stalled `in_progress` tasks return to `pending` after a restart.
- 📝 **Prompts in files** — the entire personality of the agents lives in `prompts/*.md`, no prompts baked into the code.

## Requirements

- Node.js ≥ 22 and pnpm
- The [Claude Code CLI](https://claude.com/claude-code) (`claude`) installed and logged in

## Quick start (TL;DR)

```bash
pnpm install

# interactively generate .env and the prompts
pnpm configure

# release the sprite
pnpm start        # or: pnpm dev (watch)
```

Binary subcommands:

```bash
brownie start        # run both loops + dashboard
brownie configure    # interactive configuration (.env, prompts)
brownie mcp --db …   # memory MCP server (used internally by the executor)
```

## Configuration

Everything through `CLAUDE_WORKER_*` variables in `.env` (validated with zod — a typo won't get through). `pnpm configure` walks you through all of it, but you can also do it by hand:

| Variable                                      | Default                          | Description                                       |
| --------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| `CLAUDE_WORKER_MONITOR_MODEL`                 | `sonnet`                         | monitor model                                     |
| `CLAUDE_WORKER_MONITOR_EFFORT`                | `medium`                         | monitor effort                                    |
| `CLAUDE_WORKER_MONITOR_INTERVAL_MS`           | `900000` (15 min)                | patrol interval                                   |
| `CLAUDE_WORKER_MONITOR_ACTIVE_HOURS`          | _(24/7)_                         | working window, e.g. `08:00-18:00`                |
| `CLAUDE_WORKER_MONITOR_ACTIVE_DAYS`           | _(daily)_                        | working days, e.g. `mon-fri` or `mon,wed,sat-sun` |
| `CLAUDE_WORKER_MONITOR_PROMPT_FILE`           | `./prompts/monitor.prompt.md`    | monitor prompt                                    |
| `CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE`    | `./prompts/monitor.system.md`    | monitor system prompt                             |
| `CLAUDE_WORKER_MONITOR_SESSION_TIMEOUT_MS`    | _(none)_                         | monitor session timeout                           |
| `CLAUDE_WORKER_EXECUTOR_MODEL`                | `opus`                           | executor model                                    |
| `CLAUDE_WORKER_EXECUTOR_EFFORT`               | `high`                           | executor effort                                   |
| `CLAUDE_WORKER_EXECUTOR_PROMPT_FILE`          | `./prompts/executor.prompt.md`   | executor prompt                                   |
| `CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE`   | `./prompts/executor.system.md`   | executor system prompt                            |
| `CLAUDE_WORKER_EXECUTOR_SESSION_TIMEOUT_MS`   | _(none)_                         | executor session timeout                          |
| `CLAUDE_WORKER_EXECUTOR_TASK_ATTEMPTS`        | `3`                              | max task attempts                                 |
| `CLAUDE_WORKER_EXECUTOR_RETRY_DELAY_MS`       | `30000`                          | delay between attempts                            |
| `CLAUDE_WORKER_SUMMARIZER_MODEL`              | `sonnet`                         | summarizer model                                  |
| `CLAUDE_WORKER_SUMMARIZER_EFFORT`             | `medium`                         | summarizer effort                                 |
| `CLAUDE_WORKER_SUMMARIZER_SYSTEM_PROMPT_FILE` | `./prompts/summarizer.system.md` | summarizer system prompt                          |
| `CLAUDE_WORKER_SUMMARIZER_SESSION_TIMEOUT_MS` | `300000` (5 min)                 | summarizer session timeout                        |
| `CLAUDE_WORKER_MEMORY_DB`                     | `./data/memory.db`               | long-term memory database                         |
| `CLAUDE_WORKER_TASKS_FILE`                    | `./data/tasks.json`              | task store                                        |
| `CLAUDE_WORKER_LOGS_DIR`                      | `./logs`                         | session logs directory                            |
| `CLAUDE_WORKER_STREAM_PARTIAL`                | `true`                           | stream partial responses to the dashboard         |
| `CLAUDE_WORKER_CWD`                           | `./workspace`                    | working directory for agent sessions              |

## Prompts

The sprite's entire personality lives in `prompts/*.md`:

| File                   | Role                                                            |
| ---------------------- | --------------------------------------------------------------- |
| `monitor.system.md`    | who the monitor is and how it decides what counts as a task     |
| `monitor.prompt.md`    | what the monitor should check on every patrol                   |
| `executor.system.md`   | the executor's working rules                                    |
| `executor.prompt.md`   | the task template (the task description is appended at the end) |
| `summarizer.system.md` | how to distill a session into findings worth remembering        |

This is where you decide what the sprite works on: reviewing PRs, watching CI, tidying the backlog — whatever you describe.

## Security

Agent sessions run with `--permission-mode bypassPermissions` and full tool access — the sprite has a free hand within `CLAUDE_WORKER_CWD` (`./workspace` by default). So release it onto well-considered ground: a dedicated working directory, well-considered prompts, no secrets within reach. Treat tasks reported by the monitor like any input to an autonomous agent — the prompts define the boundaries.

## Development

```bash
pnpm dev              # start with watch (tsx)
pnpm check            # typecheck + lint + format:check + test — before every commit
pnpm test             # vitest run
pnpm test:coverage    # coverage thresholds enforced in vitest.config.ts
pnpm build            # tsup -> dist/
```

Claude sessions are tested without the real CLI — `test/fixtures/claude` is a fake binary driven by `FAKE_CLAUDE_*` variables. Coverage thresholds (statements 92%, lines 94%) are enforced, so new code must be tested.

## Why "Brownie"?

In British folklore a **brownie** is a household spirit that, at night — while the household sleeps — quietly finishes their work for them. It has two iron rules: it works unbidden, and it vanishes when watched. Ours is a touch more modern: instead of a bowl of milk it takes tokens, and instead of sweeping the room it closes out your tasks. Watching is allowed (that's what the dashboard is for). 🧝
