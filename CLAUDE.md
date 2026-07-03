# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`brownie` — a CLI (Node >= 22, pnpm, ESM, TypeScript, npm package `@midaz-studio/brownie`, binary `brownie`) that cyclically runs Claude Code sessions in a two-agent setup: the **monitor** reports tasks, the **executor** completes them, and the **summarizer** writes findings to long-term memory. Code, messages, and commits are in English.

Like Claude Code's `.claude/`, all per-project state lives in `<cwd>/.brownie/`: `settings.json` (configuration), `prompts/*.prompt.md` (project prompts), `data/` (tasks.json, memory.db), `logs/` (session logs), `.gitignore` (self-ignores data/ and logs/). System prompts ship with the package (`<packageRoot>/prompts/*.system.md`). Agent sessions run in the project directory itself (`cwd`), not in a sandbox. The full path layout is defined in `src/paths.ts` (`projectPaths`, `packagePromptsDir`, `systemPromptFiles`).

## Commands

```bash
pnpm dev                  # start with watch (tsx)
pnpm start                # start without watch (first run opens the configuration wizard)
pnpm configure            # force the configuration wizard (brownie --configure)
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

The entry point `src/index.ts` dispatches manually on `argv`: `brownie mcp …` goes to `mcpCommand`, everything else to `mainCommand` (`src/main.ts`, citty). `runBrownie` in `main.ts` runs the interactive configuration wizard (`runConfigure` in `configure.ts`) when the setup is missing (`isConfigured`: `.brownie/settings.json` + both project prompt files) or when `--configure` is passed — but only in a TTY — and then starts the worker. The manual dispatch exists because citty treats the first positional raw arg as a subcommand name and runs the parent `run` after a subcommand. Brownie always operates on `process.cwd()` — there is no flag to point it elsewhere (test code injects paths via the `ConfigDirs` object instead).

`src/start.ts` (`startWorker`) wires everything together: after preflight (`preflight.ts`) and loading the configuration, it runs **two loops in parallel** (`Promise.all`) that communicate only through shared objects:

- **`runMonitorLoop` (`monitor.ts`)** — every `intervalMs` (and only within the window from `active-hours.ts`) it fires a Claude session with an enforced task-report JSON schema (`report.ts`), adds tasks to the `TaskStore` (deduplicated by `id`), and wakes the executor via the `Waker`.
- **`runExecutorLoop` (`executor.ts`)** — pulls `pending` tasks from the `TaskStore`, appends the task description to the prompt, and runs a session with access to memory (MCP). Transient failures (`isTransientFailure`: a timeout or a pattern in the result text) are retried up to `maxTaskAttempts` with a delay; the rest are marked `failed`. After each session (success or failure) it fires the `SessionSummarizer`.

Other pieces:

- **`runner.ts`** — the only place that spawns the `claude` process (`-p --model --effort --system-prompt --output-format stream-json --permission-mode bypassPermissions`, prompt via stdin). Handles timeout/abort (SIGTERM, then SIGKILL after 5s). `stream.ts` parses stream-json into `SessionEvent`s and builds a `SessionSummary`.
- **`tasks.ts` (`TaskStore`)** — a JSON task store (`.brownie/data/tasks.json`), atomic writes (tmp + rename), operations serialized through a promise chain; on startup it resets stalled `in_progress` tasks back to `pending`.
- **`src/memory/`** — long-term memory: `store.ts` (SQLite via `node:sqlite` + FTS5), `summarizer.ts` (a haiku session that reads the executor session log, writing the result to the database), `mcp.ts` (a stdio MCP server with the `memory_search`/`memory_get` tools; the executor receives it via `--mcp-config` pointing back at the same binary: `brownie mcp --db ...`).
- **`status.ts` + `src/ui/`** — `WorkerStatusStore` collects events from both loops and feeds the TUI dashboard (Ink/React). Session events are simultaneously tee-d (`teeSession`) into persistent `SessionLog` files (`.brownie/logs/<agent>/<day>/<hour>_<sessionId>.log`).
- **`paths.ts`** — the single source of truth for the filesystem layout: `projectPaths(projectDir)` derives every `.brownie/` path, `packageRootDir`/`packagePromptsDir` locate the installed package via `import.meta.url` (works both in dev via tsx and in the tsup bundle `dist/index.js`).
- **`config.ts`** — all configuration in `.brownie/settings.json`, a nested JSON validated with zod (`settingsSchema`, `.strict()` at every level, so typo keys fail with a named path). A new configuration option = a key in `settingsSchema` + a mapping in `loadWorkerConfig` + usually a question in `configure.ts`. `ConfigDirs { projectDir?, systemPromptsDir? }` exists for test injection; production code always passes `{}`.

## Prompts

All agent prompts live in markdown files. **Never put prompt content as constants in the code** — always in markdown files.

The **system prompts** (`prompts/*.system.md`) ship with the npm package (listed in `package.json` `files`) and resolve from the package root, not from the user's project; they are in English and impose no output language. The **project prompts** (`.brownie/prompts/monitor.prompt.md`, `.brownie/prompts/executor.prompt.md`) are written by the wizard into the user's project and carry the business context (Redmine IDs, repositories, URLs).

## Tests

- Vitest, tests in `test/` mirror the structure of `src/`. Coverage thresholds (statements 92%, lines 94%…) are enforced in `vitest.config.ts` — new code must be tested.
- Claude sessions are tested without a real CLI: `test/fixtures/claude` is a fake binary script driven by `FAKE_CLAUDE_*` variables (mode, result text, argument dump), with per-model variants via the `_<MODEL>` suffix. Helper factories for configs and reporters are in `test/helpers.ts`.

## Conventions

- ESLint: `strictTypeChecked` + `stylisticTypeChecked`; `tsconfig` with `exactOptionalPropertyTypes` (hence explicit `| undefined` in interfaces).
- User-facing messages, CLI descriptions, errors, and commits in English; no comments in the code.
- Agent sessions run in the project directory itself (`config.cwd = process.cwd()`); `.brownie/` is runtime state (gitignored in this repo and ignored by eslint) — not part of the source code.
