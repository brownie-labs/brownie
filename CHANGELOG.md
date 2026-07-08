# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/brownie-labs/brownie/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/brownie-labs/brownie/releases/tag/v0.1.0
