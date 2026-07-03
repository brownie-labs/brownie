# Contributing to Brownie

Thanks for helping the sprite! Contributions of all kinds are welcome — bug reports, docs, code.

## Setup

- Node.js ≥ 22 and [pnpm](https://pnpm.io) (`corepack enable` is enough)
- `pnpm install`
- `pnpm dev` starts brownie in watch mode (tsx); `pnpm start` runs it once

## Before you open a PR

```bash
pnpm check   # typecheck + lint + format:check + test
```

CI runs the same command, so a green `pnpm check` locally means a green build.

- **Tests are required.** Coverage thresholds (statements 92%, lines 94%) are enforced in `vitest.config.ts` — untested code fails the build. Tests live in `test/` and mirror `src/`. Claude sessions are tested against a fake binary (`test/fixtures/claude`) driven by `FAKE_CLAUDE_*` variables — never against the real CLI.
- **Formatting is Prettier's job**: `pnpm format` fixes everything.

## Conventions

- Code, user-facing messages, errors, and commit messages are in English.
- No comments in the code — the code should speak for itself.
- Agent prompt content lives **only** in markdown files (`prompts/*.system.md` in the package, `.brownie/prompts/*.prompt.md` in projects) — never as string constants in the code.
- A new configuration option = a key in `settingsSchema` (`src/config.ts`) + a mapping in `loadWorkerConfig` + usually a wizard question in `src/configure.ts`.
- `src/paths.ts` is the single source of truth for the filesystem layout.

See [CLAUDE.md](CLAUDE.md) for the full architecture walkthrough.

## Demo GIF

The README demo is scripted and reproducible — after UI changes, re-record it:

```bash
pnpm build
node scripts/demo/setup.mjs
vhs scripts/demo/demo.tape   # requires https://github.com/charmbracelet/vhs
```
