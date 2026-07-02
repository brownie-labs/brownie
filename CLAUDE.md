# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Czym jest ten projekt

`claude-worker` — długo działający proces CLI, który w stałym rytmie uruchamia jednorazowe
sesje Claude Code (`claude -p`). Prompt użytkownika i system prompt pochodzą z plików `.md`.
W danym momencie działa **maksymalnie jedna sesja**; rytm liczony jest od startu sesji, bez
nakładania (jeśli sesja przekroczy interwał, następna startuje natychmiast po jej zakończeniu).

## Komendy

```bash
pnpm install
pnpm configure                    # interaktywnie tworzy .env oraz prompts/prompt.md
pnpm start                        # uruchamia workera (używa ./.env)
pnpm start --env-file ./inny.env  # inny plik konfiguracji
pnpm dev                          # tsx watch (auto-restart przy zmianach)
pnpm build                        # tsup → dist/ (ESM), binarka claude-worker
pnpm typecheck                    # tsc --noEmit
pnpm lint                         # eslint . (typescript-eslint, reguły type-aware)
pnpm lint:fix                     # eslint . --fix
pnpm format                       # prettier --write .
pnpm format:check                 # prettier --check .
pnpm test                         # vitest run (testy jednostkowe + integracyjne)
pnpm test:watch                   # vitest w trybie watch
pnpm test:coverage                # vitest run --coverage (raport v8, egzekwowane progi)
pnpm check                        # wszystko naraz: typecheck + lint + format:check + test
```

Weryfikacja poprawności = `pnpm check`.
Linter: ESLint (flat config `eslint.config.js`) + typescript-eslint w trybie
type-aware; formatter: Prettier (`eslint-config-prettier` wyłącza reguły stylistyczne
kolidujące z Prettierem).
Testy: Vitest, katalog `test/` (lustrzany do `src/`), atrapa binarki `claude`
w `test/fixtures/claude` emitująca stream-json. Manager pakietów to **pnpm**
(jest `pnpm-lock.yaml`).

## Architektura

Wejście `src/index.ts` (citty) → dwie subkomendy: `start` i `configure`.

Przepływ `start` (`src/start.ts`):

1. `preflight.ts` (`ensureReady`) — ładuje `.env` (`process.loadEnvFile`), waliduje env
   (`parseEnv` + `envSchema`), sprawdza obecność `claude` w PATH, pliku `.env` oraz plików
   promptów; przy braku rzuca błąd z podpowiedzią `pnpm configure`. Zwraca zweryfikowane
   `PromptPaths`.
2. `config.ts` (`loadWorkerConfig`) — waliduje zmienne schematem zod (`parseEnv`),
   rozwiązuje ścieżki, buduje `childEnv`. Przyjmuje opcjonalnie `PromptPaths` z preflightu
   — wtedy pomija ponowne ładowanie `.env` i walidację czytelności plików promptów.
   Katalog `cwd` tworzy `start.ts` po zbudowaniu configu.
3. `shutdown.ts` (`abortOnSignals`) — zwraca `AbortSignal` reagujący na SIGINT/SIGTERM.
4. `scheduler.ts` (`runScheduler`) — pętla: uruchamia sesję, mierzy czas, czeka do końca
   interwału. `AbortSignal` przerywa zarówno `sleep`, jak i trwającą sesję.
5. `runner.ts` (`runSession`) — `spawn` procesu `claude` z argumentami
   (`-p --model --system-prompt --output-format stream-json --verbose` + opcjonalnie
   `--permission-mode`, `--include-partial-messages`). Prompt idzie przez stdin. Obsługuje
   timeout sesji (SIGTERM → po `KILL_GRACE_MS` SIGKILL) i abort.
6. `stream.ts` (`StreamRenderer`) — parsuje linie stream-json (system/assistant/user/
   stream_event/result), renderuje przez consola, agreguje podsumowanie (koszt, tury,
   sessionId, isError — konwersja z wire-formatu `is_error` na granicy).

`configure.ts` — interaktywny kreator (consola prompt); anulowanie (Ctrl+C) rzuca
`ConsolaPromptCancelledError`, wykrywany przez `isCancellation` i traktowany jako czyste
przerwanie bez zmian. Zapisuje `.env` i `prompts/prompt.md`.

`types.ts` — `WorkerConfig` i `SessionResult` (współdzielone kontrakty).

## Kluczowe zasady i pułapki

- **Model danych konfiguracji jest środowiskowy** — jedynym źródłem prawdy jest `.env`
  (walidowany zod w `config.ts`). `.env` i `prompts/prompt.md` są w `.gitignore`; nic nie
  jest hardkodowane w repo. `prompts/system.md` jest wersjonowany.
- **Komenda jest stała** — `COMMAND = "claude"` w `config.ts` (nie jest konfigurowalna przez env).
- **Izolacja sesji** — każda sesja działa w `CLAUDE_WORKER_CWD` (domyślnie `./workspace`,
  tworzony automatycznie, w `.gitignore`). Katalog jest podrzędny wobec kodu agenta, dzięki
  czemu sesja nie modyfikuje własnego kodu.
- **`CLAUDE_CONFIG_DIR`** — przekazywany do procesu potomnego przez `childEnv`; obsługuje `~`
  (rozwijane przez `expandHome`). Pozwala użyć innego profilu Claude Code (osobne MCP/subskrypcja).
- **Ścieżki** — względne rozwiązywane od `process.cwd()` przez `resolveFromCwd`
  (z rozwinięciem `~`). Ścieżki promptów w jednym miejscu: `resolvePromptPaths` w
  `config.ts` przyjmuje **sparsowane** env (wynik `parseEnv`) i tylko resolwuje ścieżki;
  w przepływie `start` liczy je raz `ensureReady` i przekazuje do `loadWorkerConfig`.
- **Dostęp do plików** — wspólne helpery w `src/fs.ts` (`canAccess`, `assertReadable`);
  nie duplikuj wzorca `fs.access(...) + try/catch`.
- **ESM + verbatimModuleSyntax** — importy muszą mieć rozszerzenie `.js` (mimo plików `.ts`),
  a importy typów muszą używać `import type`.

## Konwencje projektu (z globalnego CLAUDE.md użytkownika)

- Odpowiadaj i pisz komunikaty/komentarze po polsku.
- Nie dodawaj komentarzy w kodzie — kod ma być samotłumaczący.
- Stawiaj na jakość, nie szybkość; szukaj najlepszych rozwiązań (top-tier kod).
- W commitach nie umieszczaj wzmianek o Claude Code / "Generated with" / "Co-Authored-By".
