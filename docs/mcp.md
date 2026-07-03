# MCP servers

Brownie's agents can use [MCP](https://modelcontextprotocol.io) servers you register per project — the same idea as Claude Code's `claude mcp add`, only stored in `.brownie/mcp.json` (the same format as Claude Code's `.mcp.json`). The monitor uses them to find work (e.g. GitHub issues), the executor to do it. On top of whatever you register, the executor always gets brownie's built-in `memory` server.

## Commands

`brownie mcp add|list|get|remove` operate on `.brownie/mcp.json` in the directory you run them from, so `.brownie/` must already exist — run `brownie config` first if it doesn't.

| Command                     | Effect                             |
| --------------------------- | ---------------------------------- |
| `brownie mcp add <name> …`  | register a server (see below)      |
| `brownie mcp list`          | list configured servers            |
| `brownie mcp get <name>`    | print one server's JSON definition |
| `brownie mcp remove <name>` | remove a server                    |

(`brownie mcp serve --db …` also exists but is internal — it's the stdio memory server the executor talks to, wired up automatically.)

## Adding a server

### stdio (default)

```bash
brownie mcp add <name> [--env KEY=VALUE]… -- <command> [args…]
```

Everything after `--` is the server's command and its own arguments — the `--` matters whenever the command has flags of its own, so they aren't parsed as brownie flags. `--env` is repeatable.

```bash
# GitHub — a stdio server that takes a token in its environment
brownie mcp add github \
  --env GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxxxxxxx \
  -- npx -y @modelcontextprotocol/server-github

# Playwright — the command's own -y flag goes after --
brownie mcp add playwright -- npx -y @playwright/mcp
```

### Remote (http / sse)

```bash
brownie mcp add <name> --transport http [--header "Name: Value"]… <url>
```

```bash
brownie mcp add linear --transport http \
  --header "Authorization: Bearer xxxxxxxx" \
  https://mcp.linear.app/mcp
```

### Options

| Option            | Applies to | Meaning                                                  |
| ----------------- | ---------- | -------------------------------------------------------- |
| `--transport <t>` | all        | `stdio` (default), `http`, or `sse`                      |
| `--env KEY=VALUE` | stdio      | environment variable for the server process (repeatable) |
| `--header "N: V"` | http, sse  | HTTP header (repeatable)                                 |
| `--force`         | all        | overwrite a server that already has this name            |

## How the agents receive them

Brownie hands the registered servers to the spawned Claude Code sessions via `--mcp-config`:

- **executor** — the `memory` server **plus** every server in `mcp.json`.
- **monitor** — every server in `mcp.json` (no `memory`; it only reports tasks).

Brownie passes `--strict-mcp-config`, so the agents use **only** these servers — the MCP servers configured in the underlying Claude Code profile (the one selected by [`claudeConfigDir`](configuration.md#claudeconfigdir)) are **not** loaded. `.brownie/mcp.json` is the single source of the agents' MCP tools; `claudeConfigDir` controls only which account/subscription is billed, never the toolset.

Note: Claude Code still honours a server that you have explicitly disabled for the project (via `/mcp`), so a name in that project's `disabledMcpServers` stays off even when brownie supplies it here.

## The file

`.brownie/mcp.json` is plain JSON you can also edit by hand:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "…" }
    },
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

## Secrets

Unlike Claude Code's `~/.claude.json` (which lives in your home directory), `.brownie/mcp.json` sits **inside the project** and is not gitignored by default. If a server needs an API key or auth header, add `mcp.json` to `.brownie/.gitignore` so the secret is never committed — brownie does not yet expand `${ENV_VAR}` references, so the value must be literal in the file.
