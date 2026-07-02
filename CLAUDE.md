# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`brownie` — a CLI (Node >= 22, pnpm, ESM, TypeScript) that cyclically runs Claude Code sessions in a two-agent setup: the **monitor** reports tasks, the **executor** completes them, and the **summarizer** writes findings to long-term memory. Code, messages, and commits are in English.

## Commands

```bash
pnpm dev                  # start with watch (tsx)
pnpm start                # start without watch
pnpm configure            # interactive generation of .env and prompts
pnpm check                # typecheck + lint + format:check + test (run before committing)
pnpm typecheck
pnpm lint / pnpm lint:fix
pnpm format / pnpm format:check
pnpm test                 # vitest run
pnpm test test/executor.test.ts        # a single test file
pnpm vitest run -t "test name"         # a single test by name
pnpm test:coverage        # coverage thresholds enforced in vitest.config.ts
pnpm build                # tsup -> dist/
```

## Architecture

The entry point `src/index.ts` (citty) has three subcommands: `start`, `configure`, `mcp`.

`src/start.ts` wires everything together: after preflight (`preflight.ts`) and loading the configuration, it runs **two loops in parallel** (`Promise.all`) that communicate only through shared objects:

- **`runMonitorLoop` (`monitor.ts`)** — every `intervalMs` (and only within the window from `active-hours.ts`) it fires a Claude session with an enforced task-report JSON schema (`report.ts`), adds tasks to the `TaskStore` (deduplicated by `id`), and wakes the executor via the `Waker`.
- **`runExecutorLoop` (`executor.ts`)** — pulls `pending` tasks from the `TaskStore`, appends the task description to the prompt, and runs a session with access to memory (MCP). Transient failures (`isTransientFailure`: a timeout or a pattern in the result text) are retried up to `maxTaskAttempts` with a delay; the rest are marked `failed`. After each session (success or failure) it fires the `SessionSummarizer`.

Other pieces:

- **`runner.ts`** — the only place that spawns the `claude` process (`-p --model --effort --system-prompt --output-format stream-json --permission-mode bypassPermissions`, prompt via stdin). Handles timeout/abort (SIGTERM, then SIGKILL after 5s). `stream.ts` parses stream-json into `SessionEvent`s and builds a `SessionSummary`.
- **`tasks.ts` (`TaskStore`)** — a JSON task store (`data/tasks.json`), atomic writes (tmp + rename), operations serialized through a promise chain; on startup it resets stalled `in_progress` tasks back to `pending`.
- **`src/memory/`** — long-term memory: `store.ts` (SQLite via `node:sqlite` + FTS5), `summarizer.ts` (a haiku session that reads the executor session log, writing the result to the database), `mcp.ts` (a stdio MCP server with the `memory_search`/`memory_get` tools; the executor receives it via `--mcp-config` pointing back at the same binary: `brownie mcp --db ...`).
- **`status.ts` + `src/ui/`** — `WorkerStatusStore` collects events from both loops and feeds the TUI dashboard (Ink/React). Session events are simultaneously tee-d (`teeSession`) into persistent `SessionLog` files (`logs/<agent>/<day>/<hour>_<sessionId>.log`).
- **`config.ts`** — all configuration through `CLAUDE_WORKER_*` variables validated with zod (`envSchema`), `.env` loaded via `process.loadEnvFile`. A new configuration option = an entry in `envSchema` + a mapping in `loadWorkerConfig` + usually a question in `configure.ts`.

## Prompts

All agent prompts live in `prompts/*.md` (paths configurable via env). **Never put prompt content as constants in the code** — always in markdown files.

The **system prompts** (`monitor.system.md`, `executor.system.md`, `summarizer.system.md`) are in English and impose no output language. The **project-specific prompts** (`monitor.prompt.md`, `executor.prompt.md`) are in Polish and carry the business context (Redmine IDs, repositories, URLs) as well as the instruction for the agent to respond in Polish.

## Tests

- Vitest, tests in `test/` mirror the structure of `src/`. Coverage thresholds (statements 92%, lines 94%…) are enforced in `vitest.config.ts` — new code must be tested.
- Claude sessions are tested without a real CLI: `test/fixtures/claude` is a fake binary script driven by `FAKE_CLAUDE_*` variables (mode, result text, argument dump), with per-model variants via the `_<MODEL>` suffix. Helper factories for configs and reporters are in `test/helpers.ts`.

## Conventions

- ESLint: `strictTypeChecked` + `stylisticTypeChecked`; `tsconfig` with `exactOptionalPropertyTypes` (hence explicit `| undefined` in interfaces).
- User-facing messages, CLI descriptions, errors, and commits in English; no comments in the code.
- The `workspace/` directory is the cwd for agent sessions (ignored by lint), `data/` is runtime state — neither is part of the source code.
