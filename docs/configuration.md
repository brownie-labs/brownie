# Configuration

Everything lives in `.brownie/settings.json` — a nested JSON validated with zod (strict at every level, so a typo'd key fails with a named path instead of being silently ignored). The first `brownie` run (or `brownie config` at any time) walks you through all of it with a wizard, but the file is meant to be edited by hand too.

Every section is optional — `{}` is a valid file. A typical setup:

```json
{
  "monitor": {
    "model": "sonnet",
    "intervalMinutes": 15,
    "activeHours": "08:00-18:00",
    "activeDays": "mon-fri"
  },
  "executor": {
    "model": "opus",
    "effort": "high",
    "sessionTimeoutMs": 1800000
  }
}
```

## All settings

| Key                           | Default          | Description                                             |
| ----------------------------- | ---------------- | ------------------------------------------------------- |
| `monitor.model`               | `sonnet`         | monitor model                                           |
| `monitor.effort`              | `medium`         | monitor effort: `low`, `medium`, `high`, `xhigh`, `max` |
| `monitor.intervalMinutes`     | `15`             | patrol interval (fractions allowed)                     |
| `monitor.activeHours`         | _(24/7)_         | working window, e.g. `08:00-18:00`                      |
| `monitor.activeDays`          | _(daily)_        | working days, e.g. `mon-fri` or `mon,wed,sat-sun`       |
| `monitor.sessionTimeoutMs`    | _(none)_         | monitor session timeout                                 |
| `executor.model`              | `opus`           | executor model                                          |
| `executor.effort`             | `high`           | executor effort                                         |
| `executor.sessionTimeoutMs`   | _(none)_         | executor session timeout                                |
| `executor.maxTaskAttempts`    | `3`              | max attempts per task (transient failures are retried)  |
| `executor.retryDelayMs`       | `30000`          | delay between attempts                                  |
| `summarizer.model`            | `sonnet`         | summarizer model                                        |
| `summarizer.effort`           | `medium`         | summarizer effort                                       |
| `summarizer.sessionTimeoutMs` | `300000` (5 min) | summarizer session timeout                              |
| `streamPartial`               | `true`           | stream partial responses to the dashboard               |
| `claudeConfigDir`             | _(none)_         | separate Claude config dir (`CLAUDE_CONFIG_DIR`)        |

## Working hours

The monitor patrols only inside the configured window; outside it the loop sleeps until the next opening. The executor is not limited by the window — it finishes whatever is already in the queue.

- `activeHours` — `HH:MM-HH:MM`, e.g. `08:00-18:00`. Overnight windows work too: `22:00-06:00`.
- `activeDays` — day tokens `mon`…`sun`, as ranges and/or a comma-separated list: `mon-fri`, `sat-sun`, `mon,wed,fri`, `fri-mon`.

## Timeouts and retries

- `sessionTimeoutMs` kills a stuck session (SIGTERM, then SIGKILL after 5 s). A timeout counts as a **transient** failure.
- The executor retries transient failures (timeouts, known error patterns in the result) up to `maxTaskAttempts` with `retryDelayMs` between attempts; permanent failures mark the task `failed` right away. Failed tasks can be requeued from the TUI with `/retry <task-id>`.

## `claudeConfigDir`

Points the spawned Claude Code sessions at a separate config directory (exported as `CLAUDE_CONFIG_DIR`). Useful when brownie should run on its own Claude account or settings, isolated from your interactive one. `~` expands to your home directory.

## The `.brownie/` directory

Like Claude Code's `.claude/`, brownie keeps all per-project state in `.brownie/` inside the directory you run it from:

```
your-project/
└── .brownie/
    ├── settings.json              # configuration (validated with zod)
    ├── mcp.json                   # optional: project MCP servers (see docs/mcp.md)
    ├── .gitignore                 # ignores data/ and logs/ (written once by the wizard)
    ├── prompts/
    │   ├── monitor.prompt.md      # what the monitor should check on every patrol
    │   └── executor.prompt.md     # who the executor is and how it works
    ├── data/
    │   ├── tasks.json             # task queue (atomic writes)
    │   └── memory.db              # long-term memory (SQLite + FTS5)
    └── logs/                      # session logs: <agent>/<day>/<hour>_<sessionId>.log
```

Commit `settings.json` and `prompts/` if your team shares them — `data/` and `logs/` are runtime state, ignored automatically via the wizard-written `.brownie/.gitignore`. `mcp.json` is optional and managed by `brownie mcp add` ([docs/mcp.md](mcp.md)); gitignore it if it holds API keys.

Tasks live in `data/tasks.json` with atomic writes (tmp + rename); tasks stuck `in_progress` after a crash are reset to `pending` on the next start. Every session is also written to a persistent log under `logs/`, so you can always read back what an agent actually did.
