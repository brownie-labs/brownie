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

The worker exposes a local control socket, created automatically — nothing to configure. From any shell in the same project directory:

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

The repo ships a reference `Dockerfile` and `docker-compose.yml`. From your project directory:

```bash
export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-…
export DOCKER_GID=$(getent group docker | cut -d: -f3)   # Linux — see "Docker access" below
docker compose up -d
docker compose logs -f                        # NDJSON event stream
docker compose exec brownie brownie status
```

The current directory is mounted as `/workspace`, so the project, its `.brownie/`, and all runtime state stay on the host. `docker ps` shows `healthy` only while the worker actually answers.

### What the image gives your agent

The image ships **Node, Python 3 (with `pip`/`venv`), and the Docker CLI + compose plugin**, plus a developer baseline: `git`, `gh`, `jq`, `ripgrep`, `make`, `build-essential`, `curl`. It deliberately does not bundle every language — for anything else (other runtimes, databases, services) the agent starts its own containers via Docker, so you don't rebuild the image to add a toolchain.

### Docker access

The host's Docker socket is mounted into the container so the agent can run `docker`. Because the agent runs as a non-root user, grant it access with `DOCKER_GID`:

- **Linux:** set it to the host's `docker` group id before `docker compose up`:

  ```bash
  export DOCKER_GID=$(getent group docker | cut -d: -f3)
  ```

  Leave it unset and the compose default (`999`) is used, which usually won't match — you'll get `permission denied` on the socket.

- **Docker Desktop on macOS:** the socket is bridged through the VM and usually works without setting `DOCKER_GID`. If `docker` inside the container reports `permission denied`, check the socket's group with `docker compose exec brownie ls -ln /var/run/docker.sock` and set `DOCKER_GID` to that number.

### Credentials

Configure `gh`, `ssh`, and `git` **once, inside the container** — they're stored in a named volume (`brownie-home`) and survive restart and rebuild:

```bash
docker compose exec brownie bash
gh auth login
ssh-keygen -t ed25519
git config --global user.name "…"
```

Everything under the home directory (`~/.config/gh`, `~/.ssh`, `~/.gitconfig`, …) persists, so `docker compose build && docker compose up -d` keeps your logins.

### Multiple agents, multiple accounts

To run several agents with different credentials, start each as its own compose project:

```bash
docker compose -p acme up -d
docker compose -p globex up -d
```

Each `-p <name>` gets its own home volume, so the `gh`/`ssh`/`git` identity in one never leaks into another.

## Costs, unattended

Everything from [Security & costs](../README.md#security--costs) applies double when nobody is watching: start with a conservative `intervalMinutes`, keep `activeHours` tight, and let `brownie status` (or the `cycle.finished` cost fields in the logs) tell you what a day of patrols actually costs before you shorten the leash.
