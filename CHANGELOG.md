# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `brownie tasks|settings|prompt|memory` subcommands and a documented wire protocol on the control socket: list, add, retry and cancel tasks, read or patch settings live (a sparse JSON merge where `null` deletes a key, validated before writing), read or replace the project prompts, and query long-term memory — everything the dashboard can do, from a shell or from your own tooling ([docs/control.md](docs/control.md)).
- `BROWNIE_CONTROL_SOCKET` moves the control socket to a path both a container and its host can see; the worker creates the directory and the CLI reads the same variable.
- `--paused` (env `BROWNIE_START_PAUSED=1`) boots a headless worker with both agents paused, so a supervisor decides when they start.
- Credential failures park the agents instead of burning retries: a rejected token (`401`, `Not logged in`) returns the task to the queue without consuming an attempt, pauses both agents in the new `authBlocked` phase — visible in the dashboard, `brownie status` and the `monitor.authBlocked` / `executor.authBlocked` log events — and waits for `brownie resume` or `/start`. Preflight runs `claude auth status --json` and refuses to start when no login is configured.
- Prebuilt container images on GHCR, published for `linux/amd64` and `linux/arm64` with every release: `ghcr.io/brownie-labs/brownie` is the image the reference `Dockerfile` builds, and the `-browser` variant adds Chromium (run headless) with a pinned `@playwright/mcp` (installed globally as `playwright-mcp`) for agents that browse the web through MCP. Tagged `<version>`, `<major>.<minor>` and `latest` — use them in `docker-compose.yml` with `image:` instead of `build:` ([docs/deployment.md](docs/deployment.md#prebuilt-images)).
- `brownie version [--json]` and the `{"cmd":"version"}` control request expose a running worker's identity — brownie, Claude Code CLI and Node versions, pid, start time, project directory, and `authKind` (`apiKey`, `oauth`, `claude.ai` or `unknown`, never the secret itself). `brownie status --json` carries the same fields and the headless `worker.started` event logs the versions and `authKind` too; `brownie --version` is unchanged.

### Changed

- The `Dockerfile` names its stages: `runtime` is the image it always built and stays the default target of a plain `docker build .`, `browser` is the new variant (`docker build --target browser .`); `docker-compose.yml` targets `runtime` explicitly.
- `brownie status` opens with an identity line (`brownie <version> · claude <version> · auth <kind> · pid <pid> · …`), and a CLI asking a worker started from an older brownie for a command it predates gets a restart hint instead of `Unrecognized control request.`
- The Docker image pins the Claude Code version (`CLAUDE_CODE_VERSION`, overridable from `docker-compose.yml`) and disables both auto-updaters, so every container runs the CLI it was built with.

## [0.4.0] - 2026-09-03

### Added

- `fable` joins the model aliases accepted by `/model` and `settings.json` (`monitor.model`, `executor.model`, `summarizer.model`), with the full `low`…`max` effort range. Defaults are unchanged.

## [0.3.1] - 2026-07-13

### Changed

- Upgraded runtime dependencies, notably ink 6 → 7 and zod 3 → 4.

### Fixed

- Suppress the `ExperimentalWarning: SQLite is an experimental feature` noise that Node prints on every invocation. The CLI shebang and the spawned memory MCP server now pass `--disable-warning=ExperimentalWarning`, and the `start`/`dev` scripts do the same, so `brownie --version`, `brownie update`, and every other command start clean.

## [0.3.0] - 2026-07-09

### Added

- Self-update: `brownie update` (with `--check`) compares the installed version against the npm registry and installs the newest release using whichever package manager put it there (npm/pnpm/yarn/bun). A running worker also checks in the background and, when `autoUpdate` is on (the default), installs new versions to apply on the next restart — surfaced in the dashboard header and as `update.available` / `update.installed` headless events. Configure it in the new global `~/.brownie/config.json`, or disable it entirely with `BROWNIE_DISABLE_AUTOUPDATER=1`.

## [0.2.0] - 2026-07-09

### Changed

- The Docker image now ships Python 3 (with `pip`/`venv`) and the Docker CLI + compose plugin alongside Node, plus a developer baseline (`gh`, `jq`, `ripgrep`, `make`, `build-essential`, `curl`). The agent provisions any other runtimes itself via the host's Docker socket, which `docker-compose.yml` now mounts. Credentials (`gh`/`ssh`/`git`) configured inside the container persist across restart and rebuild in a named `brownie-home` volume; grant socket access on Linux with `DOCKER_GID`.

## [0.1.0] - 2026-07-08

Initial release.

### Added

- Two-agent worker loop: a monitor that patrols your sources on an interval and reports tasks as structured JSON, and an executor that completes them one by one with full tool access.
- Long-term memory (SQLite + FTS5) written by a summarizer after every executor session and exposed back to the executor over MCP (`memory_search`, `memory_get`).
- Interactive TUI in the style of Claude Code: live agent status, dashboard/agent/task/memory views, slash commands with history and tab completion.
- Runtime configuration (`/model`, `/effort`, `/interval`, `/hours`, `/days`, `/prompt`) persisted to `.brownie/settings.json` and applied without restart.
- Working hours and days for the monitor; agents boot paused in a terminal and start with `/start`.
- Usage-limit awareness: when Claude Code hits its 5-hour or weekly limit both agents park with a countdown and resume after the reset; interrupted tasks return to the queue without burning a retry.
- Transient-failure retries with fail-fast for permanent errors; stalled tasks recover on restart.
- Headless mode for servers: structured line logs (pretty or NDJSON), a local control socket, and the `brownie status` / `pause` / `resume` commands.
- Non-interactive `brownie init` for provisioning, plus a first-run wizard in the terminal.
- Reference `Dockerfile` and `docker-compose.yml`.

[Unreleased]: https://github.com/brownie-labs/brownie/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/brownie-labs/brownie/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/brownie-labs/brownie/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/brownie-labs/brownie/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/brownie-labs/brownie/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/brownie-labs/brownie/releases/tag/v0.1.0
