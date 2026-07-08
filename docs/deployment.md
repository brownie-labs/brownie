# Headless & deployment

Brownie runs unattended just as happily as it runs in a terminal. Without a TTY (systemd, Docker, CI, piping) it skips the dashboard entirely, boots the agents immediately, and prints structured line logs to stdout — one line per event, 12-factor style. A running worker is controlled from a second shell with `brownie status`, `brownie pause`, and `brownie resume`.

## Headless mode

Headless activates automatically when stdin or stdout is not a TTY. Force it in a terminal with `--headless`.

| Flag / env                    | Default  | Effect                                                |
| ----------------------------- | -------- | ----------------------------------------------------- |
| `--headless`                  | auto     | skip the dashboard even in a terminal, agents start   |
| `--log-format <pretty\|json>` | `pretty` | line format on stdout                                 |
| `BROWNIE_LOG_FORMAT`          | —        | fallback for `--log-format` when the flag is absent   |
| `--verbose`                   | off      | also log session text, tool calls, and failed results |

`pretty` is made for `journalctl -f` and human eyes; `json` (NDJSON — one JSON object per line) is made for log aggregators (Loki, Datadog, CloudWatch). Session transcripts are always written to `.brownie/logs/` in both modes, so stdout stays a timeline, not a firehose.

### Log events

Every JSON line carries the envelope `ts` (ISO 8601), `level` (`info`/`warn`/`error`), `event`, and `agent` (`monitor`/`executor`/`summarizer`, absent on worker-level events), plus the event's own fields:

```json
{
  "ts": "2026-07-08T09:05:03.000Z",
  "level": "info",
  "agent": "executor",
  "event": "task.finished",
  "taskId": "ci-42",
  "title": "Fix the build",
  "ok": true,
  "durationMs": 183000,
  "costUsd": 0.4183,
  "numTurns": 24
}
```

| Event                                                         | Fields                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `worker.started`                                              | `version`, `pid`, `projectDir`                                                                                             |
| `worker.stopped`                                              | `signal` (when stopped by SIGINT/SIGTERM)                                                                                  |
| `control.changed`                                             | `state` — an agent moved between `running`/`pausing`/`paused`                                                              |
| `cycle.started` / `cycle.finished`                            | `cycle`; finished adds `ok`, `durationMs`, `costUsd`, `addedTasks`, `skippedDuplicates`, `error`                           |
| `monitor.sleeping` / `monitor.offHours` / `monitor.limitWait` | `nextCycleAt` / `resumeAt`                                                                                                 |
| `task.started` / `task.finished`                              | `taskId`, `title`; finished adds `ok`, `durationMs`, `costUsd`, `numTurns`, `willRetry`, `attempt`, `maxAttempts`, `error` |
| `task.retryScheduled`                                         | `taskId`, `resumeAt`                                                                                                       |
| `executor.waiting` / `executor.limitWait`                     | — / `resumeAt`                                                                                                             |
| `summary.started` / `summary.finished`                        | `taskId`; finished adds `ok`, `durationMs`, `costUsd`, `error`                                                             |
| `session.init`                                                | `model`, `sessionId`                                                                                                       |
| `session.stderr` / `session.procError` / `session.killed`     | `line` / `message` / `reason`                                                                                              |
| `session.text` / `session.tool` / `session.toolError`         | only with `--verbose`                                                                                                      |

Optional fields are omitted, never `null` — the schema is stable and safe to index.

## Controlling a running worker

The worker exposes a control socket (a unix domain socket in the system temp directory, derived from the project path — nothing to configure). From any shell in the same project directory:

```bash
brownie status           # who's running, phases, task counts, cost
brownie status --json    # the same as machine-readable JSON
brownie pause            # both agents finish their session, then park
brownie pause monitor    # just one agent
brownie resume           # back to work
```

`brownie status --json` doubles as a health check — it exits non-zero when no worker is running. The socket also guards against double starts: a second `brownie` in the same project refuses to boot with `brownie is already running in this project (pid …)`.

## Provisioning without a terminal

The first-run wizard needs a TTY, but headless machines have two clean paths:

- **Commit `.brownie/` to the project repo.** The wizard-written `.brownie/.gitignore` excludes only `data/` and `logs/`, so `settings.json` and `prompts/` travel with a clone. Cloning the repo on the server is the whole setup.
- **`brownie init`** — the wizard's non-interactive twin, made for cloud-init/Ansible:

```bash
brownie init --monitor-prompt monitor.md --executor-prompt executor.md
brownie init --monitor-prompt monitor.md --executor-prompt executor.md --force  # overwrite existing prompts
```

It writes the same files the wizard would (`settings.json` `{}`, both prompts, the `.gitignore`) and never touches an existing `settings.json`. Without `--force` it refuses to overwrite existing prompts, so re-runs are safe. In a terminal, `brownie init` with no flags simply opens the wizard.

## Authentication

The server needs a logged-in Claude Code. Two options:

- **OAuth token** — run `claude setup-token` on your own machine and put the result in the `CLAUDE_CODE_OAUTH_TOKEN` environment variable on the server.
- **API key** — set `ANTHROPIC_API_KEY` (Anthropic Console billing instead of your subscription).

Either goes into the systemd unit or the container environment — no browser login on the server.

## A droplet runbook (systemd)

One thing before anything else: **run brownie as a regular user, not root.** Agent sessions use `--permission-mode bypassPermissions`, which Claude Code refuses to run as root — and a fresh droplet logs you in as root.

```bash
adduser brownie
su - brownie

# Node 22 + the two CLIs
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs git
sudo npm install -g @anthropic-ai/claude-code @brownie-labs/brownie

# the project brownie will work on (with .brownie/ committed, or run brownie init)
git clone git@github.com:you/your-project.git ~/your-project
```

The server also needs whatever the executor needs — the agents work on the real repo, so install the project's toolchain (test runner, `gh`, linters…) like you would for CI.

`/etc/systemd/system/brownie.service`:

```ini
[Unit]
Description=brownie worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=brownie
WorkingDirectory=/home/brownie/your-project
ExecStart=/usr/bin/brownie --log-format json
Restart=on-failure
RestartSec=10
Environment=TZ=Europe/Warsaw
Environment=CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-…

[Install]
WantedBy=multi-user.target
```

Set `TZ` deliberately: `activeHours`/`activeDays` use local time, and droplets default to UTC — a `08:00-18:00` window means UTC hours until you say otherwise.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now brownie
journalctl -u brownie -f                      # the pretty/json event stream
sudo -u brownie brownie status                # from the project directory
```

`systemctl stop` sends SIGTERM — brownie finishes writing logs, closes the socket, and exits cleanly (`worker.stopped signal=SIGTERM`).

## Docker

The repo ships a reference `Dockerfile` (multi-stage: build from source, install globally next to the Claude Code CLI, run as a non-root user) and a `docker-compose.yml`:

```bash
export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-…
docker compose up -d
docker compose logs -f                        # NDJSON event stream
docker compose exec brownie brownie status
```

The compose file mounts the current directory as `/workspace` — the project, its `.brownie/`, and all runtime state live on the host. The container's health check is `brownie status --json`, so `docker ps` shows `healthy` only while the worker actually answers.

The image contains Node, git, and the two CLIs — nothing project-specific. If your executor needs a toolchain (pnpm, go, a test runner…), build your own image `FROM` this one and add it, exactly like a CI image.

## Costs, unattended

Everything from [Security & costs](../README.md#security--costs) applies double when nobody is watching: start with a conservative `intervalMinutes`, keep `activeHours` tight, and let `brownie status` (or the `cycle.finished` cost fields in the logs) tell you what a day of patrols actually costs before you shorten the leash.
