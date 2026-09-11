# Controlling a running worker

A running worker listens on a local control socket — a unix domain socket (a named pipe on Windows) at `<tmpdir>/brownie-<uid>-<hash>.sock`, derived from the project directory, so any shell in the same directory finds it without configuration. Everything the dashboard can do is available over it: from a shell through the subcommands below, or straight over the wire from your own tooling.

Changes apply live — a patched setting on the next session, a replaced prompt on the next iteration, an added task as soon as the executor is idle. Commands exit `1` when no worker is running, when the worker rejects the request, and when `retry`/`cancel` matches no task.

## Commands

| Command                                                     | Effect                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `brownie status [--json]`                                   | who's running, phases, task counts, cost — non-zero without a worker, so it doubles as a health check  |
| `brownie pause [monitor\|executor]`                         | graceful pause — the current session finishes first                                                    |
| `brownie resume [monitor\|executor]`                        | resume paused agents (also after an `authBlocked` stop)                                                |
| `brownie tasks list [--status <s>] [--json]`                | the task queue, optionally one status                                                                  |
| `brownie tasks add <description> [--id <id>] [--title <t>]` | queue a task by hand                                                                                   |
| `brownie tasks retry <id>` / `brownie tasks cancel <id>`    | requeue a failed task / drop a pending one                                                             |
| `brownie settings get [--json]`                             | effective settings, defaults filled in                                                                 |
| `brownie settings patch <json\|-> [--json]`                 | merge a sparse patch into `settings.json` — `null` deletes a key, the file is validated before writing |
| `brownie prompt get <agent> [--json]`                       | print a project prompt                                                                                 |
| `brownie prompt set <agent> [file\|-]`                      | replace it from a file or stdin                                                                        |
| `brownie memory search <query> [--limit <n>]`               | full-text search over task summaries (1–100 entries, default 10)                                       |
| `brownie memory recent [--limit <n>]`                       | the newest task summaries                                                                              |

`--json` prints the raw payload for scripts; `-` reads the body from stdin.

## In containers

The socket is invisible from outside the container. `BROWNIE_CONTROL_SOCKET` moves it to an absolute path (shorter than 104 bytes) that both sides can see — the worker creates the directory, the CLI reads the same variable:

```yaml
volumes:
  - /tmp/brownie-run:/run/brownie
environment:
  BROWNIE_CONTROL_SOCKET: /run/brownie/control.sock
```

From the host: `BROWNIE_CONTROL_SOCKET=/tmp/brownie-run/control.sock brownie status`. The socket is `chmod 0600` by the worker's user, so a different uid gets `Permission denied`; give each agent its own directory when you run several. A second `brownie` in the same project refuses to start while one is already running.

## Wire protocol

One connection carries one request — a JSON object terminated by `\n` — and receives one JSON line back: `{"ok":true,"data":…}` or `{"ok":false,"error":"…"}`. `data` is omitted when a command returns nothing; optional fields inside it are omitted, never `null`. Requests over 1 MiB are refused, idle connections dropped after 5 s.

| Request                                                        | `data`                                         |
| -------------------------------------------------------------- | ---------------------------------------------- |
| `{"cmd":"status"}`                                             | the document `brownie status --json` prints    |
| `{"cmd":"pause","agent":"monitor"\|"executor"\|"all"}`         | —                                              |
| `{"cmd":"resume","agent":…}`                                   | —                                              |
| `{"cmd":"settings.get"}`                                       | effective settings                             |
| `{"cmd":"settings.patch","patch":{…}}`                         | the resulting settings; `null` deletes a key   |
| `{"cmd":"tasks.list","status"?:…}`                             | `Task[]`                                       |
| `{"cmd":"tasks.add","description":"…","id"?:"…","title"?:"…"}` | the created `Task`; a duplicate id is an error |
| `{"cmd":"tasks.retry","id":"…"}`                               | `true` when a failed task was requeued         |
| `{"cmd":"tasks.cancel","id":"…"}`                              | `true` when a pending task was cancelled       |
| `{"cmd":"memory.search","query":"…","limit"?:1-100}`           | task summaries, best match first               |
| `{"cmd":"memory.recent","limit"?:1-100}`                       | the newest task summaries                      |
| `{"cmd":"prompt.get","agent":"monitor"\|"executor"}`           | `{"agent":…,"content":"…"}`                    |
| `{"cmd":"prompt.set","agent":…,"content":"…"}`                 | —                                              |

An unknown `cmd` or non-JSON input answers `Unrecognized control request.`; a bad payload names the field (`Invalid tasks.add request: description: …`); a rejected settings patch answers `Invalid configuration (.brownie/settings.json):` with the offending paths.
