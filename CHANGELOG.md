# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/brownie-labs/brownie/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/brownie-labs/brownie/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/brownie-labs/brownie/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/brownie-labs/brownie/releases/tag/v0.1.0
