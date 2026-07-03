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
- 🗂️ **Persistent session logs** — every session lands in `.brownie/logs/<agent>/<day>/<hour>_<sessionId>.log`.
- 🎛️ **Per-agent model and effort** — sonnet for the patrol, opus for the work; all configurable.
- 🧾 **Tasks in JSON** — `.brownie/data/tasks.json` with atomic writes; stalled `in_progress` tasks return to `pending` after a restart.
- 📝 **Prompts in files** — the entire personality of the agents lives in markdown files, no prompts baked into the code.
- 📁 **Per-project state** — like Claude Code's `.claude/`, everything brownie needs lives in `.brownie/` inside your project.

## Requirements

- Node.js ≥ 22
- The [Claude Code CLI](https://claude.com/claude-code) (`claude`) installed and logged in

## Quick start (TL;DR)

```bash
npm install -g @midaz-studio/brownie

cd your-project
brownie           # first run: configuration wizard, then both loops + dashboard
```

Binary usage:

```bash
brownie                # first run: configuration wizard, then both loops + dashboard
brownie --configure    # rerun the configuration wizard (settings + project prompts)
brownie mcp --db …     # memory MCP server (used internally by the executor)
```

Working from a clone instead:

```bash
pnpm install
pnpm start        # or: pnpm dev (watch)
```

## The `.brownie/` directory

Like Claude Code's `.claude/`, brownie keeps all per-project state in `.brownie/` inside the directory you run it from:

```
your-project/
└── .brownie/
    ├── settings.json              # configuration (validated with zod)
    ├── .gitignore                 # ignores data/ and logs/ (written once by the wizard)
    ├── prompts/
    │   ├── monitor.prompt.md      # what the monitor should check on every patrol
    │   └── executor.prompt.md     # who the executor is and how it works
    ├── data/                      # tasks.json + memory.db (runtime state)
    └── logs/                      # session logs per agent/day
```

Commit `settings.json` and `prompts/` if your team shares them — `data/` and `logs/` are ignored automatically via the wizard-written `.brownie/.gitignore`.

> Migrating from an older version? Configuration moved from `.env` to `.brownie/settings.json` — rerun `brownie --configure`.

## Configuration

Everything lives in `.brownie/settings.json` (validated with zod — a typo won't get through). The first `brownie` run (or `brownie --configure`) walks you through all of it, but you can also edit it by hand. Every section is optional — `{}` is a valid file:

| Key                           | Default          | Description                                       |
| ----------------------------- | ---------------- | ------------------------------------------------- |
| `monitor.model`               | `sonnet`         | monitor model                                     |
| `monitor.effort`              | `medium`         | monitor effort                                    |
| `monitor.intervalMinutes`     | `15`             | patrol interval (fractions allowed)               |
| `monitor.activeHours`         | _(24/7)_         | working window, e.g. `08:00-18:00`                |
| `monitor.activeDays`          | _(daily)_        | working days, e.g. `mon-fri` or `mon,wed,sat-sun` |
| `monitor.sessionTimeoutMs`    | _(none)_         | monitor session timeout                           |
| `executor.model`              | `opus`           | executor model                                    |
| `executor.effort`             | `high`           | executor effort                                   |
| `executor.sessionTimeoutMs`   | _(none)_         | executor session timeout                          |
| `executor.maxTaskAttempts`    | `3`              | max task attempts                                 |
| `executor.retryDelayMs`       | `30000`          | delay between attempts                            |
| `summarizer.model`            | `sonnet`         | summarizer model                                  |
| `summarizer.effort`           | `medium`         | summarizer effort                                 |
| `summarizer.sessionTimeoutMs` | `300000` (5 min) | summarizer session timeout                        |
| `streamPartial`               | `true`           | stream partial responses to the dashboard         |
| `claudeConfigDir`             | _(none)_         | separate Claude config dir (`CLAUDE_CONFIG_DIR`)  |

## Prompts

The sprite's personality is split between the package and your project:

| File                                  | Lives in     | Role                                                            |
| ------------------------------------- | ------------ | --------------------------------------------------------------- |
| `prompts/monitor.system.md`           | the package  | who the monitor is and how it decides what counts as a task     |
| `prompts/executor.system.md`          | the package  | the executor's working rules                                    |
| `prompts/summarizer.system.md`        | the package  | how to distill a session into findings worth remembering        |
| `.brownie/prompts/monitor.prompt.md`  | your project | what the monitor should check on every patrol                   |
| `.brownie/prompts/executor.prompt.md` | your project | the task template (the task description is appended at the end) |

The project prompts are where you decide what the sprite works on: reviewing PRs, watching CI, tidying the backlog — whatever you describe.

## Security

> **⚠️ The sprite works directly in your project.** Agent sessions run with `--permission-mode bypassPermissions` and full tool access **in the directory you run `brownie` from** — there is no isolated sandbox. Run it in projects you trust it with: well-considered prompts, no secrets within reach, version control as your safety net. Treat tasks reported by the monitor like any input to an autonomous agent — the prompts define the boundaries.

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
